# pipeline/notion_api.py

"""
Notion Abstraction Layer
--------------------------

Provides stable and unified functions for:
- Querying a DB
- Getting a page
- Reading blocks
- Extracting tags
- Extracting relations
- Extracting titles

This avoids direct dependencies on "notion.databases.query"
(and protects us from future SDK updates).
"""

import unicodedata
import time
from typing import List, Dict, Optional, Tuple
from notion_client import Client, APIResponseError
from config.logger_config import get_logger
from config.app_config import load_params
from config.env_config import get_env

cfg = load_params(strict_env=False)
log = get_logger(__name__)

# --------------------------------------------------------------------
# 🔧 Load environment variables
# --------------------------------------------------------------------
NOTION_TOKEN = get_env("NOTION_TOKEN", required=False)
DATABASE_ID  = get_env("DATABASE_ID", required=False)

if not NOTION_TOKEN:
    raise RuntimeError("NOTION_TOKEN is not defined in .env")
if not DATABASE_ID:
    raise RuntimeError("DATABASE_ID is not defined in .env")

# --------------------------------------------------------------------
# 🚀 Initialize Notion Client
# --------------------------------------------------------------------
notion = Client(auth=NOTION_TOKEN)


# =============================================================================
# 🟦 Basic Helper Functions
# =============================================================================
def normalize_text(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.strip()


def notion_url(page_id: str) -> str:
    return f"https://www.notion.so/{page_id.replace('-', '')}"

# =============================================================================
# 🟩 Notion API Wrappers
# =============================================================================
def get_database_properties(database_id: str = DATABASE_ID) -> Dict:
    """Returns DB metadata: properties, types, etc."""
    return notion.databases.retrieve(database_id=database_id)


import httpx

# ... (existing imports)

# ... (existing code)

# =============================================================================
# 🟩 Notion API Wrappers
# =============================================================================
def get_database_properties(database_id: str = DATABASE_ID) -> Dict:
    """Returns DB metadata: properties, types, etc."""
    return notion.databases.retrieve(database_id=database_id)


def _raw_query_database(database_id: str, **kwargs) -> Dict:
    """
    Workaround for missing notion.databases.query method.
    Uses direct HTTPX request.
    """
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
    }
    
    # Filter out None values to avoid API errors
    json_body = {k: v for k, v in kwargs.items() if v is not None}
    
    response = httpx.post(url, headers=headers, json=json_body, timeout=60.0)
    response.raise_for_status()
    return response.json()


def query_database(database_id: str = DATABASE_ID, filter=None, page_size=100, start_cursor=None):
    return _raw_query_database(
        database_id=database_id,
        filter=filter,
        page_size=page_size,
        start_cursor=start_cursor
    )

def query_all_pages(filter=None) -> List[Dict]:
  results = []
  next_cursor = None

  while True:
    resp = _raw_query_database(
      database_id=DATABASE_ID,
      filter=filter,
      page_size=100,
      start_cursor=next_cursor
    )

    results.extend(resp.get("results", []))

    if not resp.get("has_more"):
      break

    next_cursor = resp.get("next_cursor")

  return results

def retrieve_page(page_id: str) -> Dict:
    return notion.pages.retrieve(page_id=page_id)


def get_page_properties(page: Dict) -> Dict:
    return page.get("properties", {}) or {}


def get_blocks(block_id: str, max_retries=3) -> List[Dict]:
    """Returns all first-level blocks for a given parent with pagination support and retries."""
    for attempt in range(max_retries):
        results = []
        try:
            next_cursor = None
            while True:
                res = notion.blocks.children.list(block_id, start_cursor=next_cursor)
                results.extend(res.get("results", []))
                if not res.get("has_more"):
                    break
                next_cursor = res.get("next_cursor")
            return results
        except Exception as e:
            log.error(f"Error getting blocks for {block_id}: {e} (Attempt {attempt+1}/{max_retries})")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff: 1s, 2s, 4s
                continue
            raise e  # Re-raise after retries exhausted to prevent partial data caching


# =============================================================================
# 🟨 High-Level Data Extractors
# =============================================================================

