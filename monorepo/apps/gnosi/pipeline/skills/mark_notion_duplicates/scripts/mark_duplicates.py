#!/usr/bin/env python3
"""
mark_duplicates.py
------------------
Connects to Notion 'Recursos' database, finds duplicate titles (normalized),
and marks the 'Duplicat' checkbox property.
"""

import os
import sys
import unicodedata
import time
from collections import defaultdict
from pathlib import Path
from dotenv import load_dotenv
from notion_client import Client

# Add pipeline to path to import config if needed, but we try to be standalone/robust first
# ensuring we load the correct envs
PROJECT_ROOT = Path(__file__).resolve().parents[7] # monorepo/apps/digital-brain/pipeline/skills/mark_notion_duplicates/scripts -> ... -> Projectes
ENV_SHARED = PROJECT_ROOT / ".env_shared" 
ENV_LOCAL = Path(__file__).resolve().parents[5] / ".env" # pipeline/.env ?? No, monorepo/apps/digital-brain/.env

def load_env_variables():
    """Loads environment variables from .env_shared and local .env"""
    if.env_shared.exists():
        load_dotenv.env_shared)
        print(f"Loaded shared env: .env_shared}")
    else:
        print(f"Warning: Shared .env not found at .env_shared}")

    # Local .env inside monorepo/apps/digital-brain/
    # The script is in .../pipeline/skills/mark_notion_duplicates/scripts
    # App root is .../monorepo/apps/digital-brain
    app_root = Path(__file__).resolve().parents[4]
    env_local = app_root / ".env"
    
    if env_local.exists():
        load_dotenv(env_local, override=True)
        print(f"Loaded local env: {env_local}")
    else:
        print(f"Warning: Local .env not found at {env_local}")

def normalize_text(text: str) -> str:
    """
    Normalizes text: lowercase, remove accents, strip.
    """
    if not text:
        return ""
    
    # 1. Lowercase
    text = text.lower()
    
    # 2. NFD Normalization (remove accents)
    text = unicodedata.normalize('NFD', text)
    text = "".join(c for c in text if unicodedata.category(c) != 'Mn')
    
    # 3. Strip whitespace
    text = text.strip()
    
    return text

def get_property_value(page: dict, prop_name: str):
    """Safely extracts value from a property, handling different types."""
    props = page.get("properties", {})
    if prop_name not in props:
        return None
        
    prop = props[prop_name]
    ptype = prop.get("type")
    
    if ptype == "title":
        content = prop.get("title", [])
        return "".join([t.get("plain_text", "") for t in content])
    elif ptype == "rich_text":
        content = prop.get("rich_text", [])
        return "".join([t.get("plain_text", "") for t in content])
    elif ptype == "checkbox":
        return prop.get("checkbox")
    
    return None

def find_title_property_key(properties: dict) -> str:
    """Finds the confirmed title property key"""
    candidates = ["Name", "Title", "Títol", "Nota", "Nom", "Título"]
    for c in candidates:
        if c in properties and properties[c]["type"] == "title":
            return c
    # Fallback: iterate
    for k, v in properties.items():
        if v["type"] == "title":
            return k
    return "Name" # Default

def main():
    load_env_variables()
    
    token = os.environ.get("NOTION_TOKEN")
    # Prioritize 'Recursos' database as requested
    db_id = os.environ.get("NOTION_DB_RECURS") or os.environ.get("DATABASE_ID")
    
    if not token:
        print("❌ Error: NOTION_TOKEN not found in environment.")
        return
    if not db_id:
        print("❌ Error: NOTION_DB_RECURS or DATABASE_ID not found in environment.")
        return

    print("Initializing Notion Client...")
    notion = Client(auth=token)
    
    # 1. Fetch ALL pages
    print(f"Querying database {db_id}...")
    all_pages = []
    has_more = True
    start_cursor = None
    
    try:
        while has_more:
            response = notion.databases.query(
                database_id=db_id,
                start_cursor=start_cursor,
                page_size=100
            )
            results = response.get("results", [])
            all_pages.extend(results)
            has_more = response.get("has_more")
            start_cursor = response.get("next_cursor")
            print(f"  Fetched {len(results)} pages... (Total: {len(all_pages)})")
            
    except Exception as e:
        print(f"❌ Error querying Notion: {e}")
        return

    if not all_pages:
        print("No pages found.")
        return

    # 2. Identify Metadata from first page
    first_page = all_pages[0]
    props = first_page.get("properties", {})
    title_key = find_title_property_key(props)
    
    duplicat_key = "Duplicat"
    # Verify 'Duplicat' exists
    if duplicat_key not in props:
        print(f"⚠️  Property '{duplicat_key}' not found. Creating it...")
        try:
             notion.databases.update(
                 database_id=db_id,
                 properties={
                     duplicat_key: {"checkbox": {}}
                 }
             )
             print(f"✅ Property '{duplicat_key}' created successfully.")
             # Update duplicates logic will now use this key
        except Exception as e:
            print(f"❌ Failed to create property '{duplicat_key}': {e}")
            return

    print(f"Using Title Key: '{title_key}'")
    print(f"Using Mark Key: '{duplicat_key}'")

    # 3. Group by Normalized Title
    print("Analyzing duplicates...")
    title_map = defaultdict(list)
    
    for page in all_pages:
        raw_title = get_property_value(page, title_key)
        norm_title = normalize_text(raw_title)
        
        if not norm_title:
            continue # Skip empty titles
            
        title_map[norm_title].append(page)

    # 4. Mark Duplicates
    duplicates_found = 0
    updates_made = 0
    
    for norm_title, pages in title_map.items():
        if len(pages) > 1:
            duplicates_found += 1
            print(f"Found Duplicate: '{norm_title}' ({len(pages)} instances)")
            
            for page in pages:
                page_id = page["id"]
                current_val = get_property_value(page, duplicat_key)
                
                if current_val is True:
                    # Already marked
                    continue
                
                # Mark it
                print(f"  -> Marking page {page_id}...")
                try:
                    notion.pages.update(
                        page_id=page_id,
                        properties={
                            duplicat_key: {"checkbox": True}
                        }
                    )
                    updates_made += 1
                    # Avoid rate limits
                    time.sleep(0.4) 
                except Exception as e:
                    print(f"  ❌ Failed to update page {page_id}: {e}")

    print("-" * 30)
    print(f"Analysis Complete.")
    print(f"Duplicate Groups: {duplicates_found}")
    print(f"Pages Updated: {updates_made}")

if __name__ == "__main__":
    main()
