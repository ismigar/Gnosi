#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Notion Recursive Translator (Catalan -> Spanish)
-----------------------------------------------
Traverses a page tree and translates Titles, DB Names, Properties, and Content.
WARNING: Modifies data in place.
"""

import sys
import time
from pipeline.notion_api import (
    search_object, 
    get_blocks, 
    update_block_text, 
    update_page_properties, 
    update_database,
    notion # Access to raw client for database querying if needed
)
from pipeline.ai_client import call_ai_client
from config.logger_config import setup_logging, get_logger
from typing import Dict, List, Any

setup_logging()
log = get_logger(__name__)

# Memoization to save AI calls for repeated terms (like property names)
TRANSLATION_CACHE = {}

def translate_text(text: str) -> str:
    """Translates text from CA to ES using AI."""
    if not text or text.strip().isdigit():
        return text
        
    if text in TRANSLATION_CACHE:
        return TRANSLATION_CACHE[text]
        
    prompt = (
        f"Translate the following text from Catalan to Spanish. "
        f"Keep the tone professional. Output ONLY the translation, no quotes, no explanations.\n\n"
        f"Text: {text}"
    )
    
    try:
        # Use simple non-streaming call
        translated = call_ai_client(prompt).strip()
        # Remove accidental quotes if AI adds them
        translated = translated.strip('"').strip("'")
        
        log.info(f"   🔄 '{text}' -> '{translated}'")
        TRANSLATION_CACHE[text] = translated
        return translated
    except Exception as e:
        log.error(f"AI Translation failed: {e}")
        return text # Fallback to original

def process_block(block: Dict):
    """Translates a single block content."""
    b_type = block.get("type")
    
    # Text blocks to translate
    TEXT_TYPES = {
        "paragraph", "heading_1", "heading_2", "heading_3", 
        "bulleted_list_item", "numbered_list_item", "quote", 
        "to_do", "toggle", "callout"
    }
    
    if b_type in TEXT_TYPES:
        data = block.get(b_type, {})
        rich_text = data.get("rich_text", [])
        plain_text = "".join([t.get("plain_text", "") for t in rich_text])
        
        if plain_text.strip():
            new_text = translate_text(plain_text)
            if new_text != plain_text:
                update_block_text(block["id"], new_text, b_type)
        
    # Recurse children if any
    if block.get("has_children"):
        log.info(f"   📂 Traversing children of block {block['id']}...")
        traverse_children(block["id"])
        
    # Special: Child Page or Child Database inside a block
    # (Usually they appear as block types 'child_page' / 'child_database')
    if b_type == "child_page":
        # Recurse into that page
        page_id = block["id"]
        title = block["child_page"].get("title", "")
        log.info(f"📄 Found Child Page: {title}")
        process_page(page_id, title)
        
    elif b_type == "child_database":
        db_id = block["id"]
        title = block["child_database"].get("title", "")
        log.info(f"🗄️ Found Child Database: {title}")
        process_database(db_id, title)


def traverse_children(parent_id: str):
    """Gets all children blocks and processes them."""
    children = get_blocks(parent_id) 
    for child in children:
        process_block(child)

def process_page(page_id: str, current_title: str):
    """Translates page title and traverses content."""
    # 1. Translate Title
    if current_title:
        new_title = translate_text(current_title)
        if new_title != current_title:
            update_page_properties(page_id, {
                "title": [{"text": {"content": new_title}}]
            })
            
    # 2. Traverse Content
    traverse_children(page_id)

def process_database(db_id: str, current_title: str):
    """Translates DB title, Property Names, and all Contained Pages."""
    # 1. Translate DB Title
    if current_title:
        new_title = translate_text(current_title)
        if new_title != current_title:
            update_database(db_id, title=new_title)
            
    # 2. Translate Properties (Schema)
    # Need to fetch full DB details to get properties
    try:
        db_details = notion.databases.retrieve(db_id)
        props = db_details.get("properties", {})
        
        update_props = {}
        for prop_name, prop_data in props.items():
            new_name = translate_text(prop_name)
            if new_name != prop_name:
                update_props[prop_name] = {"name": new_name}
        
        if update_props:
            log.info(f"   🛠️ Updating {len(update_props)} Schema Properties...")
            update_database(db_id, properties=update_props)
            
    except Exception as e:
        log.error(f"Failed to fetch/update DB schema: {e}")

    # 3. Traverse Pages inside DB
    # We query the DB to get all pages
    try:
        has_more = True
        next_cursor = None
        while has_more:
            res = notion.databases.query(database_id=db_id, start_cursor=next_cursor)
            rows = res.get("results", [])
            has_more = res.get("has_more")
            next_cursor = res.get("next_cursor")
            
            for row in rows:
                # Extract title safely
                # Usually Title property is "Name" or "Titulo", keys vary.
                # We need to find the property of type 'title'
                r_props = row.get("properties", {})
                p_title = ""
                for k, v in r_props.items():
                    if v["id"] == "title": # Official way to identify title prop
                        # v is like {id: 'title', type: 'title', title: [...]}
                        p_title = "".join([t.get("plain_text", "") for t in v.get("title", [])])
                        break
                
                log.info(f"   ➡️ Row: {p_title}")
                process_page(row["id"], p_title)
                
    except Exception as e:
        log.error(f"Failed to query database rows: {e}")

def main():
    # root_name = "Tableros"
    root_id = "2d7268e5-2714-81a4-8db2-e68552ebb557"
    log.info(f"🔎 Using Hardcoded Root ID: '{root_id}'...")
    
    # Check if we can fetch it to get the title
    try:
        root_page = notion.pages.retrieve(root_id)
        # results = search_object(root_name, filter_value="page") 
        # (Skipping search)
    except Exception as e:
        log.error(f"❌ Failed to retrieve root page {root_id}: {e}")
        return
        
    # root_page = results[0]
    # root_id = root_page["id"]
    
    # Extract title safely
    props = root_page.get("properties", {})
    # For a page, title is usually a property named "title" (standard) or keys inside properties
    # Just looking for 'title' type property
    current_title = ""
    for k, v in props.items():
        if v.get("type") == "title":
            current_title = "".join([t.get("plain_text", "") for t in v.get("title", [])])

    log.info(f"🎯 Found Root: {current_title} ({root_id})")
    log.info("🚀 Starting Recursive Translation (Catalan -> Spanish)...")
    
    # Start Processing
    process_page(root_id, current_title)
    
    log.info("✅ Translation Complete!")

if __name__ == "__main__":
    from typing import Dict, List, Any # Lazy import fix for signatures
    main()
