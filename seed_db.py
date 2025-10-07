import datetime
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
invited_users_collection = db['invited_users'] # For completeness, though we won't seed this heavily

def seed_database():
    """
    Clears existing data and populates the database with sample users,
    projects, and notes for testing and demonstration.
    """
    print("--- Starting Database Seeding ---")

    # --- 1. Clear Existing Data ---
    print("Clearing existing collections...")
    users_collection.delete_many({})
    projects_collection.delete_many({})
    notes_collection.delete_many({})
    invited_users_collection.delete_many({})
    print("Collections cleared.")

    # --- 2. Create Sample Users ---
    print("Creating sample users...")
    user1_id = users_collection.insert_one({
        "email": "sara@example.com",
        "password": generate_password_hash("password123", method='pbkdf2:sha256')
    }).inserted_id

    user2_id = users_collection.insert_one({
        "email": "john@example.com",
        "password": generate_password_hash("password456", method='pbkdf2:sha256')
    }).inserted_id
    print(f"Created 2 users: Sara (ID: {user1_id}) and John (ID: {user2_id})")

    # --- 3. Create Sample Projects for Each User ---
    print("Creating sample projects...")
    # Sara's Projects
    sara_project1_id = projects_collection.insert_one({
        "user_id": user1_id,
        "name": "Grandma's Biography",
        "project_goal": "To collect memories and stories about Grandma Helen's life for her 90th birthday.",
        "created_at": datetime.datetime.utcnow() - datetime.timedelta(days=10)
    }).inserted_id

    sara_project2_id = projects_collection.insert_one({
        "user_id": user1_id,
        "name": "Summer Vacation '98",
        "project_goal": "A fun, nostalgic look back at the family trip to the Grand Canyon in 1998.",
        "created_at": datetime.datetime.utcnow() - datetime.timedelta(days=5)
    }).inserted_id

    # John's Projects
    john_project1_id = projects_collection.insert_one({
        "user_id": user2_id,
        "name": "Startup Idea - 'QuickMeal'",
        "project_goal": "Brainstorming and research notes for a new meal-kit delivery service app.",
        "created_at": datetime.datetime.utcnow() - datetime.timedelta(days=20)
    }).inserted_id
    print("Created 3 projects.")

    # --- 4. Create Sample Notes for Each Project ---
    print("Creating sample notes...")
    # Notes for "Grandma's Biography"
    notes_collection.insert_many([
        {
            "project_id": sara_project1_id, "user_id": user1_id, "contributor_label": "Me",
            "content": "I remember Grandma telling me about how she met Grandpa at a dance after the war. She said he was the worst dancer but had the kindest eyes.",
            "tags": ["origin story", "grandpa", "romance"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=9)
        },
        {
            "project_id": sara_project1_id, "user_id": user1_id, "contributor_label": "Uncle Bob",
            "content": "Your grandmother's baking was legendary. Her apple pie could solve any world problem. She never used a recipe, it was all by feel.",
            "tags": ["baking", "family traditions", "anecdote"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=8)
        },
        {
            "project_id": sara_project1_id, "user_id": user1_id, "contributor_label": "Me",
            "content": "Need to find photos from her time working at the factory during the 1940s. She was so proud of that work.",
            "tags": ["research", "photos", "work history"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=7)
        }
    ])

    # Notes for "Summer Vacation '98"
    notes_collection.insert_many([
        {
            "project_id": sara_project2_id, "user_id": user1_id, "contributor_label": "Me",
            "content": "The old minivan broke down just outside of Flagstaff. Dad was so mad but we ended up having the best milkshakes at that little diner while we waited.",
            "tags": ["travel", "funny story", "car trouble"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=4)
        },
        {
            "project_id": sara_project2_id, "user_id": user1_id, "contributor_label": "Me",
            "content": "I was terrified of the canyon's edge, but the view at sunset was something I'll never forget. The colors were unreal.",
            "tags": ["grand canyon", "key moment", "scenery"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=3)
        }
    ])

    # Notes for "Startup Idea - 'QuickMeal'"
    notes_collection.insert_many([
        {
            "project_id": john_project1_id, "user_id": user2_id, "contributor_label": "Me",
            "content": "Competitive analysis: Blue Apron is the market leader, but their pricing is high. HelloFresh has more variety. Our angle could be 15-minute meals with a focus on local, organic suppliers.",
            "tags": ["research", "competitors", "strategy"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=19)
        },
        {
            "project_id": john_project1_id, "user_id": user2_id, "contributor_label": "Me",
            "content": "Possible tech stack: Python/Flask backend, React Native for the mobile app, Stripe for payments. Need to investigate database options - MongoDB seems flexible enough for menu and user data.",
            "tags": ["technical", "app development"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=15)
        },
        {
            "project_id": john_project1_id, "user_id": user2_id, "contributor_label": "Me",
            "content": "Marketing ideas: Target young professionals and busy families. Influencer marketing on Instagram and TikTok could be effective. Partnership with local farms for cross-promotion.",
            "tags": ["marketing", "ideas"], "timestamp": datetime.datetime.utcnow() - datetime.timedelta(days=12)
        }
    ])
    print("Created 8 sample notes across projects.")

    print("\n--- ✅ Database Seeding Complete! ---")
    print("\nSample User Credentials:")
    print("  User 1 -> Email: sara@example.com | Password: password123")
    print("  User 2 -> Email: john@example.com  | Password: password456")

if __name__ == '__main__':
    seed_database()