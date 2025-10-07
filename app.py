import datetime
import json
import os
import uuid

import openai
import requests
from bson.objectid import ObjectId
from flask import (Flask, jsonify, render_template, request, url_for, redirect,
                   flash)
from flask_login import (LoginManager, UserMixin, login_user, logout_user,
                         login_required, current_user)
from pymongo import MongoClient, TEXT
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'a-very-secret-key-for-dev')

# --- Configuration ---
MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/?retryWrites=true&w=majority&directConnection=true')
client = MongoClient(MONGO_URI)
db = client['story_weaver_auth']
users_collection = db['users']
projects_collection = db['projects']
notes_collection = db['notes']
invited_users_collection = db['invited_users']
shared_invites_collection = db['shared_invites']
openai.api_key = os.environ.get('OPENAI_API_KEY')
if not openai.api_key:
    print("WARNING: OPENAI_API_KEY environment variable not set. AI features will fail.")

# --- Mailgun Configuration ---
MAILGUN_API_KEY = os.environ.get('MAILGUN_API_KEY')
MAILGUN_DOMAIN = os.environ.get('MAILGUN_DOMAIN')
NOTIFICATION_EMAIL_TO_OVERRIDE = os.environ.get('NOTIFICATION_EMAIL_TO')
NOTIFICATION_EMAIL_FROM = os.environ.get('NOTIFICATION_EMAIL_FROM', 'app-alerts@your_mailgun_domain.com')

if not MAILGUN_API_KEY or not MAILGUN_DOMAIN:
    print("WARNING: MAILGUN_API_KEY or MAILGUN_DOMAIN environment variable not set. Email notifications will fail.")

# --- Database Indexes for Scale ---
notes_collection.create_index([("content", TEXT)])
notes_collection.create_index([("tags", 1)])
notes_collection.create_index([("project_id", 1), ("user_id", 1), ("timestamp", -1)])
projects_collection.create_index([("user_id", 1), ("created_at", -1)])

# --- User Management Setup ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'


class User(UserMixin):
    def __init__(self, user_data):
        self.id = str(user_data['_id'])
        self.email = user_data['email']
        self.password_hash = user_data['password']

    @staticmethod
    def get(user_id):
        user_data = users_collection.find_one({'_id': ObjectId(user_id)})
        if user_data:
            return User(user_data)
        return None


@login_manager.user_loader
def load_user(user_id):
    return User.get(user_id)


# --- Constants ---
NOTES_PER_PAGE = 10
STORY_TONES = ["Nostalgic & Warm", "Comedic Monologue", "Hardboiled Detective", "Documentary Narrator", "Epic Saga",
               "Formal & Academic"]

# ----------------------------------------------------------------------
# --- Email Helper Function ---
# ----------------------------------------------------------------------

