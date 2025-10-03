import datetime
import json
import os
import re
import uuid

import openai
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

# --- Database Indexes for Scale ---
entries_collection.create_index([("content", TEXT)])
entries_collection.create_index([("tags", 1)])
entries_collection.create_index([("labels", 1)])
entries_collection.create_index([("time_frame", 1), ("timestamp", -1)])

# --- Constants ---
ENTRIES_PER_PAGE = 10
TIME_FRAMES = ["Early Childhood (0-6)", "School Years (7-17)", "Young Adulthood (18-29)", "Establishment (30-49)", "Midlife Reflection (50-65)", "Later Years (65+)", "Other/Unspecified"]
STORY_TONES = ["Nostalgic & Warm", "Comedic Monologue", "Hardboiled Detective", "Documentary Narrator", "Epic Saga"]

# --- AI Helper Function ---
def get_ai_follow_ups(time_frame, original_prompt, entry_content):
    if not openai.api_key: return []
    try:
        system_prompt = "You are a helpful assistant who generates insightful, open-ended follow-up questions to encourage deeper storytelling for an autobiography. Based on the user's response to a prompt, generate exactly 3 distinct questions. Return the questions as a JSON array of strings."
        user_prompt = f"Context:\n- Life Stage: \"{time_frame}\"\n- Original Prompt: \"{original_prompt}\"\n\nUser's Latest Response:\n\"{entry_content}\"\n\nGenerate 3 follow-up questions."
        completion = openai.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}], response_format={"type": "json_object"})
        questions_data = json.loads(completion.choices[0].message.content)
        return questions_data.get('questions', [])
    except Exception as e:
        print(f"Error calling OpenAI for follow-ups: {e}")
        return []

# --- Routes ---
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
    data = request.get_json()
    content, time_frame, tags_string = data.get('content', '').strip(), data.get('time_frame'), data.get('tags', '').strip()
    invite_token, active_prompt = data.get('invite_token'), data.get('active_prompt')

    if not content or not time_frame: return jsonify({"status": "error", "message": "Missing content or time-frame"}), 400

    tags = sorted(list(set([tag.strip() for tag in tags_string.split(',') if tag.strip()]))) if tags_string else []
    
    new_follow_ups, contributor_label, labels = [], 'Me', []
    if invite_token:
        invited_user = invited_users_collection.find_one({"token": invite_token})
        if invited_user:
            contributor_label = invited_user['label']
            time_frame = invited_user['time_frame']
            labels = invited_user.get('labels', [])
            new_follow_ups = get_ai_follow_ups(time_frame, active_prompt or invited_user.get('prompt', ''), content)
            invited_users_collection.update_one({"token": invite_token}, {"$set": {"last_suggested_questions": new_follow_ups}})
    
    new_entry_doc = {'content': content, 'timestamp': datetime.datetime.utcnow(), 'time_frame': time_frame,
                     'contributor_label': contributor_label, 'prompt_token': invite_token, 'answered_prompt': active_prompt,
                     'tags': tags, 'labels': labels}
    result = entries_collection.insert_one(new_entry_doc)
    new_entry_doc['_id'] = str(result.inserted_id)
    new_entry_doc['formatted_timestamp'] = new_entry_doc['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
    
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