def extract_title(props: Dict, title_aliases: List[str]) -> Optional[str]:
    """Extracts title according to a list of aliases."""
    for k in title_aliases:
        v = props.get(k)
        if isinstance(v, dict) and v.get("type") == "title":
            arr = v.get("title", [])
            if arr:
                txt = "".join(x.get("plain_text", "") for x in arr).strip()
                if txt:
                    return normalize_text(txt)
    return None


def extract_tags(props: Dict, tag_aliases: List[str]) -> List[Dict]:
    """Extracts multi-select tags with color."""
    for key in tag_aliases:
        v = props.get(key)
        if isinstance(v, dict) and v.get("type") == "multi_select":
            tags = []
            for t in v.get("multi_select", []):
                name = t.get("name")
                if name:
                    tags.append({
                        "name": name,
                        "color": t.get("color", "default")
                    })
            return tags
    return []


def extract_relations(props: Dict, aliases: List[str]) -> List[str]:
    """
    Extracts relation IDs using multiple possible names.
    Works with any language and alias.
    """
    # 1) exact match by alias
    alias_map = {a.casefold(): a for a in aliases}

    for prop_name, prop_value in props.items():
        if not isinstance(prop_value, dict) or prop_value.get("type") != "relation":
            continue
        if prop_name.casefold() in alias_map:
            return [rel.get("id") for rel in prop_value.get("relation", []) if rel.get("id")]

    # 2) fallback: names containing "project", "link", etc.
    for prop_name, prop_value in props.items():
        if isinstance(prop_value, dict) and prop_value.get("type") == "relation":
            low = prop_name.casefold()
            if any(a.casefold().split()[0] in low for a in aliases):
                return [rel.get("id") for rel in prop_value.get("relation", []) if rel.get("id")]

    return []


_PROJECT_TITLE_CACHE = {}

def extract_page_titles(page_ids: List[str], title_aliases: List[str]) -> List[str]:
    """Given page IDs, retrieves their human titles."""
    titles = []
    for pid in page_ids[:25]: # Increased limit slightly
        if pid in _PROJECT_TITLE_CACHE:
            titles.append(_PROJECT_TITLE_CACHE[pid])
            continue
            
        try:
            p = retrieve_page(pid)
            t = extract_title( get_page_properties(p), title_aliases )
            if t:
                _PROJECT_TITLE_CACHE[pid] = t
                titles.append(t)
            else:
                # Cache empty result to avoid retrying
                _PROJECT_TITLE_CACHE[pid] = ""
        except Exception:
            pass
    return [t for t in titles if t]

# Alias for backward compatibility if needed imports exist elsewhere, 
# though we should update usage in this file.
extract_project_titles = extract_page_titles


def rich_text_to_markdown(rich_text: List[Dict]) -> str:
    """
    Converts Notion rich_text objects to Markdown.
    Handles: Bold, Italic, Code, Strikethrough, Links, and Mentions.
    """
    if not rich_text:
        return ""
    
    md_output = []
    
    for rt in rich_text:
        text = rt.get("plain_text", "")
        if not text:
            continue
            
        # Apply annotations
        ann = rt.get("annotations", {})
        href = rt.get("href")
        
        # Code (inline)
        if ann.get("code"):
            text = f"`{text}`"
        else:
            # Bold
            if ann.get("bold"):
                text = f"**{text}**"
            # Italic
            if ann.get("italic"):
                text = f"*{text}*"
            # Strikethrough
            if ann.get("strikethrough"):
                text = f"~~{text}~~"
                
        # Links
        # 1. Page Mention -> [Title](ID) (Will be resolved later)
        if rt.get("type") == "mention":
            mention = rt.get("mention", {})
            if mention.get("type") == "page":
                page_id = mention["page"]["id"]
                # We format as internal link marker for post-processing
                text = f"[{text}](notion://page/{page_id})"
                
        # 2. Text Link -> [Text](URL)
        elif href:
            text = f"[{text}]({href})"
            
        md_output.append(text)
        
    return "".join(md_output)


