import datetime
import json
import os
import re
import uuid

import openai
import requests  # Use requests instead of mailgun
from flask import Flask, jsonify, render_template, request, url_for
from pymongo import MongoClient, TEXT

app = Flask(__name__)

# --- Configuration ---
MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/?retryWrites=true&w=majority&directConnection=true')
client = MongoClient(MONGO_URI)
db = client['autobiography_journal']
entries_collection = db['entries']
invited_users_collection = db['invited_users']
openai.api_key = os.environ.get('OPENAI_API_KEY')
if not openai.api_key:
    print("WARNING: OPENAI_API_KEY environment variable not set. AI features will fail.")

# --- Mailgun Configuration ---
MAILGUN_API_KEY = os.environ.get('MAILGUN_API_KEY')
MAILGUN_DOMAIN = os.environ.get('MAILGUN_DOMAIN')
NOTIFICATION_EMAIL_TO = os.environ.get('NOTIFICATION_EMAIL_TO', 'your_personal_email@example.com')
NOTIFICATION_EMAIL_FROM = os.environ.get('NOTIFICATION_EMAIL_FROM', 'app-alerts@your_mailgun_domain.com')

if not MAILGUN_API_KEY or not MAILGUN_DOMAIN:
    print("WARNING: MAILGUN_API_KEY or MAILGUN_DOMAIN environment variable not set. Email notifications will fail.")

# --- Database Indexes for Scale ---
entries_collection.create_index([("content", TEXT)])
entries_collection.create_index([("tags", 1)])
entries_collection.create_index([("labels", 1)])
entries_collection.create_index([("time_frame", 1), ("timestamp", -1)])

# --- Constants ---
ENTRIES_PER_PAGE = 10
TIME_FRAMES = ["Early Childhood (0-6)", "School Years (7-17)", "Young Adulthood (18-29)", "Establishment (30-49)", "Midlife Reflection (50-65)", "Later Years (65+)", "Other/Unspecified"]
STORY_TONES = ["Nostalgic & Warm", "Comedic Monologue", "Hardboiled Detective", "Documentary Narrator", "Epic Saga"]

# ----------------------------------------------------------------------
# --- Email Helper Function (Using Requests) ---
# ----------------------------------------------------------------------

def send_notification_email(contributor_label, time_frame, content_snippet, invite_token):
    if not MAILGUN_API_KEY or not MAILGUN_DOMAIN:
        print("Notification skipped: Mailgun API key or domain is missing.")
        return
    email_subject = f"🔔 New Autobiography Entry from {contributor_label}"
    email_body_html = f"""
    <html>
        <body>
            <h2>A new entry has been submitted to your Autobiography Journal!</h2>
            <p><strong>Contributor:</strong> {contributor_label}</p>
            <p><strong>Life Stage:</strong> {time_frame}</p>
            <p><strong>Content Snippet:</strong></p>
            <div style="border: 1px solid #ccc; padding: 10px; margin: 10px 0; background-color: #f9f9f9; border-left: 4px solid #007bff;">
                <em>"{content_snippet[:200]}..."</em>
            </div>
            <p>
                <a href="{url_for('invite_entry', token=invite_token, _external=True)}" 
                   style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                   Continue the Conversation
                </a>
            </p>
            <p style="font-size: 12px; color: #888;">This notification was sent by your Journal app.</p>
        </body>
    </html>
    """
    try:
        response = requests.post(
            f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
            auth=("api", MAILGUN_API_KEY),
            data={"from": f"Autobiography Alert <{NOTIFICATION_EMAIL_FROM}>",
                  "to": NOTIFICATION_EMAIL_TO,
                  "subject": email_subject,
                  "html": email_body_html})
        response.raise_for_status()
        print(f"✅ Notification email sent via Mailgun. Status: {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"❌ Mailgun Error: {e}")
        if e.response is not None:
            print(f"Error details: {e.response.text}")

# ----------------------------------------------------------------------
# --- AI Helper Functions ---
# ----------------------------------------------------------------------

def get_ai_follow_ups(time_frame, original_prompt, entry_content):
    if not openai.api_key: return []
    try:
        system_prompt = "You are a helpful assistant who generates insightful, open-ended follow-up questions to encourage deeper storytelling for an autobiography. Based on the user's response to a prompt, generate exactly 3 distinct questions. Return the questions as a JSON array of strings."
        user_prompt = f"Context:\n- Life Stage: \"{time_frame}\"\n- Original Prompt: \"{original_prompt}\"\n\nUser's Latest Response:\n\"{entry_content}\"\n\nGenerate 3 follow-up questions."
        completion = openai.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}], response_format={"type": "json_object"})
        questions_data = json.loads(completion.choices[0].message.content)
        if isinstance(questions_data, dict):
            return questions_data.get('questions', [])
        elif isinstance(questions_data, list):
            return questions_data
        return []

    except Exception as e:
        print(f"Error calling OpenAI for follow-ups: {e}")
        return []

