import os
import time
from pymongo import MongoClient
from pymongo.errors import OperationFailure
from dotenv import load_dotenv

# --- Configuration ---
# Load environment variables from a .env file
load_dotenv()

# Get connection string and index names from environment
MONGO_URI = os.environ.get('MONGO_URI')
ATLAS_VECTOR_SEARCH_INDEX_NAME = os.environ.get('ATLAS_VECTOR_SEARCH_INDEX_NAME', 'default_vector_index')
ATLAS_LUCENE_INDEX_NAME = "notes_text_search"

if not MONGO_URI:
    print("❌ ERROR: MONGO_URI environment variable not set. Please create a .env file.")
    exit(1)

# --- Database Connection ---
print("➡️ Connecting to MongoDB Atlas...")
try:
    client = MongoClient(MONGO_URI)
    db = client['story_weaver_auth'] # Use the same database name as your app
    notes_collection = db['notes']
    # The ismaster command is cheap and does not require auth.
    client.admin.command('ismaster')
    print("✅ Successfully connected to MongoDB.")
except Exception as e:
    print(f"❌ Failed to connect to MongoDB: {e}")
    exit(1)


def wait_for_index(coll, index_name: str, timeout: int = 600):
    """Polls search indexes until the specified index is ready."""
    print(f"⏳ Waiting for index '{index_name}' to be ready... (This can take several minutes)")
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            # list_search_indexes() can now accept a name parameter
            indexes = list(coll.list_search_indexes(name=index_name))
            if indexes and (indexes[0].get('status') == 'READY' or indexes[0].get('queryable') == True):
                print(f"✅ Index '{index_name}' is ready.")
                return True
            print(f"   - Index '{index_name}' not ready yet. Status: {indexes[0].get('status', 'Unknown')}. Checking again in 10 seconds...")
            time.sleep(10)
        except OperationFailure as e:
            print(f"   - OperationFailure while checking index status: {e.details}. Retrying...")
            time.sleep(10)
        except IndexError:
            # This can happen if the index hasn't been recognized by the API yet
            print(f"   - Index '{index_name}' not found in list. It might still be provisioning. Retrying...")
            time.sleep(10)

    raise TimeoutError(f"❌ Index '{index_name}' did not become ready in {timeout}s.")


def ensure_atlas_indexes():
    """Checks for, creates, and waits for both the Atlas Vector and Lucene Search indexes."""
    print("\n--- Starting Atlas Search Index Check ---")
    try:
        existing_indexes = list(notes_collection.list_search_indexes())
        existing_names = {index['name'] for index in existing_indexes}
        print(f"ℹ️ Found existing search indexes: {existing_names or 'None'}")

        # --- Vector Search Index ---
        if ATLAS_VECTOR_SEARCH_INDEX_NAME not in existing_names:
            print(f"\n⚠️ Atlas Vector Search index '{ATLAS_VECTOR_SEARCH_INDEX_NAME}' not found. Creating it...")
            vector_index_definition = {
                "name": ATLAS_VECTOR_SEARCH_INDEX_NAME,
                "definition": {
                    "mappings": {
                        "dynamic": False,
                        "fields": {
                            "content": {"type": "string", "analyzer": "lucene.standard"},
                            "content_embedding": {"type": "knnVector", "similarity": "cosine", "dimensions": 1536},
                            "project_id": {"type": "objectId"},
                            "user_id": {"type": "objectId"},
                            "tags": {"type": "string", "analyzer": "lucene.keyword"}
                        }
                    }
                }
            }
            notes_collection.create_search_index(model=vector_index_definition)
            print(f"✅ Successfully initiated creation of vector index '{ATLAS_VECTOR_SEARCH_INDEX_NAME}'.")
            wait_for_index(notes_collection, ATLAS_VECTOR_SEARCH_INDEX_NAME)
        else:
            print(f"\n✅ Atlas Vector Search index '{ATLAS_VECTOR_SEARCH_INDEX_NAME}' already exists.")

        # --- Lucene (Text) Search Index ---
        if ATLAS_LUCENE_INDEX_NAME not in existing_names:
            print(f"\n⚠️ Atlas Lucene Search index '{ATLAS_LUCENE_INDEX_NAME}' not found. Creating it...")
            lucene_index_definition = {
                "name": ATLAS_LUCENE_INDEX_NAME,
                "definition": {
                    "mappings": {
                        "dynamic": False,
                        "fields": {
                            "content": {"type": "string", "analyzer": "lucene.standard"},
                            "project_id": {"type": "objectId"},
                            "user_id": {"type": "objectId"},
                            "tags": {"type": "string", "analyzer": "lucene.keyword"},
                            "timestamp": {"type": "date"},
                            "contributor_label": {"type": "string", "analyzer": "lucene.keyword"}
                        }
                    }
                }
            }
            notes_collection.create_search_index(model=lucene_index_definition)
            print(f"✅ Successfully initiated creation of lucene index '{ATLAS_LUCENE_INDEX_NAME}'.")
            wait_for_index(notes_collection, ATLAS_LUCENE_INDEX_NAME)
        else:
            print(f"\n✅ Atlas Lucene Search index '{ATLAS_LUCENE_INDEX_NAME}' already exists.")
        
        print("\n--- Index setup complete! ---")

    except Exception as e:
        print(f"\n❌ An error occurred during index checks/creation: {e}")


# --- Main Execution Block ---
if __name__ == "__main__":
    ensure_atlas_indexes()