def extract_content_and_mentions(page_id: str) -> Tuple[str, str, List[str]]:
    """
    Gathers text from ALL blocks recursively AND extracts page mentions.
    Returns: (text_content_plain, text_content_markdown, list_of_mentioned_page_ids)
    """
    return _process_blocks_recursive(page_id)

def _process_blocks_recursive(parent_id: str, depth: int = 0) -> Tuple[str, str, List[str]]:
    """Internal recursive helper for block processing."""
    blocks = get_blocks(parent_id)
    # log.info(f"DEBUG: Processing {parent_id}, depth {depth}, found {len(blocks)} children") # Verbose
    out_text = []
    out_md = []
    mentions = []
    
    # Block types that have rich_text
    TEXT_TYPES = {"paragraph", "heading_1", "heading_2", "heading_3",
                  "bulleted_list_item", "numbered_list_item", "quote", "to_do", "toggle", "callout"}
             
    for block in blocks:
        tp = block.get("type")
        has_children = block.get("has_children", False)
        bid = block["id"]
        
        # 1. Handle Rich Text (if applicable)
        rich_text = []
        if tp in TEXT_TYPES:
            rich_text = block.get(tp, {}).get("rich_text", [])
        
        # Mentions from rich text
        for t in rich_text:
            if t.get("type") == "mention" and t.get("mention", {}).get("type") == "page":
                mentions.append(t["mention"]["page"]["id"])
        
        # Basic Content conversion
        md_line = rich_text_to_markdown(rich_text)
        plain_line = "".join([t.get("plain_text", "") for t in rich_text]).strip()
        
        # 2. Block Specific Formatting
        if tp == "heading_1":
            md_line = f"# {md_line}"
        elif tp == "heading_2":
            md_line = f"## {md_line}"
        elif tp == "heading_3":
            md_line = f"### {md_line}"
        elif tp == "bulleted_list_item":
            md_line = f"- {md_line}"
        elif tp == "numbered_list_item":
            md_line = f"1. {md_line}"
        elif tp == "quote":
            md_line = f"> {md_line}"
        elif tp == "to_do":
            checked = "x" if block.get(tp, {}).get("checked") else " "
            md_line = f"- [{checked}] {md_line}"
        elif tp == "callout":
            icon = block.get(tp, {}).get("icon", {}).get("emoji", "💡")
            md_line = f"> {icon} {md_line}"
        elif tp == "toggle":
            md_line = f"**{md_line}**" 
        elif tp == "divider":
            md_line = "---"
        elif tp == "code":
            code_data = block.get("code", {})
            code_text = "".join([t.get("plain_text", "") for t in code_data.get("rich_text", [])])
            lang = code_data.get("language", "plaintext")
            md_line = f"```{lang}\n{code_text}\n```"
        elif tp == "image":
            img = block["image"]
            url = img.get("external", {}).get("url") or img.get("file", {}).get("url")
            cap = "".join([t.get("plain_text", "") for t in img.get("caption", [])])
            md_line = f"![{cap}]({url})"
        elif tp == "table":
            # Process Table
            table_rows = get_blocks(bid)
            table_md = []
            for i, row in enumerate(table_rows):
                if row.get("type") != "table_row": continue
                cells = row.get("table_row", {}).get("cells", [])
                row_cols = [rich_text_to_markdown(c).replace("|", "\\|") for c in cells]
                table_md.append("| " + " | ".join(row_cols) + " |")
                if i == 0: # Add separator
                    table_md.append("| " + " | ".join(["---"] * len(row_cols)) + " |")
            md_line = "\n".join(table_md)
        elif tp in {"column_list", "column"}:
            md_line = "" # Flatten
            
        # Add to output
        if plain_line:
            out_text.append(plain_line)
        if md_line.strip():
            out_md.append(md_line)
            
        # 3. Recursive Descent (Nested Content)
        # We don't recurse into tables because we handled it above
        if has_children and tp != "table":
            child_text, child_md, child_mentions = _process_blocks_recursive(bid, depth + 1)
            
            if child_text: out_text.append(child_text)
            if child_md:
                # Indent child content if it's a list item or similar
                if tp in {"bulleted_list_item", "numbered_list_item", "to_do"}:
                    child_md = "\n".join(["    " + line for line in child_md.split("\n")])
                out_md.append(child_md)
            mentions.extend(child_mentions)
            
    return "\n".join(out_text), "\n\n".join(out_md), list(dict.fromkeys(mentions))