def send_notification_email(contributor_label, project_name, content_snippet, token, project_owner_email, is_shared=False):
    if not MAILGUN_API_KEY or not MAILGUN_DOMAIN:
        print("Notification skipped: Mailgun API key or domain is missing.")
        return

    recipient_email = NOTIFICATION_EMAIL_TO_OVERRIDE or project_owner_email
    
    # Determine the correct link based on the token type
    invite_url = url_for('invite_note', token=token, _external=True) if not is_shared else url_for('shared_invite_page', token=token, _external=True)

    email_subject = f"🔔 New Note in '{project_name}' from {contributor_label}"
    email_body_html = f"""
    <html><body>
        <h2>A new note has been submitted to your Story Weaver project!</h2>
        <p><strong>Project:</strong> {project_name}</p>
        <p><strong>Contributor:</strong> {contributor_label}</p>
        <p><strong>Content Snippet:</strong></p>
        <div style="border: 1px solid #ccc; padding: 10px; margin: 10px 0; background-color: #f9f9f9; border-left: 4px solid #007bff;">
            <em>"{content_snippet[:200]}..."</em>
        </div>
        <p>
            <a href="{invite_url}"
               style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
               Continue the Conversation
            </a>
        </p>
    </body></html>
    """
    try:
        response = requests.post(
            f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
            auth=("api", MAILGUN_API_KEY),
            data={"from": f"Story Weaver Alert <{NOTIFICATION_EMAIL_FROM}>",
                  "to": recipient_email,
                  "subject": email_subject,
                  "html": email_body_html})
        response.raise_for_status()
        print(f"✅ Notification email sent. Status: {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"❌ Mailgun Error: {e}")


# ----------------------------------------------------------------------
# --- AI Helper Functions ---
# ----------------------------------------------------------------------

def get_ai_follow_ups(project_goal, original_prompt, entry_content):
    if not openai.api_key: return []
    try:
        system_prompt = f"You are a helpful assistant for a writing project. The project's goal is: '{project_goal}'. Generate 3 insightful, open-ended follow-up questions to encourage deeper exploration of the topic. Based on the user's response to a prompt, generate exactly 3 distinct questions. Return as a JSON array of strings."
        user_prompt = f"Original Prompt: \"{original_prompt}\"\n\nUser's Latest Response:\n\"{entry_content}\"\n\nGenerate 3 follow-up questions."
        completion = openai.chat.completions.create(model="gpt-4o-mini",
                                                    messages=[{"role": "system", "content": system_prompt},
                                                              {"role": "user", "content": user_prompt}],
                                                    response_format={"type": "json_object"})
        questions_data = json.loads(completion.choices[0].message.content)
        return questions_data.get('questions', []) if isinstance(questions_data, dict) else questions_data if isinstance(
            questions_data, list) else []
    except Exception as e:
        print(f"Error calling OpenAI for follow-ups: {e}")
        return []


def get_ai_suggested_tags(project_id, entry_content):
    if not openai.api_key: return []
    try:
        example_entries = list(notes_collection.find(
            {'project_id': ObjectId(project_id), 'user_id': ObjectId(current_user.id),
             'tags': {'$exists': True, '$ne': []}},
            {'content': 1, 'tags': 1}
        ).sort("timestamp", -1).limit(15))
        example_prompt_part = ""
        if example_entries:
            example_prompt_part = "Here are examples of how I've tagged previous notes in this project:\n\n"
            for entry in example_entries:
                content_snippet = (entry['content'][:150] + '...') if len(entry['content']) > 150 else entry['content']
                example_prompt_part += f"- Note: \"{content_snippet.strip()}\"\n  Tags: {', '.join(entry['tags'])}\n"
        system_prompt = "You are an AI assistant that helps tag notes for a writing project. Suggest 3-5 relevant, concise, single-word or two-word tags. Analyze the new note and the user's past tagging style. Return as a JSON object: {\"tags\": [\"tag1\", \"tag2\"]}."
        user_prompt = f"{example_prompt_part}Now, suggest tags for this new note:\n\n\"{entry_content}\""
        completion = openai.chat.completions.create(model="gpt-4o-mini",
                                                    messages=[{"role": "system", "content": system_prompt},
                                                              {"role": "user", "content": user_prompt}],
                                                    response_format={"type": "json_object"})
        tags_data = json.loads(completion.choices[0].message.content)
        return tags_data.get('tags', [])
    except Exception as e:
        print(f"Error calling OpenAI for tag suggestions: {e}")
        return []


# ----------------------------------------------------------------------
# --- Auth Routes ---
# ----------------------------------------------------------------------
@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        if not email or not password:
            flash('Email and password are required.', 'error')
            return redirect(url_for('register'))
        existing_user = users_collection.find_one({'email': email})
        if existing_user:
            flash('Email address already in use.', 'error')
            return redirect(url_for('register'))
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
        users_collection.insert_one({'email': email, 'password': hashed_password})
        flash('Account created successfully! Please log in.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        user_data = users_collection.find_one({'email': email})
        if user_data and check_password_hash(user_data['password'], password):
            user = User(user_data)
            login_user(user, remember=True)
            return redirect(url_for('index'))
        flash('Invalid email or password.', 'error')
    return render_template('login.html')


@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))


# ----------------------------------------------------------------------
# --- Core Application Routes ---
# ----------------------------------------------------------------------

@app.route('/')
@login_required
def index():
    all_projects = list(projects_collection.find({'user_id': ObjectId(current_user.id)}).sort("created_at", -1))
    for p in all_projects:
        p['_id'] = str(p['_id'])
    return render_template('index.html', projects=all_projects)


@app.route('/project/<project_id>')
@login_required
def project_view(project_id):
    try:
        project = projects_collection.find_one({"_id": ObjectId(project_id), "user_id": ObjectId(current_user.id)})
        if not project:
            flash("Project not found or you don't have access.", "error")
            return redirect(url_for('index'))
        project['_id'] = str(project['_id'])
        return render_template('project.html', project=project, story_tones=STORY_TONES)
    except Exception:
        flash("Invalid Project ID.", "error")
        return redirect(url_for('index'))