def get_ai_suggested_tags(time_frame, entry_content):
    if not openai.api_key: return []
    try:
        example_entries = list(entries_collection.find(
            {'time_frame': time_frame, 'tags': {'$exists': True, '$ne': []}},
            {'content': 1, 'tags': 1}
        ).sort("timestamp", -1).limit(15))

        example_prompt_part = ""
        if example_entries:
            example_prompt_part = "Here are examples of how I've tagged previous entries in this life stage:\n\n"
            for entry in example_entries:
                content_snippet = (entry['content'][:150] + '...') if len(entry['content']) > 150 else entry['content']
                example_prompt_part += f"- Entry: \"{content_snippet.strip()}\"\n  Tags: {', '.join(entry['tags'])}\n"
            example_prompt_part += "\n"

        system_prompt = "You are an AI assistant that helps tag journal entries. Suggest 3-5 relevant, concise, single-word or two-word tags. Analyze the new entry and the user's past tagging style from the examples. Return the suggestions as a JSON object: {\"tags\": [\"tag1\", \"tag2\"]}."
        
        user_prompt = (
            f"{example_prompt_part}"
            f"Now, based on that context, suggest tags for this new entry:\n\n"
            f"\"{entry_content}\""
        )
        
        completion = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        tags_data = json.loads(completion.choices[0].message.content)
        return tags_data.get('tags', [])

    except Exception as e:
        print(f"Error calling OpenAI for tag suggestions: {e}")
        return []

# ----------------------------------------------------------------------
# --- Routes ---
# ----------------------------------------------------------------------