def extract_page_text(page_id: str) -> str:
    """Wrapper for backward compatibility."""
    text, _, _ = extract_content_and_mentions(page_id)
    return text

def update_page_relations(page_id: str, new_relation_ids: List[str], relation_prop_aliases: List[str]) -> None:
    """
    Updates the relation property (found via aliases) with new IDs.
    Merges with existing relations.
    Implements Bulk + Incremental Fallback strategy.
    """
    if not new_relation_ids:
        return

    # 1. Find the property name
    try:
        page = retrieve_page(page_id)
        props = page.get("properties", {})
        
        # Find the actual property name using aliases
        target_prop = None
        # Exact match
        alias_map = {a.casefold(): a for a in relation_prop_aliases}
        for k, v in props.items():
            if k.casefold() in alias_map and v.get("type") == "relation":
                target_prop = k
                break
        
        # Fallback match
        if not target_prop:
            for k, v in props.items():
                if v.get("type") == "relation":
                    low = k.casefold()
                    if any(a.casefold().split()[0] in low for a in relation_prop_aliases):
                        target_prop = k
                        break
        
        if not target_prop:
            log.warning(f"Could not find relation property matching {relation_prop_aliases} in page {page_id}")
            return

        # Get current relations
        current_rels = props.get(target_prop, {}).get("relation", [])
        current_ids = [r["id"] for r in current_rels]
        
        # Calculate target set (Current + New)
        target_ids = list(dict.fromkeys(current_ids + new_relation_ids))
        
        # If nothing to add, return
        if len(target_ids) == len(current_ids):
            return

        # 2. Try Bulk Update
        try:
            notion.pages.update(
                page_id=page_id,
                properties={target_prop: {"relation": [{"id": i} for i in target_ids]}}
            )
            log.info(f"✅ Updated '{target_prop}' on {page_id} with {len(target_ids) - len(current_ids)} new links.")
            return
        except Exception as e:
            log.warning(f"⚠️ Bulk update failed for {page_id}: {e}. Trying incremental fallback...")

        # 3. Incremental Fallback
        # We start with current_ids and try to add new ones one by one
        working_set = set(current_ids)
        
        for new_id in new_relation_ids:
            if new_id in working_set:
                continue
                
            try:
                temp_list = list(working_set | {new_id})
                notion.pages.update(
                    page_id=page_id,
                    properties={target_prop: {"relation": [{"id": i} for i in temp_list]}}
                )
                working_set.add(new_id)
                log.info(f"   + Added {new_id}")
            except APIResponseError as e:
                if e.code == "object_not_found": 
             	      log.warning(f"   ⚠️ Dead link skipped (Page not found): {new_id}")
                elif e.code == "validation_error":
                    log.warning(f"   ⚠️ Invalid ID skipped: {new_id}")
                else:
                    log.error(f"   ❌ Failed to add {new_id}: {e}")
            except Exception as e:
                log.error(f"   ❌ Failed to add {new_id}: {e}")

    except Exception as e:
        log.error(f"Error updating relations for {page_id}: {e}")


# =============================================================================
# 🟥 HIGH LEVEL: "GET NOTES"
# =============================================================================

# =============================================================================
# 🟥 HIGH LEVEL: "GET NOTES" (With Delta Cache & Sync)
# =============================================================================
import json
import os
from pathlib import Path
from config.paths_config import get_paths

_paths = get_paths()
CONTENT_CACHE_FILE = _paths["OUT_DIR"] / "content_cache.json"

