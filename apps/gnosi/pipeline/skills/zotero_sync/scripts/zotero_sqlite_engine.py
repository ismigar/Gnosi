import sqlite3
import os
import shutil
import json
from pathlib import Path
from datetime import datetime

# =============================================================================
# CONFIGURATION
# =============================================================================
ZOTERO_DB_PATH = os.path.expanduser("~/Zotero/zotero.sqlite")
TEMP_DB_PATH = "/tmp/zotero_sync_engine.sqlite"
OUTPUT_PATH = Path("output/zotero_items.json")

def get_connection():
    """Safety copy and connect to SQLite."""
    if not os.path.exists(ZOTERO_DB_PATH):
        raise FileNotFoundError(f"Zotero DB not found at {ZOTERO_DB_PATH}")
    shutil.copy2(ZOTERO_DB_PATH, TEMP_DB_PATH)
    return sqlite3.connect(TEMP_DB_PATH)

def fetch_zotero_items(conn):
    """
    Complex query to extract metadata, tags, and notes.
    Zotero Schema:
    - items: core table
    - itemData & itemDataValues: key-value pairs for fields (title, date, etc)
    - tags: many-to-many relationship
    """
    cursor = conn.cursor()
    
    # 1. Fetch all items (excluding attachments like PDFs and notes themselves initially)
    # Item types: 1=Artwork, 2=AudioRecording, 3=Bill... 11=Book... 14=Case... 25=JournalArticle, etc.
    # We exclude 1 (attachment) and 14 (note) from top-level nodes if we want them as properties.
    items_query = """
    SELECT i.itemID, i.key, it.typeName, i.dateAdded, i.dateModified
    FROM items i
    JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
    WHERE it.typeName NOT IN ('attachment', 'note')
    """
    cursor.execute(items_query)
    items = cursor.fetchall()

    results = []

    for item_id, item_key, type_name, date_added, date_modified in items:
        # 2. Fetch all data fields for this item
        data_query = """
        SELECT f.fieldName, dv.value
        FROM itemData id
        JOIN fields f ON id.fieldID = f.fieldID
        JOIN itemDataValues dv ON id.valueID = dv.valueID
        WHERE id.itemID = ?
        """
        cursor.execute(data_query, (item_id,))
        fields = dict(cursor.fetchall())

        # 3. Fetch tags
        tags_query = """
        SELECT t.name
        FROM itemTags it
        JOIN tags t ON it.tagID = t.tagID
        WHERE it.itemID = ?
        """
        cursor.execute(tags_query, (item_id,))
        tags = [t[0] for t in cursor.fetchall()]

        # 4. Fetch child notes (Anotacions)
        notes_query = """
        SELECT n.note
        FROM itemNotes n
        JOIN items i ON n.itemID = i.itemID
        WHERE i.parentItemID = ?
        """
        cursor.execute(notes_query, (item_id,))
        child_notes = [n[0] for n in cursor.fetchall()]

        # 5. Extract Authors (Creators)
        creators_query = """
        SELECT c.firstName, c.lastName
        FROM itemCreators ic
        JOIN creators c ON ic.creatorID = c.creatorID
        WHERE ic.itemID = ?
        ORDER BY ic.orderIndex
        """
        cursor.execute(creators_query, (item_id,))
        creators = [f"{c[0]} {c[1]}".strip() for c in cursor.fetchall()]

        node = {
            "id": f"zotero::{item_key}",
            "zotero_key": item_key,
            "titulo": fields.get("title", "Untitled"),
            "tipo": type_name,
            "creators": creators,
            "tags": [{"name": t, "color": "default"} for t in tags],
            "contenido": "\n\n".join(child_notes) + f"\n\nAbstract: {fields.get('abstractNote', '')}",
            "url": fields.get("url", ""),
            "date": fields.get("date", ""),
            "created_time": date_added,
            "modified_time": date_modified,
            "source": "zotero"
        }
        results.append(node)

    return results

def sync():
    print(f"🔄 Starting Zotero Local Sync...")
    try:
        conn = get_connection()
        items = fetch_zotero_items(conn)
        conn.close()
        
        # Save results
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
            
        print(f"✅ Sync completed. {len(items)} items processed.")
        print(f"📂 Data saved to {OUTPUT_PATH}")
        
    except Exception as e:
        print(f"❌ Sync failed: {e}")
    finally:
        if os.path.exists(TEMP_DB_PATH):
            os.remove(TEMP_DB_PATH)

if __name__ == "__main__":
    sync()
