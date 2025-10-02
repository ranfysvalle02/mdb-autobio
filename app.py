# app.py

from flask import Flask, render_template, request, jsonify
from pymongo import MongoClient
import datetime
import os

app = Flask(__name__)

# --- Configuration ---
# Use environment variable for connection string if available, otherwise default to local
MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/?retryWrites=true&w=majority&directConnection=true')
client = MongoClient(MONGO_URI)
db = client['autobiography_journal']
entries_collection = db['entries']

# Define how many entries to show per page for pagination
ENTRIES_PER_PAGE = 10

# --- Time-Frame Definition ---
# Logical/reasonable parts of a person's life for selection
TIME_FRAMES = [
    "Early Childhood (0-6)",
    "School Years (7-17)",
    "Young Adulthood (18-29)",
    "Establishment (30-49)",
    "Midlife Reflection (50-65)",
    "Later Years (65+)",
    "Other/Unspecified" # For flexibility
]

# --- Routes ---

@app.route('/')
def index():
    """
    Serves the main page. Fetches the first page of journal entries
    from MongoDB and renders them into the template. Also passes the
    list of time frames for dropdown/filtering.
    """
    # Sort entries by timestamp in descending order (newest first)
    # and limit to the first page.
    latest_entries = list(entries_collection.find().sort("timestamp", -1).limit(ENTRIES_PER_PAGE))
    
    # Format the timestamp for display before sending to the template
    for entry in latest_entries:
        entry['formatted_timestamp'] = entry['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
        # Ensure time_frame exists, or default
        entry['time_frame'] = entry.get('time_frame', 'Unspecified')

    return render_template('index.html', entries=latest_entries, time_frames=TIME_FRAMES)


@app.route('/add', methods=['POST'])
def add_entry():
    """
    Handles saving a new journal entry to the database, including the time_frame.
    """
    data = request.get_json()
    
    # Validate required fields
    if not data or 'content' not in data or 'time_frame' not in data:
        return jsonify({"status": "error", "message": "Missing content or time-frame"}), 400

    content = data['content'].strip()
    time_frame = data['time_frame']
    
    if not content:
        return jsonify({"status": "error", "message": "Content cannot be empty"}), 400
        
    # Optional: Basic validation to ensure the time_frame is one of the defined options
    if time_frame not in TIME_FRAMES:
        # Default to 'Other/Unspecified' if an invalid one is sent
        time_frame = "Other/Unspecified" 

    new_entry = {
        'content': content,
        'timestamp': datetime.datetime.utcnow(),
        'time_frame': time_frame # NEW FIELD
    }
    
    result = entries_collection.insert_one(new_entry)
    
    # Return the newly created entry, including its formatted timestamp and time_frame
    return jsonify({
        "status": "success",
        "entry": {
            "_id": str(result.inserted_id),
            "content": new_entry['content'],
            "time_frame": new_entry['time_frame'], # NEW FIELD
            "formatted_timestamp": new_entry['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
        }
    }), 201


@app.route('/entries')
def get_entries():
    """
    API endpoint for fetching additional pages of entries (for infinite scroll).
    Allows an optional 'time_frame_filter' query parameter.
    """
    try:
        page = int(request.args.get('page', 1))
    except ValueError:
        page = 1
        
    time_frame_filter = request.args.get('filter') # Get optional filter query parameter
    
    # Build the MongoDB query filter
    query = {}
    if time_frame_filter and time_frame_filter in TIME_FRAMES:
        query['time_frame'] = time_frame_filter
        
    # Calculate how many documents to skip
    skip_amount = (page - 1) * ENTRIES_PER_PAGE
    
    # Find entries based on the query, then sort, skip, and limit
    entries_cursor = entries_collection.find(query).sort("timestamp", -1).skip(skip_amount).limit(ENTRIES_PER_PAGE)
    
    entries = []
    for entry in entries_cursor:
        entries.append({
            "content": entry['content'],
            "time_frame": entry.get('time_frame', 'Unspecified'), # NEW FIELD
            "formatted_timestamp": entry['timestamp'].strftime('%B %d, %Y, %-I:%M %p')
        })

    return jsonify(entries)

if __name__ == '__main__':
    app.run(debug=True)