def _load_content_cache() -> Dict:
    if CONTENT_CACHE_FILE.exists():
        try:
            with open(CONTENT_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.warning(f"Could not load content cache: {e}")
    return {}

def _save_content_cache(cache: Dict):
    """
    Saves cache atomically to prevent corruption.
    Writes to .tmp -> flush -> fsync -> rename.
    """
    tmp_file = CONTENT_CACHE_FILE.with_suffix(".tmp")
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        
        # Atomic rename
        os.replace(tmp_file, CONTENT_CACHE_FILE)
        
    except Exception as e:
        log.warning(f"Could not save content cache: {e}")
        if tmp_file.exists():
            try:
                os.remove(tmp_file)
            except OSError:
                pass

def get_notes_by_type(
    tipo_select: str,
    type_property_name: str,
    title_aliases: List[str],
    tag_aliases: List[str],
    project_aliases: List[str],
    links_aliases: List[str] = None, # If provided, enables "Sync Relations"
) -> List[Dict]:
    """
    Retrieves and structures notes based on type and configuration.
    Implements DELTA CACHE:
    - If page not modified (last_edited_time matches cache), use cached content/mentions.
    - If modified, fetch blocks, extract content/mentions, and UPDATE RELATIONS (if links_aliases).
    """

    pages = query_all_pages(
        filter={"property": type_property_name, "select": {"equals": tipo_select}}
    )
    
    log.info(f"   Found {len(pages)} pages of type '{tipo_select}'. Checking Cache...")

    # Load Cache
    cache = _load_content_cache()
    if not cache:
        log.info("   (Cache empty or not found, cold start)")

    notes = []
    skipped_count = 0
    updated_count = 0
    sync_enabled = bool(links_aliases)

    for i, page in enumerate(pages, 1):
        pid = page["id"]
        last_edited = page.get("last_edited_time", "")
        
        # Log progress every 20 items
        if i % 20 == 0:
            log.info(f"   Processing {i}/{len(pages)}...")

        props = get_page_properties(page)
        titulo = extract_title(props, title_aliases)
        if not titulo:
            continue

        tags = extract_tags(props, tag_aliases)
        project_ids = extract_relations(props, project_aliases)
        project_titles = extract_page_titles(project_ids, title_aliases)
        
        # New: Extract generic links (relations)
        links_titles = []
        if sync_enabled:
             links_ids = extract_relations(props, links_aliases)
             # Avoid duplicating keys if project_aliases overlaps with links_aliases
             # But here we just want to fetch their titles
             links_titles = extract_page_titles(links_ids, title_aliases)

    # --- DELTA LOGIC ---
        cached_entry = cache.get(pid, {})
        cached_time = cached_entry.get("last_edited_time")
        
        content = ""
        content_md = ""
        mentions = []

        # Check if cache is valid AND has all required fields (added content_md)
        if (cached_time == last_edited 
            and "content" in cached_entry 
            and "content_md" in cached_entry):
            
            # HIT: Use Valid Cache
            content = cached_entry.get("content", "")
            content_md = cached_entry.get("content_md", "")
            mentions = cached_entry.get("mentions", [])
            # Also restore created_time from cache if it was saved there
            created_time = cached_entry.get("created_time") or page.get("created_time")
            skipped_count += 1
            # log.debug(f"   [CACHE] {titulo[:20]}...") 
        else:
            # MISS: Fetch & Update
            # log.info(f"   [FETCH] {titulo[:20]}...")
            try:
                content, content_md, mentions = extract_content_and_mentions(pid)
                
                # Update Memory Cache ONLY if successful
                cache[pid] = {
                    "last_edited_time": last_edited,
                    "content": content,
                    "content_md": content_md,
                    "mentions": mentions,
                    "created_time": page.get("created_time")
                }
                
                updated_count += 1

                # Sync Relations (Unidirectional Logic from update_connections)
                if sync_enabled and mentions:
                    try:
                        update_page_relations(pid, mentions, links_aliases)
                    except Exception as e:
                        log.error(f"Failed to sync relations for {titulo}: {e}")
                        
            except Exception as e:
                log.error(f"Failed to fetch content for {titulo} ({pid}): {e}. Skipping cache update.")
                continue # Skip this note to avoid bad state
            
            created_time = page.get("created_time")


        notes.append({
            "id": pid,
            "titulo": titulo,
            "tags": tags,
            "projects": project_titles,
            "project_ids": project_ids,
            "links": links_titles, # New field
            "contenido": content,
            "contenido_md": content_md,
            "mentions": mentions, 
            "url": notion_url(pid),
            "created_time": created_time,
        })

    # Save Cache to Disk
    if updated_count > 0:
        _save_content_cache(cache)
        log.info(f"   ✅ Cache updated: {updated_count} fetched, {skipped_count} skipped.")
    else:
        log.info(f"   ✅ All {skipped_count} notes were up-to-date (No Notion API calls for blocks).")

    return notes

# =============================================================================
# 🟧 WRITE OPERATIONS
# =============================================================================

def create_page(
    title: str,
    content: str = "",
    type_select: str = "Nota permanent",
    tags: List[str] = None,
    type_prop_name: str = "Tipus de nota",
    title_prop_name: str = "Nota",
    tags_prop_name: str = "Tags"
) -> Dict:
    """
    Creates a new page in the database.
    Converts 'content' string into paragraph blocks.
    """
    if not title:
        raise ValueError("Title is required")

    # 1. Build Properties
    properties = {
        title_prop_name: {
            "title": [{"text": {"content": title}}]
        },
        type_prop_name: {
            "select": {"name": type_select}
        }
    }
    
    if tags:
        properties[tags_prop_name] = {
            "multi_select": [{"name": t} for t in tags]
        }

    # 2. Build Children (Blocks)
    max_len = 2000
    children = []
    
    if content:
        lines = content.split('\n')
        for line in lines:
            # Truncate if necessary (Notion limit)
            safe_line = line[:max_len]
            if not safe_line.strip():
                 continue 
                 
            children.append({
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": safe_line}}]
                }
            })

    # 3. Create
    try:
        new_page = notion.pages.create(
            parent={"database_id": DATABASE_ID},
            properties=properties,
            children=children
        )
        log.info(f"✅ Page created: {title} ({new_page['id']})")
        return new_page
    except Exception as e:
        log.error(f"❌ Failed to create page '{title}': {e}")
        raise e

