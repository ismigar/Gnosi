#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backup Notion Notes to Markdown
-------------------------------
Uses the shared pipeline cache to generate a local portfolio of Markdown files.
Resolves internal Notion links to relative file links.
"""

import os
import re
from pathlib import Path
from config.logger_config import setup_logging, get_logger
import os
import re
import sys
from pathlib import Path
from config.logger_config import setup_logging, get_logger
from config.app_config import load_params
from pipeline.notion_api import get_notes_by_type

# Setup logging
setup_logging()
log = get_logger(__name__)

# Load Config
cfg = load_params(strict_env=False)

# Config Keys
TYPE_PROP_KEYS      = cfg.notion.get("type_property")
TAGS_PROP_KEYS      = cfg.notion.get("tags_property")
LINKS_PROP_KEYS     = cfg.notion.get("links_property")
TITLE_PROP_KEYS     = cfg.notion.get("title_property")
PROJECT_KEYS        = cfg.schema_keys["PROJECT_KEYS"]
try:
    NODE_TITLE_KEYS = cfg.schema_keys["NODE_TITLE_KEYS"]
except:
    NODE_TITLE_KEYS = TITLE_PROP_KEYS

# Output Directory
BACKUP_DIR = Path("out/markdown_backup")

def get_notes_wrapper(select_type: str):
    """Wrapper to call notion_api with correct config."""
    tag_aliases = TAGS_PROP_KEYS if isinstance(TAGS_PROP_KEYS, list) else [TAGS_PROP_KEYS]
    links_aliases = LINKS_PROP_KEYS if isinstance(LINKS_PROP_KEYS, list) else [LINKS_PROP_KEYS]
    
    return get_notes_by_type(
        tipo_select=select_type,
        type_property_name=TYPE_PROP_KEYS,
        title_aliases=NODE_TITLE_KEYS,
        tag_aliases=tag_aliases,
        project_aliases=PROJECT_KEYS,
        links_aliases=links_aliases
    )

def sanitize_filename(title: str) -> str:
    """Sanitizes titles for use as filenames."""
    # Remove slashes and invalid chars
    safe = re.sub(r'[\\/*?:"<>|]', "", title)
    return safe.strip()

def process_backup():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    
    log.info("📥 Fetching notes from Notion (using Cache)...")
    
    # Fetch all relevant types
    permanents = get_notes_wrapper("Nota permanent")
    lectures   = get_notes_wrapper("Nota de lectura")
    indexos    = get_notes_wrapper("Nota índex")
    
    all_notes = permanents + lectures + indexos
    log.info(f"📚 Total notes to backup: {len(all_notes)}")
    
    # 1. First Pass: Build ID -> Filename Map
    id_to_file = {}
    for note in all_notes:
        pid = note["id"].replace("-", "") # Notion IDs in links often strip dashes
        safe_title = sanitize_filename(note["titulo"])
        filename = f"{safe_title}.md"
        
        # Store both dashed and compact ID for robust matching
        id_to_file[note["id"]] = filename
        id_to_file[pid] = filename

    # 2. Second Pass: Generate Files
    written_count = 0
    
    for note in all_notes:
        filename = id_to_file.get(note["id"])
        
        if not filename:
            continue
            
        md_content = note.get("contenido_md", "")
        
        # LINK RESOLUTION
        # Regex to find [Label](notion://page/ID) produced by our notion_api
        # or typical Notion links provided by hrefs (notion.so/ID)
        
        def replace_link(match):
            # match.group(1) = Label
            # match.group(2) = Page ID or URL
            label = match.group(1)
            target = match.group(2)
            
            # Extract ID from target
            # Simple heuristic: grab the last 32 char hex if present
            m = re.search(r'([0-9a-f]{32})', target.replace("-","").lower())
            if m:
                target_id = m.group(1)
                target_file = id_to_file.get(target_id)
                if target_file:
                    # Obsidian WikiLink format: [[FileNameWithoutExt|Label]]
                    safe_title = target_file.replace(".md", "")
                    if label == safe_title:
                        return f"[[{safe_title}]]"
                    else:
                        return f"[[{safe_title}|{label}]]"
            
            # Fallback: keep original if not found in our backup set
            return f"[{label}]({target})"

        # Replace standard markdown links [text](url)
        # Our api produces: [text](notion://page/ID)
        final_md = re.sub(r'\[(.*?)\]\((.*?)\)', replace_link, md_content)
        
        # Add Relationships (Projects + Explicit Links) at the end
        projects = note.get("projects", [])
        links = note.get("links", [])
        
        # Combine unique values
        all_relations = sorted(list(set(projects + links)))
        
        if all_relations:
            final_md += "\n\n---\n### Relacions\n"
            for r in all_relations:
                final_md += f"- [[{r}]]\n"
        
        # FRONTMATTER
        tags_list = [t["name"] for t in note.get("tags", [])]
        tags_str = ", ".join(f'"{t}"' for t in tags_list)
        
        frontmatter = f"""---
title: "{note['titulo']}"
kind: "{note.get('tipo', 'Note')}"
url: "{note.get('url')}"
tags: [{tags_str}]
created: "{note.get('created_time')}"
---

"""
        
        # WRITE

        out_path = BACKUP_DIR / filename
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(frontmatter)
            f.write(final_md)
            
        written_count += 1

    log.info(f"✅ Backup complete! Written {written_count} Markdown files to {BACKUP_DIR}")
    
    # GEMINI SYNC (GOOGLE DOCS)
    try:
        log.info("📤 Syncing with Google Docs for Gemini Gems (Production URL)...")
        webhook_url = "http://host.docker.internal:5678/webhook/gemini-sync-brain-v10-stable-final-5" # Production URL for automation
        
        # Enviar el array de todas las notas para que n8n las procese
        import requests
        resp = requests.post(webhook_url, json={"notes": all_notes}, timeout=60)
        if resp.status_code == 200:
            log.info("✅ Google Docs sync completed via n8n.")
        else:
            log.error(f"❌ Google Docs sync failed: {resp.status_code} - {resp.text}")
    except Exception as e:
        log.error(f"❌ Error during Google Docs sync: {e}")

if __name__ == "__main__":
    process_backup()