@app.route('/invite/<token>')
def invite_note(token):
    invited_user = invited_users_collection.find_one({"token": token})
    if not invited_user:
        return "Invalid invitation token.", 404
    project = projects_collection.find_one({"_id": invited_user['project_id']})
    if not project:
        return "Associated project not found.", 404
    project['_id'] = str(project['_id'])
    return render_template(
        'invite.html',
        project=project,
        contributor_label=invited_user['label'],
        invite_token=token,
        invite_prompt=invited_user['prompt'],
        follow_up_questions=invited_user.get('last_suggested_questions', [])
    )


@app.route('/share/<token>')
def shared_invite_page(token):
    shared_invite = shared_invites_collection.find_one({"token": token})
    if not shared_invite:
        return "Invalid or expired shared invite link.", 404
    
    project = projects_collection.find_one({"_id": shared_invite['project_id']})
    if not project:
        return "Associated project not found.", 404
        
    project['_id'] = str(project['_id'])
    return render_template(
        'share.html',
        project=project,
        invite_prompt=shared_invite['prompt'],
        shared_token=token
    )

# ----------------------------------------------------------------------
# --- API Routes ---
# ----------------------------------------------------------------------

@app.route('/api/generate-shared-token', methods=['POST'])
@login_required
def generate_shared_token():
    data = request.get_json()
    project_id, prompt = data.get('project_id'), data.get('prompt', '').strip()

    if not all([project_id, prompt]):
        return jsonify({"status": "error", "message": "Project ID and prompt are required."}), 400
    
    project = projects_collection.find_one({"_id": ObjectId(project_id), "user_id": ObjectId(current_user.id)})
    if not project:
        return jsonify({"status": "error", "message": "Project not found or unauthorized."}), 404

    new_token = str(uuid.uuid4())
    shared_invites_collection.insert_one({
        "token": new_token,
        "project_id": ObjectId(project_id),
        "user_id": ObjectId(current_user.id),
        "prompt": prompt,
        "created_at": datetime.datetime.utcnow()
    })
    
    shared_url = url_for('shared_invite_page', token=new_token, _external=True)
    return jsonify({"status": "success", "shared_url": shared_url}), 201


@app.route('/api/projects', methods=['POST'])
@login_required
def create_project():
    data = request.get_json()
    name, project_goal = data.get('name', '').strip(), data.get('project_goal', '').strip()
    if not name or not project_goal:
        return jsonify({"status": "error", "message": "Project name and goal are required."}), 400

    project_doc = {
        'name': name,
        'project_goal': project_goal,
        'created_at': datetime.datetime.utcnow(),
        'user_id': ObjectId(current_user.id)
    }
    result = projects_collection.insert_one(project_doc)
    project_doc['_id'] = str(result.inserted_id)
    del project_doc['user_id']
    return jsonify({"status": "success", "project": project_doc}), 201