@app.route('/')
def index():
    latest_entries = list(entries_collection.find().sort("timestamp", -1).limit(ENTRIES_PER_PAGE))
    for entry in latest_entries:
        entry['_id'] = str(entry['_id'])
        entry['formatted_timestamp'] = entry['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
    return render_template('index.html', entries=latest_entries, time_frames=TIME_FRAMES, story_tones=STORY_TONES)

@app.route('/invite/<token>')
def invite_entry(token):
    invited_user = invited_users_collection.find_one({"token": token})
    if not invited_user:
        return "Invalid invitation token.", 404

    last_questions = invited_user.get('last_suggested_questions')
    if last_questions:
        current_prompt = "Continue the conversation by selecting a question below, or write about something new."
    else:
        current_prompt = invited_user['prompt']

    return render_template(
        'index.html',
        entries=[],
        time_frames=TIME_FRAMES,
        contributor_label=invited_user['label'],
        invite_token=token,
        invite_time_frame=invited_user['time_frame'],
        invite_prompt=current_prompt,
        last_suggested_questions=last_questions or []
    )

@app.route('/add', methods=['POST'])
def add_entry():
    print("\n--- /add ROUTE HIT ---") # DEBUG
    data = request.get_json()
    content, time_frame, tags_string = data.get('content', '').strip(), data.get('time_frame'), data.get('tags', '').strip()
    invite_token, active_prompt = data.get('invite_token'), data.get('active_prompt')

    print(f"Received invite_token: '{invite_token}'") # DEBUG

    if not content or not time_frame: return jsonify({"status": "error", "message": "Missing content or time-frame"}), 400

    tags = sorted(list(set([tag.strip().lower() for tag in tags_string.split(',') if tag.strip()]))) if tags_string else []
    
    new_follow_ups, contributor_label, labels = [], 'Me', []
    notify_me = False 

    if invite_token:
        print(f"Searching for user with token '{invite_token}' in the database...") # DEBUG
        invited_user = invited_users_collection.find_one({"token": invite_token})
        if invited_user:
            print("✅ SUCCESS: Found user in database!") # DEBUG
            contributor_label = invited_user['label']
            time_frame = invited_user['time_frame']
            labels = invited_user.get('labels', [])
            new_follow_ups = get_ai_follow_ups(time_frame, active_prompt or invited_user.get('prompt', ''), content)
            invited_users_collection.update_one({"token": invite_token}, {"$set": {"last_suggested_questions": new_follow_ups}})
            notify_me = True
        else:
            print("❌ ERROR: No user found for this token. Make sure the token exists in the 'invited_users' collection.") # DEBUG
    
    new_entry_doc = {'content': content, 'timestamp': datetime.datetime.utcnow(), 'time_frame': time_frame,
                     'contributor_label': contributor_label, 'prompt_token': invite_token, 'answered_prompt': active_prompt,
                     'tags': tags, 'labels': labels}
    result = entries_collection.insert_one(new_entry_doc)
    new_entry_doc['_id'] = str(result.inserted_id)
    new_entry_doc['formatted_timestamp'] = new_entry_doc['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
    
    print(f"Final check before sending. The value of 'notify_me' is: {notify_me}") # DEBUG
    if notify_me:
        print("🚀 FIRING send_notification_email FUNCTION! 🚀") # DEBUG
        send_notification_email(contributor_label, time_frame, content, invite_token)
    
    return jsonify({"status": "success", "entry": new_entry_doc, "new_follow_ups": new_follow_ups}), 201

@app.route('/generate-token', methods=['POST'])
def generate_token():
    data = request.get_json()
    label, time_frame, prompt = data.get('label', '').strip(), data.get('time_frame'), data.get('prompt', '').strip()
    labels_string = data.get('labels', '').strip()

    if not all([label, time_frame, prompt]): return jsonify({"status": "error", "message": "All fields are required."}), 400
    
    labels = sorted(list(set([lbl.strip() for lbl in labels_string.split(',') if lbl.strip()]))) if labels_string else []
    
    new_token = str(uuid.uuid4())
    invited_users_collection.insert_one({
        "token": new_token, "label": label, "time_frame": time_frame, "prompt": prompt, 
        "labels": labels, "created_at": datetime.datetime.utcnow()
    })
    invite_url = url_for('invite_entry', token=new_token, _external=True)
    return jsonify({"status": "success", "label": label, "invite_url": invite_url}), 201

@app.route('/entries')
def get_entries():
    page = int(request.args.get('page', 1, type=int))
    time_frame_filter, contributor_filter, label_filter = request.args.get('time_frame_filter'), request.args.get('contributor_filter'), request.args.get('label_filter')

    query = {}
    if time_frame_filter: query['time_frame'] = time_frame_filter
    if contributor_filter and contributor_filter != 'All Contributors': query['contributor_label'] = contributor_filter
    if label_filter and label_filter != 'All Labels': query['labels'] = label_filter

    skip_amount = (page - 1) * ENTRIES_PER_PAGE
    entries_cursor = entries_collection.find(query).sort("timestamp", -1).skip(skip_amount).limit(ENTRIES_PER_PAGE)
    
    entries_data = []
    for e in entries_cursor:
        e['_id'] = str(e['_id'])
        e['formatted_timestamp'] = e['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
        entries_data.append(e)
    return jsonify(entries_data)

@app.route('/suggest-tags', methods=['POST'])
def suggest_tags():
    if not openai.api_key:
        return jsonify({"error": "OpenAI API key is not configured."}), 500
    
    data = request.get_json()
    content = data.get('content')
    time_frame = data.get('time_frame')

    if not content or not time_frame:
        return jsonify({"error": "Content and time_frame are required."}), 400

    suggested_tags = get_ai_suggested_tags(time_frame, content)
    
    return jsonify({"tags": suggested_tags})


@app.route('/get-labels')
def get_labels():
    pipeline = [{'$unwind': '$labels'}, {'$group': {'_id': '$labels'}}, {'$sort': {'_id': 1}}]
    labels = [doc['_id'] for doc in entries_collection.aggregate(pipeline)]
    return jsonify(['All Labels'] + labels)

@app.route('/search-notes')
def search_notes():
    try:
        time_frame = request.args.get('time_frame')
        search_query = request.args.get('q', '')
        tags_filter = request.args.get('tags', '')
        page = int(request.args.get('page', 1))
        per_page = 20

        if not time_frame:
            return jsonify({"error": "A time frame is required."}), 400

        query = {'time_frame': time_frame}

        if search_query:
            query['$text'] = {'$search': search_query}
        
        if tags_filter:
            tags_list = [tag.strip() for tag in tags_filter.split(',')]
            query['tags'] = {'$all': tags_list}

        total_notes = entries_collection.count_documents(query)
        total_pages = (total_notes + per_page - 1) // per_page

        notes_cursor = entries_collection.find(query).sort("timestamp", 1).skip((page - 1) * per_page).limit(per_page)
        
        notes_data = []
        for note in notes_cursor:
            note['_id'] = str(note['_id'])
            notes_data.append(note)

        return jsonify({
            "notes": notes_data,
            "total_pages": total_pages,
            "current_page": page,
            "total_notes": total_notes
        })
    except Exception as e:
        print(f"Error in /search-notes: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

@app.route('/get-tags')
def get_tags():
    time_frame = request.args.get('time_frame')
    if not time_frame:
        return jsonify({"error": "A time frame is required"}), 400
    
    pipeline = [
        {'$match': {'time_frame': time_frame}},
        {'$unwind': '$tags'},
        {'$group': {'_id': '$tags'}},
        {'$sort': {'_id': 1}}
    ]
    tags = [doc['_id'] for doc in entries_collection.aggregate(pipeline)]
    return jsonify(tags)

@app.route('/contributors')
def get_contributors():
    labels = set(entries_collection.distinct('contributor_label'))
    labels.update(invited_users_collection.distinct('label'))
    sorted_labels = sorted(list(labels - {'Me'}))
    if 'Me' in labels: sorted_labels.insert(0, 'Me')
    return jsonify(['All Contributors'] + sorted_labels)

@app.route('/generate-story', methods=['POST'])
def generate_story():
    if not openai.api_key: return jsonify({"error": "OpenAI API key is not configured."}), 500
    
    data = request.get_json()
    time_frame = data.get('time_frame')
    tone = data.get('tone')
    selected_notes = data.get('notes', [])

    if not all([time_frame, tone, selected_notes]):
        return jsonify({"error": "Time frame, tone, and a selection of notes are required."}), 400

    formatted_notes = "".join([f"- From {note.get('contributor_label', 'Me')}: \"{note.get('content', '')}\"\n" for note in selected_notes])
    
    try:
        system_prompt = "You are a master storyteller. Weave a collection of journal entries into a coherent, first-person narrative ('I', 'my')."
        user_prompt = f"Synthesize these notes from the life stage \"{time_frame}\" into a short story (3-5 paragraphs) with a \"{tone}\" tone. Connect the events, infer emotions, and create a fluid narrative arc.\n\nNotes:\n{formatted_notes}"
        completion = openai.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}])
        return jsonify({"story": completion.choices[0].message.content})
    except Exception as e:
        print(f"Error during story generation: {e}")
        return jsonify({"error": "Failed to generate story from AI."}), 500

if __name__ == '__main__':
    app.run(debug=True)