def update_page_properties(page_id: str, properties: Dict) -> None:
    """Updates page properties (e.g. title, tags)."""
    try:
        notion.pages.update(page_id=page_id, properties=properties)
        # log.info(f"   Updated page {page_id}")
    except Exception as e:
        log.error(f"❌ Failed to update page {page_id}: {e}")

def update_block_text(block_id: str, new_text: str, block_type: str = "paragraph") -> None:
    """Updates the text content of a block."""
    try:
        # Construct the specific block object structure
        # Most text blocks follow: {type: {rich_text: [...]}}
        notion.blocks.update(
            block_id=block_id,
            **{
                block_type: {
                    "rich_text": [{"text": {"content": new_text}}]
                }
            }
        )
    except Exception as e:
        log.error(f"❌ Failed to update block {block_id}: {e}")

def update_database(database_id: str, title: str = None, properties: Dict = None) -> None:
    """Updates database title and schema (property names)."""
    kwargs = {}
    if title:
        kwargs["title"] = [{"text": {"content": title}}]
    if properties:
        kwargs["properties"] = properties
        
    try:
        notion.databases.update(database_id=database_id, **kwargs)
    except Exception as e:
        log.error(f"❌ Failed to update database {database_id}: {e}")

def search_object(query: str, filter_prop: str = "object", filter_value: str = "page") -> List[Dict]:
    """
    Searches for pages or databases by title.
    """
    try:
        results = notion.search(
            query=query,
            filter={"property": filter_prop, "value": filter_value}
        ).get("results", [])
        return results
    except Exception as e:
        log.error(f"❌ Search failed for '{query}': {e}")
        return []

def get_block_children_recursive(block_id: str) -> List[Dict]:
    """Helper to fetch children (alias to existing logic if needed, or direct API call)."""
    # notion_client handles pagination, but for deep trees we might just use 'get_blocks'
    # which we already defined above as 'get_blocks(page_id)' but it works for blocks too.
    return get_blocks(block_id)
