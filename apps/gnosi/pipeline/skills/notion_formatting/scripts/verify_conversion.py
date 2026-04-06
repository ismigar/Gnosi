#!/usr/bin/env python3
"""
verify_conversion.py
--------------------
Reads a Notion Page, converts to Markdown, and parses back to Blocks headers/paragraphs.
Writes the result to a new Page in the same parent database (or sandbox).
Validates if formatting is preserved.
"""
import sys
import re
import os
import json
from typing import List, Dict, Any

# Adjust path to import pipeline modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../..")))
from pipeline.notion_api import extract_content_and_mentions, create_page, retrieve_page

# --- REPLICATE JS LOGIC IN PYTHON FOR VERIFICATION ---
# This mirrors what we will put in n8n's TranlationUnpaker

def markdown_to_rich_text(text: str) -> List[Dict]:
    """
    Parses markdown string into Notion rich_text objects.
    Supports **bold**, _italic_, `code`, [link](url).
    """
    if not text:
        return []
    
    parts = []
    # Regex to capture markdown tokens
    # Note: simple parser, does not support nested styles or complex nesting
    pattern = r'(\*\*.*?\*\*|_.*?_|`.*?`|\[.*?\]\(.*?\))'
    
    # Split by tokens. Split result keeps matches because pattern has capturing group.
    tokens = re.split(pattern, text)
    
    for token in tokens:
        if not token:
            continue
            
        rich_text = {
            "type": "text",
            "text": {"content": ""}
        }
        
        if token.startswith("**") and token.endswith("**"):
            rich_text["text"]["content"] = token[2:-2]
            rich_text["annotations"] = {"bold": True}
        elif (token.startswith("_") and token.endswith("_")):
            rich_text["text"]["content"] = token[1:-1]
            rich_text["annotations"] = {"italic": True}
        elif token.startswith("`") and token.endswith("`"):
            rich_text["text"]["content"] = token[1:-1]
            rich_text["annotations"] = {"code": True}
        elif token.startswith("[") and "]" in token and "(" in token and token.endswith(")"):
            # Link [text](url)
            match = re.match(r"\[(.*?)\]\((.*?)\)", token)
            if match:
                rich_text["text"]["content"] = match.group(1)
                rich_text["text"]["link"] = {"url": match.group(2)}
            else:
                rich_text["text"]["content"] = token # Fallback
        else:
            # Plain Text
            rich_text["text"]["content"] = token
            
        parts.append(rich_text)
        
    return parts

def markdown_to_blocks(markdown_text: str) -> List[Dict]:
    """
    Converts full markdown text into Notion Blocks.
    """
    blocks = []
    lines = markdown_text.split('\n')
    
    buffer_list = [] # For list items grouping if needed, but simple block mapping here
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        block_type = "paragraph"
        content = line
        
        if line.startswith("# "):
            block_type = "heading_1"
            content = line[2:]
        elif line.startswith("## "):
            block_type = "heading_2"
            content = line[3:]
        elif line.startswith("### "):
            block_type = "heading_3"
            content = line[4:]
        elif line.startswith("- ") or line.startswith("* "):
            block_type = "bulleted_list_item"
            content = line[2:]
        elif re.match(r"^\d+\.\s", line):
            block_type = "numbered_list_item"
            content = re.sub(r"^\d+\.\s", "", line)
        elif line.startswith("> "):
            block_type = "quote"
            content = line[2:]
        elif line == "---":
            blocks.append({"object": "block", "type": "divider", "divider": {}})
            continue
            
        rich_text = markdown_to_rich_text(content)
        
        blocks.append({
            "object": "block",
            "type": block_type,
            block_type: {
                "rich_text": rich_text
            }
        })
        
    return blocks

# --- MAIN VERIFICATION LOGIC ---

def verify_fidelity(source_page_id: str):
    print(f"Reading Page: {source_page_id}...")
    
    # 1. READ & CONVERT TO MD
    # Using existing pipeline logic
    text_plain, text_md, mentions = extract_content_and_mentions(source_page_id)
    
    print("\n--- EXTRACTED MARKDOWN ---")
    print(text_md[:500] + "..." if len(text_md) > 500 else text_md)
    print("--------------------------\n")
    
    # 2. PARSE BACK TO BLOCKS
    print("Parsing back to blocks...")
    reconstructed_blocks = markdown_to_blocks(text_md)
    
    # 3. WRITE TO NOTION (Test Page)
    print("Creating verification page...")
    try:
        # We need a parent DB. We'll use the one from env if available, or try to find one.
        # For safety/sandbox, we might want to just append to the source page? No, risk of pollution.
        # We'll default to creating a subpage if possible? No, pages must maintain parent hierarchy.
        
        # Hack: Get parent of source page
        source_page = retrieve_page(source_page_id)
        parent = source_page.get("parent")
        
        # Safe Title Extraction
        props = source_page.get("properties", {})
        title_str = "Untitled"
        if "Name" in props and props["Name"].get("title"):
             title_str = props["Name"]["title"][0]["plain_text"]
        elif "Títol" in props and props["Títol"].get("title"):
             title_str = props["Títol"]["title"][0]["plain_text"]
        elif "title" in props and props["title"].get("title"): # Generic
             title_str = props["title"]["title"][0]["plain_text"]
             
        # Detect correct Title Property Name from Database
        target_title_key = "Name"
        if parent["type"] == "database_id":
             from pipeline.notion_api import notion
             db_meta = notion.databases.retrieve(parent["database_id"])
             for pname, pdef in db_meta["properties"].items():
                 if pdef["type"] == "title":
                     target_title_key = pname
                     break
        
        new_page_props = {
            target_title_key: {"title": [{"text": {"content": "Verification: " + title_str}}]}
        }
        
        print(f"Creating page with title property: '{target_title_key}'")

        # We assume parent is database
        if parent["type"] == "database_id":
             new_page = notion.pages.create(
                 parent=parent,
                 properties=new_page_props,
                 children=reconstructed_blocks[:100] if reconstructed_blocks else []
             )
             print(f"✅ Verification Page Created successfully! ID: {new_page['id']}")
             print(f"🔗 URL: {new_page['url']}")
        else:
            print("❌ Source page parent is not a database, skipping write test.")
            
    except Exception as e:
        print(f"❌ Write failed: {e}")
        if reconstructed_blocks:
             print("First block:", json.dumps(reconstructed_blocks[0], indent=2))
        else:
             print("No blocks reconstructed (Markdown was empty?)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: verify_conversion.py <PAGE_ID>")
        sys.exit(1)
    
    verify_fidelity(sys.argv[1])