@app.route('/api/notes', methods=['POST'])
def add_note():
    data = request.get_json()
    content = data.get('content', '').strip()
    project_id = data.get('project_id')
    tags_string = data.get('tags', '').strip()
    
    invite_token = data.get('invite_token')
    shared_token = data.get('shared_token')
    contributor_label_from_post = data.get('contributor_label', '').strip()
    active_prompt = data.get('active_prompt')

    if not all([content, project_id]):
        return jsonify({"status": "error", "message": "Missing content or project_id"}), 400

    try:
        project = projects_collection.find_one({"_id": ObjectId(project_id)})
        if not project: return jsonify({"status": "error", "message": "Project not found"}), 404
    except Exception:
        return jsonify({"status": "error", "message": "Invalid project_id"}), 400

    tags = sorted(list(set([tag.strip().lower() for tag in tags_string.split(',') if tag.strip()])))
    
    new_follow_ups, contributor_label, notify_me, is_shared = [], 'Me', False, False

    if invite_token:
        invited_user = invited_users_collection.find_one({"token": invite_token, "project_id": ObjectId(project_id)})
        if invited_user:
            contributor_label = invited_user['label']
            new_follow_ups = get_ai_follow_ups(project['project_goal'], active_prompt or invited_user.get('prompt', ''), content)
            invited_users_collection.update_one({"token": invite_token}, {"$set": {"last_suggested_questions": new_follow_ups}})
            notify_me = True
    elif shared_token:
        shared_invite = shared_invites_collection.find_one({"token": shared_token, "project_id": ObjectId(project_id)})
        if shared_invite and contributor_label_from_post:
            contributor_label = contributor_label_from_post
            notify_me = True
            is_shared = True
        else:
            return jsonify({"status": "error", "message": "Invalid shared token or missing name."}), 400
    elif current_user.is_authenticated:
        if project['user_id'] != ObjectId(current_user.id):
            return jsonify({"status": "error", "message": "Unauthorized"}), 403
        contributor_label = 'Me'
    else:
        return jsonify({"status": "error", "message": "Authentication required"}), 401

    new_note_doc = {
        'project_id': ObjectId(project_id), 'user_id': project['user_id'], 'content': content,
        'timestamp': datetime.datetime.utcnow(), 'contributor_label': contributor_label,
        'answered_prompt': active_prompt, 'tags': tags
    }
    result = notes_collection.insert_one(new_note_doc)
    new_note_doc['_id'] = str(result.inserted_id)
    new_note_doc['project_id'] = str(new_note_doc['project_id'])
    new_note_doc['formatted_timestamp'] = new_note_doc['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
    
    if notify_me:
        project_owner = users_collection.find_one({"_id": project['user_id']})
        if project_owner:
            token_for_email = invite_token or shared_token
            send_notification_email(contributor_label, project['name'], content, token_for_email, project_owner['email'], is_shared=is_shared)
    
    del new_note_doc['user_id']
    return jsonify({"status": "success", "note": new_note_doc, "new_follow_ups": new_follow_ups}), 201


@app.route('/api/notes/<project_id>')
@login_required
def get_notes(project_id):
    page = int(request.args.get('page', 1, type=int))
    contributor_filter = request.args.get('contributor_filter')

    try:
        query = {
            'project_id': ObjectId(project_id),
            'user_id': ObjectId(current_user.id)
        }
    except Exception:
        return jsonify({"error": "Invalid Project ID"}), 400

    if contributor_filter and contributor_filter != 'All Contributors':
        query['contributor_label'] = contributor_filter

    skip_amount = (page - 1) * NOTES_PER_PAGE
    notes_cursor = notes_collection.find(query).sort("timestamp", -1).skip(skip_amount).limit(NOTES_PER_PAGE)

    notes_data = []
    for note in notes_cursor:
        note['_id'] = str(note['_id'])
        note['project_id'] = str(note['project_id'])
        note['user_id'] = str(note['user_id'])
        note['formatted_timestamp'] = note['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
        notes_data.append(note)

    return jsonify(notes_data)


@app.route('/api/generate-token', methods=['POST'])
@login_required
def generate_token():
    data = request.get_json()
    label, project_id, prompt = data.get('label', '').strip(), data.get('project_id'), data.get('prompt', '').strip()

    if not all([label, project_id, prompt]):
        return jsonify({"status": "error", "message": "All fields are required."}), 400

    project = projects_collection.find_one({"_id": ObjectId(project_id), "user_id": ObjectId(current_user.id)})
    if not project:
        return jsonify({"status": "error", "message": "Project not found or unauthorized."}), 404

    new_token = str(uuid.uuid4())
    invited_users_collection.insert_one({
        "token": new_token, "label": label, "project_id": ObjectId(project_id), "prompt": prompt,
        "created_at": datetime.datetime.utcnow()
    })
    invite_url = url_for('invite_note', token=new_token, _external=True)
    return jsonify({"status": "success", "label": label, "invite_url": invite_url}), 201


@app.route('/api/suggest-tags', methods=['POST'])
@login_required
def suggest_tags():
    if not openai.api_key: return jsonify({"error": "OpenAI API key is not configured."}), 500
    data = request.get_json()
    content, project_id = data.get('content'), data.get('project_id')
    if not content or not project_id: return jsonify({"error": "Content and project_id are required."}), 400

    project = projects_collection.find_one({"_id": ObjectId(project_id), "user_id": ObjectId(current_user.id)})
    if not project: return jsonify({"error": "Project not found or unauthorized."}), 404

    suggested_tags = get_ai_suggested_tags(project_id, content)
    return jsonify({"tags": suggested_tags})


@app.route('/api/search-notes/<project_id>')
@login_required
def search_notes(project_id):
    try:
        search_query, tags_filter = request.args.get('q', ''), request.args.get('tags', '')
        page = int(request.args.get('page', 1))
        per_page = 20
        query = {'project_id': ObjectId(project_id), 'user_id': ObjectId(current_user.id)}
        if search_query: query['$text'] = {'$search': search_query}
        if tags_filter: query['tags'] = {'$all': [tag.strip() for tag in tags_filter.split(',')]}

        total_notes = notes_collection.count_documents(query)
        total_pages = (total_notes + per_page - 1) // per_page
        notes_cursor = notes_collection.find(query).sort("timestamp", 1).skip((page - 1) * per_page).limit(per_page)

        notes_data = []
        for note in notes_cursor:
            note['_id'] = str(note['_id'])
            note['project_id'] = str(note['project_id'])
            note['user_id'] = str(note['user_id'])
            notes_data.append(note)

        return jsonify(
            {"notes": notes_data, "total_pages": total_pages, "current_page": page, "total_notes": total_notes})
    except Exception as e:
        print(f"Error in /search-notes: {e}")
        return jsonify({"error": "An internal error occurred"}), 500


@app.route('/api/get-tags/<project_id>')
@login_required
def get_tags(project_id):
    try:
        pipeline = [{'$match': {'project_id': ObjectId(project_id), 'user_id': ObjectId(current_user.id)}},
                    {'$unwind': '$tags'}, {'$group': {'_id': '$tags'}}, {'$sort': {'_id': 1}}]
        tags = [doc['_id'] for doc in notes_collection.aggregate(pipeline)]
        return jsonify(tags)
    except Exception as e:
        print(f"Error getting tags: {e}")
        return jsonify({"error": "Could not retrieve tags"}), 500


@app.route('/api/contributors/<project_id>')
@login_required
def get_contributors(project_id):
    try:
        labels = set(notes_collection.distinct('contributor_label',
                                               {'project_id': ObjectId(project_id),
                                                'user_id': ObjectId(current_user.id)}))
        invited_labels = set(
            invited_users_collection.distinct('label', {'project_id': ObjectId(project_id)}))
        labels.update(invited_labels)
        sorted_labels = sorted(list(labels - {'Me'}))
        if 'Me' in labels: sorted_labels.insert(0, 'Me')
        return jsonify(['All Contributors'] + sorted_labels)
    except Exception as e:
        print(f"Error getting contributors: {e}")
        return jsonify({"error": "Could not retrieve contributors"}), 500


@app.route('/api/generate-story', methods=['POST'])
@login_required
def generate_story():
    if not openai.api_key: return jsonify({"error": "OpenAI API key is not configured."}), 500
    data = request.get_json()
    project_name, tone, selected_notes = data.get('project_name'), data.get('tone'), data.get('notes', [])
    if not all([project_name, tone, selected_notes]):
        return jsonify({"error": "Project name, tone, and selected notes are required."}), 400

    if selected_notes:
        first_note_id = selected_notes[0].get('_id')
        try:
            note_check = notes_collection.find_one(
                {"_id": ObjectId(first_note_id), "user_id": ObjectId(current_user.id)})
            if not note_check:
                return jsonify({"error": "Unauthorized"}), 403
        except Exception:
            return jsonify({"error": "Invalid note ID provided"}), 400

    formatted_notes = "".join(
        [f"- From {note.get('contributor_label', 'Me')}: \"{note.get('content', '')}\"\n" for note in selected_notes])
    try:
        system_prompt = "You are a master writer. Weave a collection of notes into a coherent, compelling narrative. If notes are from multiple contributors, synthesize them into a single voice or a structured dialogue, as appropriate."
        user_prompt = f"Synthesize these notes from the \"{project_name}\" project into a short narrative (3-5 paragraphs) with a \"{tone}\" tone. Connect the ideas, infer themes, and create a fluid arc.\n\nNotes:\n{formatted_notes}"
        completion = openai.chat.completions.create(model="gpt-4o-mini",
                                                    messages=[{"role": "system", "content": system_prompt},
                                                              {"role": "user", "content": user_prompt}])
        return jsonify({"story": completion.choices[0].message.content})
    except Exception as e:
        print(f"Error during story generation: {e}")
        return jsonify({"error": "Failed to generate story from AI."}), 500


if __name__ == '__main__':
    app.static_folder = 'static'
    app.run(host='0.0.0.0', port=5001, debug=True)