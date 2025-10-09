import datetime
import uuid
from pymongo import MongoClient
from bson.objectid import ObjectId
from werkzeug.security import generate_password_hash
import os

# --- Configuration ---
# Use the same MONGO_URI as your main app
MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/?retryWrites=true&w=majority&directConnection=true')
client = MongoClient(MONGO_URI)
db = client['story_weaver_auth']  # Ensure this matches the database name in app.py

# --- Get Collections ---
users_collection = db['users']
projects_collection = db['projects']
notes_collection = db['notes']
invited_users_collection = db['invited_users']
shared_invites_collection = db['shared_invites']
quizzes_collection = db['quizzes']


def seed_database():
    """
    Clears existing data and populates the database with a rich set of sample users,
    projects, notes, invites, and quizzes for comprehensive testing.
    """
    print("--- 🎬 Starting Database Seeding ---")

    # --- 1. Clear Existing Data ---
    print("🧹 Clearing all collections...")
    users_collection.delete_many({})
    projects_collection.delete_many({})
    notes_collection.delete_many({})
    invited_users_collection.delete_many({})
    shared_invites_collection.delete_many({})
    quizzes_collection.delete_many({})
    print("Collections cleared.")

    # --- 2. Create Sample Users ---
    print("👤 Creating sample users...")
    user1_id = users_collection.insert_one({
        "email": "sara@example.com",
        "password": generate_password_hash("password123", method='pbkdf2:sha256')
    }).inserted_id

    user2_id = users_collection.insert_one({
        "email": "john@example.com",
        "password": generate_password_hash("password456", method='pbkdf2:sha256')
    }).inserted_id
    
    user3_id = users_collection.insert_one({
        "email": "admin@example.com",
        "password": generate_password_hash("adminpass", method='pbkdf2:sha256')
    }).inserted_id
    print(f"Created 3 users: Sara (ID: {user1_id}), John (ID: {user2_id}), Admin (ID: {user3_id})")

    # --- 3. Create Sample Projects for Each User ---
    print("📚 Creating sample projects...")
    
    # --- FIX: Use datetime.utcnow() for reliable date creation ---
    now = datetime.datetime.utcnow()

    sara_project1_id = projects_collection.insert_one({
        "user_id": user1_id, "name": "Grandma's Biography",
        "project_goal": "To collect memories and stories about Grandma Helen's life for her 90th birthday.",
        "project_type": "story", "created_at": now - datetime.timedelta(days=10)
    }).inserted_id

    sara_project2_id = projects_collection.insert_one({
        "user_id": user1_id, "name": "Biology 101 Midterm Prep",
        "project_goal": "To master key concepts for the upcoming biology midterm, focusing on cellular processes.",
        "project_type": "study", "created_at": now - datetime.timedelta(days=5)
    }).inserted_id

    john_project1_id = projects_collection.insert_one({
        "user_id": user2_id, "name": "Sci-Fi Novel: 'The Last Signal'",
        "project_goal": "World-building notes, character backstories, and plot outlines for my new science fiction novel.",
        "project_type": "story", "created_at": now - datetime.timedelta(days=20)
    }).inserted_id

    admin_project1_id = projects_collection.insert_one({
        "user_id": user3_id, "name": "Company History Archives",
        "project_goal": "A central repository for key milestones and historical documents of the company.",
        "project_type": "story", "created_at": now - datetime.timedelta(days=60)
    }).inserted_id
    print("Created 4 projects (3 story, 1 study).")

    # --- 4. Create Sample Notes for Each Project ---
    print("📝 Creating sample notes...")
    
    notes_collection.insert_many([
        {
            "project_id": sara_project1_id, "user_id": user1_id, "contributor_label": "Me",
            "content": "I remember Grandma telling me about how she met Grandpa at a dance after the war. She said he was the worst dancer but had the kindest eyes.",
            "tags": ["origin story", "grandpa", "romance"], "timestamp": now - datetime.timedelta(days=9)
        },
        {
            "project_id": sara_project1_id, "user_id": user1_id, "contributor_label": "Uncle Bob",
            "content": "Your grandmother's baking was legendary. Her apple pie could solve any world problem. She never used a recipe, it was all by feel.",
            "tags": ["baking", "family traditions", "anecdote"], "timestamp": now - datetime.timedelta(days=8)
        }
    ])

    biology_notes = [
        {"project_id": sara_project2_id, "user_id": user1_id, "contributor_label": "AI Assistant", "content": "**Mitochondria**: Often called the 'powerhouse of the cell,' this organelle is responsible for generating most of the cell's supply of adenosine triphosphate (ATP).", "tags": ["ai-generated", "organelles"], "timestamp": now - datetime.timedelta(days=4)},
        {"project_id": sara_project2_id, "user_id": user1_id, "contributor_label": "AI Assistant", "content": "**Photosynthesis**: The process used by plants to convert light energy into chemical energy, creating glucose and oxygen.", "tags": ["ai-generated", "plant-biology"], "timestamp": now - datetime.timedelta(days=4, hours=1)},
        {"project_id": sara_project2_id, "user_id": user1_id, "contributor_label": "Me", "content": "Remember the stages of Mitosis: Prophase, Metaphase, Anaphase, Telophase. Acronym: PMAT.", "tags": ["mnemonic", "cell-division"], "timestamp": now - datetime.timedelta(days=3)},
    ]
    result = notes_collection.insert_many(biology_notes)
    biology_note_ids = result.inserted_ids

    notes_collection.insert_many([
        {"project_id": john_project1_id, "user_id": user2_id, "contributor_label": "Me", "content": "Planet Xylos: A tidally locked planet. One side is perpetually scorched desert, the other a frozen wasteland. Life exists only in the 'Twilight Zone' between them.", "tags": ["world-building", "setting", "xylos"], "timestamp": now - datetime.timedelta(days=19)},
        {"project_id": john_project1_id, "user_id": user2_id, "contributor_label": "Me", "content": "Captain Eva Rostova: Former military pilot, disgraced after a controversial mission. Now captains a small smuggling ship, 'The Nomad'. Motivation: to find her missing brother.", "tags": ["character", "protagonist", "eva-rostova"], "timestamp": now - datetime.timedelta(days=15)},
        {"project_id": john_project1_id, "user_id": user2_id, "contributor_label": "Guest Writer", "content": "Idea from the share link: What if the 'Twilight Zone' has strange, crystalline flora that hums with a low-level psychic energy?", "tags": ["brainstorm", "flora", "psychic"], "timestamp": now - datetime.timedelta(days=1)},
    ])
    print("Created sample notes across projects.")
    
    # --- 5. Create Sample Invites ---
    print("💌 Creating sample invites...")
    
    invited_users_collection.insert_one({
        "token": str(uuid.uuid4()), "label": "Uncle Bob",
        "project_id": sara_project1_id, "prompt": "What's your favorite memory of mom's baking?",
        "created_at": now - datetime.timedelta(days=9)
    })

    shared_invites_collection.insert_one({
        "token": str(uuid.uuid4()), "project_id": john_project1_id,
        "user_id": user2_id, "prompt": "I'm looking for cool sci-fi ideas for my new book! What's a unique concept for a planet or alien species you can think of?",
        "created_at": now - datetime.timedelta(days=2)
    })
    print("Created 1 single-person invite and 1 public shareable link.")

    # --- 6. Create Sample Quizzes ---
    print("🧠 Creating sample quizzes...")
    
    quizzes_collection.insert_one({
        "user_id": user1_id, "project_id": sara_project2_id, "title": "Cellular Organelles Quiz (MC)",
        "question_type": "Multiple Choice", "created_at": now - datetime.timedelta(days=2), "share_token": str(uuid.uuid4()),
        "quiz_data": [
            {"question": "Which organelle is known as the 'powerhouse of the cell'?", "options": ["Ribosome", "Nucleus", "Mitochondria", "Golgi Apparatus"], "correct_answer_index": 2},
            {"question": "What is the primary function of a Ribosome?", "options": ["Energy production", "Protein synthesis", "Waste disposal", "Cellular transport"], "correct_answer_index": 1}
        ],
        "source_note_ids": biology_note_ids,
    })

    quizzes_collection.insert_one({
        "user_id": user1_id, "project_id": sara_project2_id, "title": "Key Biology Concepts (T/F)",
        "question_type": "True/False", "created_at": now - datetime.timedelta(days=1), "share_token": str(uuid.uuid4()),
        "quiz_data": [
            {"question": "Photosynthesis converts chemical energy into light energy.", "answer": False},
            {"question": "ATP is the main energy currency of the cell.", "answer": True}
        ],
        "source_note_ids": [biology_note_ids[0], biology_note_ids[1]],
    })
    print("Created 2 sample quizzes for the Biology project.")

    print("\n" + "="*40)
    print("--- ✅ Database Seeding Complete! ---")
    print("="*40)
    print("\nSample User Credentials:")
    print("  - Sara:   sara@example.com  | password123")
    print("  - John:   john@example.com  | password456")
    print("  - Admin:  admin@example.com | adminpass")
    print("\nRun the Flask app and log in to explore the seeded data.")

if __name__ == '__main__':
    seed_database()

