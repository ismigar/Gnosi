#!/usr/bin/env python3
"""
notion_to_gnosi_full_import.py
-------------------------------
Synchronizes Notion databases with a local Gnosi vault.

Generates Markdown files with YAML frontmatter (including id),
downloads assets, and supports all standard Notion block types.

Usage:
    python3 notion_to_gnosi_full_import.py              # Migrate all databases
    python3 notion_to_gnosi_full_import.py Projectes    # Migrate single database
"""

import os
import re
import sys
import json
import uuid
import time
import urllib.parse
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import requests
import yaml
from dotenv import load_dotenv

# ──────────────────────────────────────────────
#  Environment & Configuration (Gnosi Unified)
# ──────────────────────────────────────────────

# Path to Gnosi app root (monorepo/apps/gnosi)
GNOSI_APP_ROOT = Path(__file__).resolve().parents[4]
if str(GNOSI_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(GNOSI_APP_ROOT))

try:
    from backend.config.env_config import get_env
except ImportError:
    # Basic fallback if get_env is not available
    def get_env(name, default=None): return os.getenv(name, default)

TOKEN = get_env("NOTION_TOKEN")
VAULT_ROOT = get_env("VAULT_PATH")

if not TOKEN or not VAULT_ROOT:
    print("❌ ERROR: No s'ha trobat NOTION_TOKEN o VAULT_PATH al Keychain o fitxers d'entorn.")
    sys.exit(1)

print(f"  📂 VAULT_ROOT configurada a: {VAULT_ROOT}")
VAULT_PATH = Path(VAULT_ROOT)
ASSETS_PATH = VAULT_PATH / "Assets"
ASSETS_PATH.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

API_BASE = "https://api.notion.com/v1"

# Map: display folder name -> env var holding the Notion database ID
DATABASE_MAP = {
    "Arees": os.getenv("NOTION_DB_AREES"),
    "Articles": os.getenv("NOTION_DB_ARTICLES"),
    "Bitacora": os.getenv("NOTION_DB_BITACORA"),
    "Cervell": os.getenv("NOTION_DB_CERVELL"),
    "Cinema": os.getenv("NOTION_DB_CINEMA"),
    "Col·lab": os.getenv("NOTION_DB_COLLAB"),
    "Dissen": os.getenv("NOTION_DB_DISSEN"),
    "Experiencia": os.getenv("NOTION_DB_EXPERIENCIA"),
    "Projectes": os.getenv("NOTION_DB_PROJECTES"),
    "Recursos": os.getenv("NOTION_DB_RECURS"),
    "Seg_amistats": os.getenv("NOTION_DB_AMISTATS"),
    "Tasques": os.getenv("NOTION_DB_TASQUES"),
    "Titulacions": os.getenv("NOTION_DB_TITULACIONS"),
    "XXSS": os.getenv("NOTION_DB_XXSS"),
}

RATE_LIMIT_DELAY = 0.55  # seconds between page fetches

# ─� Notion color → BlockNote named color ──
# BlockNote accepts: "default", "gray", "brown", "red", "orange", "yellow",
# "green", "blue", "purple", "pink" + any CSS color string.
NOTION_COLOR_MAP = {
    "default": "default",
    "gray": "gray",
    "brown": "brown",
    "orange": "orange",
    "yellow": "yellow",
    "green": "green",
    "blue": "blue",
    "purple": "purple",
    "pink": "pink",
    "red": "red",
    "gray_background": "gray",
    "brown_background": "brown",
    "orange_background": "orange",
    "yellow_background": "yellow",
    "green_background": "green",
    "blue_background": "blue",
    "purple_background": "purple",
    "pink_background": "pink",
    "red_background": "red",
}

# Reverse map: Notion DB ID (normalized) → (vault folder name, Gnosi table_id from registry)
_reverse_db_map: Dict[str, Tuple[str, str]] = {}
# Reverse map: Table Name (lowercase) → (vault folder name, Gnosi table_id)
_name_to_db_info: Dict[str, Tuple[str, str]] = {}
# Global cache for resolving Page ID → Title
_id_to_title: Dict[str, str] = {}
_view_registry: List[Dict] = []
_notion_db_search_cache: Optional[List[Dict]] = None


def _build_reverse_maps():
    """Build reverse Notion→Gnosi maps from vault_db_registry.json."""
    global _reverse_db_map, _view_registry
    registry_path = VAULT_PATH / "BD" / "vault_db_registry.json"
    if not registry_path.exists():
        return
    try:
        with open(registry_path, "r", encoding="utf-8") as f:
            registry = json.load(f)
        _view_registry = registry.get("views", [])

        # 1. Map directly from all tables in registry
        # Also map database names
        db_folders = {db["id"]: db.get("folder", "") for db in registry.get("databases", [])}
        
        for table in registry.get("tables", []):
            nid = table.get("id")
            name = table.get("name", "").lower()
            table_folder = table.get("folder", "")
            db_id = table.get("database_id")
            db_folder = db_folders.get(db_id, "BD") # Default to BD if not found
            
            # Full relative path: BD/Database/Table
            full_path = f"{db_folder}/{table_folder}".replace("//", "/")
            
            if nid:
                norm_nid = nid.replace("-", "")
                _reverse_db_map[norm_nid] = (full_path, nid)
            
            if name:
                _name_to_db_info[name] = (full_path, nid or name)

        # 1.5. Map views from the registry to their parent tables
        for v in _view_registry:
            vid = v.get("id", "").replace("-", "")
            tid = v.get("table_id")
            if not vid or not tid:
                continue
            
            # Find the path of the target table
            target_path, _ = _reverse_db_map.get(tid.replace("-", ""), (None, None))
            if target_path:
                _reverse_db_map[vid] = (target_path, tid)

        # 2. Ensure DATABASE_MAP mappings exist (fallback)
        for folder_name, notion_db_id in DATABASE_MAP.items():
            if not notion_db_id:
                continue
            normalized = notion_db_id.replace("-", "")
            if notion_db_id not in _reverse_db_map:
                _reverse_db_map[notion_db_id] = (f"BD/{folder_name}", notion_db_id)
            if normalized not in _reverse_db_map:
                _reverse_db_map[normalized] = (f"BD/{folder_name}", notion_db_id)
    except Exception as e:
        print(f"  ⚠️  Error carregant registry: {e}")


def _fetch_accessible_databases() -> List[Dict]:
    """Return accessible Notion databases via search, cached for this run."""
    global _notion_db_search_cache
    if _notion_db_search_cache is not None:
        return _notion_db_search_cache

    found: List[Dict] = []
    cursor = None
    for _ in range(10):
        payload = {
            "filter": {"property": "object", "value": "database"},
            "page_size": 100,
        }
        if cursor:
            payload["start_cursor"] = cursor

        try:
            res = requests.post(
                f"{API_BASE}/search", headers=HEADERS, json=payload, timeout=45
            )
            if res.status_code != 200:
                break
            data = res.json()
            found.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        except Exception:
            break

    _notion_db_search_cache = found
    return found


def _resolve_embedded_table_info(block_id: str, title: str) -> Optional[Tuple[str, str]]:
    """Try to resolve an embedded database block to a Gnosi table mapping."""
    norm_bid = block_id.replace("-", "")

    # 1) Direct ID lookup from registry mappings.
    mapped = _reverse_db_map.get(norm_bid)
    if mapped:
        return mapped

    # 2) Name-based lookup from registry mappings.
    mapped = _name_to_db_info.get((title or "").lower())
    if mapped:
        return mapped

    # 3) Search accessible DBs and try mapping using actual DB id or title.
    for db in _fetch_accessible_databases():
        db_title = "".join(t.get("plain_text", "") for t in db.get("title", [])).strip()
        db_id = (db.get("id") or "").replace("-", "")

        if db_id == norm_bid:
            mapped = _reverse_db_map.get(db_id)
            if mapped:
                return mapped

        if db_title and title and db_title.casefold() == title.casefold():
            mapped = _name_to_db_info.get(db_title.lower())
            if mapped:
                return mapped

    return None


def _resolve_relation_title(notion_id: str) -> str:
    """Resolve a Notion Page ID to its best known title for [[Wiki]] links."""
    norm_id = notion_id.replace("-", "")
    if norm_id in _id_to_title:
        return _id_to_title[norm_id]
    
    # Optional: fetch via API if not found (can be slow, use sparingly)
    # For now, return ID as placeholder or better, wait after one full scan
    return notion_id


def _populate_id_to_title_cache():
    """Scan all databases quickly to populate ID -> Title mapping before migration."""
    print(f"\n⚡ Pre-escanejant títols per resoldre relacions...")
    for db_name, db_id in DATABASE_MAP.items():
        if not db_id: continue
        
        # We only need the ID and the title property
        # Fetching all pages just for titles
        pages = fetch_all_pages(db_id)
        for p in pages:
            pid = p["id"].replace("-", "")
            title = "Untitled"
            # Standard Title property detection
            props = p.get("properties", {})
            for k, v in props.items():
                if v.get("type") == "title":
                    parts = v.get("title", [])
                    title = "".join(t.get("plain_text", "") for t in parts)
                    break
            _id_to_title[pid] = title
    print(f"   ✅ Trobats {len(_id_to_title)} títols.")


def _notion_color_to_blocknote(color: str, is_background: bool) -> str:
    """Map Notion color name to BlockNote color value."""
    if not color or color == "default":
        return "default"
    return NOTION_COLOR_MAP.get(color, "default")


def _is_background_color(color: str) -> bool:
    return bool(color and color.endswith("_background"))


# ──────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────


def get_safe_filename(title: str) -> str:
    """Sanitize title into a filesystem-safe filename."""
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title).strip()
    safe = re.sub(r"\s+", " ", safe)
    return safe if safe else "Untitled"


def download_asset(url: str, original_name: str) -> str:
    """Download an asset to the Assets folder, return relative path."""
    if not url:
        return ""
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1]
    if not ext:
        ext = ".png"
    if "?" in ext:
        ext = ext.split("?")[0]

    safe_name = get_safe_filename(original_name)
    ts = int(time.time() * 1000)
    new_filename = f"{safe_name}_{ts}{ext}"
    target = ASSETS_PATH / new_filename

    try:
        r = requests.get(url, stream=True, timeout=30)
        if r.status_code == 200:
            with open(target, "wb") as f:
                for chunk in r.iter_content(1024):
                    f.write(chunk)
            return f"../Assets/{new_filename}"
    except Exception as e:
        print(f"      [!] Error descarregant asset: {e}")
    return ""


# ──────────────────────────────────────────────
#  Notion API helpers
# ──────────────────────────────────────────────


def fetch_all_pages(database_id: str) -> List[Dict]:
    """Paginate through all pages of a Notion database."""
    results = []
    has_more = True
    cursor = None

    while has_more:
        payload = {"page_size": 100}
        if cursor:
            payload["start_cursor"] = cursor

        # Retry logic for Notion API
        for attempt in range(3):
            try:
                res = requests.post(
                    f"{API_BASE}/databases/{database_id}/query",
                    headers=HEADERS,
                    json=payload,
                    timeout=45
                )
                if res.status_code == 200:
                    break
                elif res.status_code == 429:
                    print(f"    [!] Rate limited by Notion. Sleeping 5s... (intent {attempt+1})")
                    time.sleep(5)
                else:
                    print(f"    [!] Error querying database {database_id}: {res.text}")
                    return results # Best effort
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                print(f"    [!] Connection error: {e}. Retrying in 3s... (intent {attempt+1})")
                time.sleep(3)
        else:
            print("    [!] Failed to query Notion after 3 attempts. Stopping pagination.")
            break

        data = res.json()
        results.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        cursor = data.get("next_cursor")
        
        if has_more:
            time.sleep(RATE_LIMIT_DELAY) # Avoid burst

    return results


def fetch_blocks(block_id: str) -> List[Dict]:
    """Fetch all direct children blocks with pagination."""
    results = []
    has_more = True
    cursor = None

    while has_more:
        url = f"{API_BASE}/blocks/{block_id}/children?page_size=100"
        if cursor:
            url += f"&start_cursor={cursor}"

        # Retry logic for Notion API
        for attempt in range(3):
            try:
                res = requests.get(url, headers=HEADERS, timeout=45)
                if res.status_code == 200:
                    break
                elif res.status_code == 429:
                    print(f"      [!] Rate limited. Sleeping 5s... (intent {attempt+1})")
                    time.sleep(5)
                else:
                    print(f"      [!] Error fetching blocks: {res.text}")
                    return results # Return what we have
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                print(f"      [!] Connection error: {e}. Retrying in 3s... (intent {attempt+1})")
                time.sleep(3)
        else:
            print("      [!] Failed to fetch blocks after 3 attempts.")
            break

        data = res.json()
        results.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        cursor = data.get("next_cursor")
        
        if has_more:
            time.sleep(RATE_LIMIT_DELAY) # Be nice to Notion

    return results


# ──────────────────────────────────────────────
#  Property extraction → frontmatter
# ──────────────────────────────────────────────


def extract_flat_properties(props: dict) -> Tuple[dict, str]:
    """Extract Notion page properties into a flat dict for YAML frontmatter.

    Returns:
        (frontmatter_dict, title_string)
    """
    frontmatter = {}
    title_key = None

    for key, value in props.items():
        prop_type = value.get("type")
        if not prop_type:
            continue

        fmt_key = key.lower().replace(" ", "_")

        if prop_type == "title":
            parts = value.get("title", [])
            extracted = "".join(t.get("plain_text", "") for t in parts)
            frontmatter["title"] = str(extracted)
            title_key = extracted

        elif prop_type in ("status", "select"):
            data = value.get(prop_type)
            if data:
                frontmatter[fmt_key] = str(data.get("name", ""))

        elif prop_type == "multi_select":
            options = value.get("multi_select", [])
            if options:
                frontmatter[fmt_key] = [str(opt["name"]) for opt in options]

        elif prop_type == "rich_text":
            parts = value.get("rich_text", [])
            extracted = "".join(t.get("plain_text", "") for t in parts).strip()
            if extracted:
                frontmatter[fmt_key] = str(extracted)

        elif prop_type == "relation":
            rels = value.get("relation", [])
            if rels:
                frontmatter[fmt_key] = [r["id"] for r in rels]

        elif prop_type == "date":
            date_data = value.get("date")
            if date_data:
                frontmatter[fmt_key] = str(date_data.get("start", ""))

        elif prop_type == "url":
            url_data = value.get("url")
            if url_data:
                frontmatter[fmt_key] = str(url_data)

        elif prop_type == "email":
            frontmatter[fmt_key] = str(value.get("email", ""))

        elif prop_type == "phone_number":
            frontmatter[fmt_key] = str(value.get("phone_number", ""))

        elif prop_type == "checkbox":
            frontmatter[fmt_key] = value.get("checkbox", False)

        elif prop_type == "number":
            num = value.get("number")
            if num is not None:
                frontmatter[fmt_key] = num

        elif prop_type == "formula":
            fval = value.get("formula", {})
            ftype = fval.get("type")
            if ftype == "string":
                frontmatter[fmt_key] = str(fval.get("string", ""))
            elif ftype == "number":
                frontmatter[fmt_key] = fval.get("number")
            elif ftype == "boolean":
                frontmatter[fmt_key] = fval.get("boolean", False)
            elif ftype == "date":
                d = fval.get("date", {})
                frontmatter[fmt_key] = str(d.get("start", "")) if d else ""

        elif prop_type == "rollup":
            rval = value.get("rollup", {})
            rtype = rval.get("type")
            if rtype == "array":
                items = []
                for item in rval.get("array", []):
                    itype = item.get("type")
                    if itype == "title":
                        items.append(
                            "".join(
                                t.get("plain_text", "") for t in item.get("title", [])
                            )
                        )
                    elif itype == "rich_text":
                        items.append(
                            "".join(
                                t.get("plain_text", "")
                                for t in item.get("rich_text", [])
                            )
                        )
                    elif itype == "string":
                        items.append(str(item.get("string", "")))
                    elif itype == "number":
                        items.append(item.get("number"))
                    elif itype == "date":
                        d = item.get("date", {})
                        items.append(str(d.get("start", "")) if d else "")
                    else:
                        items.append(str(item))
                if items:
                    frontmatter[fmt_key] = items
            elif rtype == "number":
                frontmatter[fmt_key] = rval.get("number")
            elif rtype == "string":
                frontmatter[fmt_key] = str(rval.get("string", ""))
            elif rtype == "date":
                d = rval.get("date", {})
                frontmatter[fmt_key] = str(d.get("start", "")) if d else ""

        elif prop_type == "created_time":
            frontmatter["created_time"] = str(value.get("created_time", ""))

        elif prop_type == "last_edited_time":
            frontmatter["last_edited_time"] = str(value.get("last_edited_time", ""))

        elif prop_type == "created_by":
            person = value.get("created_by", {})
            frontmatter[fmt_key] = str(person.get("name", person.get("id", "")))

        elif prop_type == "last_edited_by":
            person = value.get("last_edited_by", {})
            frontmatter[fmt_key] = str(person.get("name", person.get("id", "")))

        elif prop_type == "files":
            files = value.get("files", [])
            file_paths = []
            for f in files:
                ftype = f.get("type")
                url = (
                    f.get("file", {}).get("url")
                    if ftype == "file"
                    else f.get("external", {}).get("url")
                )
                if url:
                    name = f.get("name", "file")
                    local = download_asset(url, name)
                    file_paths.append(local if local else url)
            if file_paths:
                frontmatter[fmt_key] = file_paths

        elif prop_type == "button":
            # Notion button is an action-only field; preserve marker to avoid silent empties.
            frontmatter[fmt_key] = "__notion_button__"

    if not title_key:
        frontmatter["title"] = "Untitled"
        title_key = "Untitled"

    return frontmatter, title_key


# ══════════════════════════════════════════════
#  BlockNote JSON conversion (columns, colors, views)
# ══════════════════════════════════════════════


def _bn_id() -> str:
    """Generate a short unique ID for BlockNote blocks."""
    return uuid.uuid4().hex[:12]


def rich_text_to_markdown(rich_text_array: list) -> str:
    """Convert Notion rich_text to standard Markdown (bold, italic, strike, code, link)."""
    markdown = ""
    for rt in rich_text_array:
        text = rt.get("plain_text", "")
        if not text:
            continue
        annots = rt.get("annotations", {})
        href = rt.get("href")
        
        # Apply styles
        if annots.get("code"):
            text = f"`{text}`"
        else:
            if annots.get("bold"):
                text = f"**{text}**"
            if annots.get("italic"):
                text = f"*{text}*"
            if annots.get("strikethrough"):
                text = f"~~{text}~~"
            if annots.get("underline"):
                text = f"<u>{text}</u>"

        if href:
            text = f"[{text}]({href})"
        
        markdown += text

    return markdown


def _extract_block_colors(bdata: dict, rich_text_key: str = "rich_text") -> dict:
    """Extract block-level colors from Notion block data.

    Uses first rich_text span's annotation color as block color if consistent.
    Returns BlockNote props dict (backgroundColor, textColor).
    """
    props = {}
    color = bdata.get("color", "")
    if color and color != "default":
        if _is_background_color(color):
            props["backgroundColor"] = _notion_color_to_blocknote(color, True)
        else:
            props["textColor"] = _notion_color_to_blocknote(color, False)

    if not props:
        rts = bdata.get(rich_text_key, [])
        if rts:
            first_color = rts[0].get("annotations", {}).get("color", "default")
            if first_color and first_color != "default":
                # Check if ALL spans have the same color → block level
                all_same = all(
                    t.get("annotations", {}).get("color", "default") == first_color
                    for t in rts
                )
                if all_same:
                    if _is_background_color(first_color):
                        props["backgroundColor"] = _notion_color_to_blocknote(
                            first_color, True
                        )
                    else:
                        props["textColor"] = _notion_color_to_blocknote(
                            first_color, False
                        )

    return props


def convert_block_to_markdown(block: dict, indent_level: int = 0) -> str:
    """Convert a single Notion block to Gnosi-enriched Markdown.
    
    Compatible with the new BlockEditor (markdown-mapper.js).
    """
    btype = block.get("type")
    if not btype:
        return ""
    bdata = block.get(btype, {})
    has_children = block.get("has_children", False)
    bid = block["id"]
    indent = "  " * indent_level
    
    # ── Text blocks ──
    if btype in ("paragraph", "heading_1", "heading_2", "heading_3", 
                  "bulleted_list_item", "numbered_list_item", "to_do", "quote"):
        content = rich_text_to_markdown(bdata.get("rich_text", []))
        
        prefix = ""
        if btype == "heading_1": prefix = "# "
        elif btype == "heading_2": prefix = "## "
        elif btype == "heading_3": prefix = "### "
        elif btype == "bulleted_list_item": prefix = "- "
        elif btype == "numbered_list_item": prefix = "1. "
        elif btype == "to_do": 
            checked = "[x]" if bdata.get("checked") else "[ ]"
            prefix = f"- {checked} "
        elif btype == "quote": prefix = "> "
        
        res = f"{indent}{prefix}{content}\n"
        
        if has_children:
            # Handle nested items (except for paragraph/quote which use directives for specialized stuff)
            child_blocks = fetch_blocks(bid)
            for child in child_blocks:
                res += convert_block_to_markdown(child, indent_level + 1)
        return res

    # ── Structural directives ──
    elif btype == "column_list":
        res = f"{indent}:::column-list\n"
        if has_children:
            for col in fetch_blocks(bid):
                res += convert_block_to_markdown(col, indent_level + 1)
        res += f"{indent}:::\n"
        return res

    elif btype == "column":
        width = bdata.get("width_ratio")
        width_attr = f" {{width={width}}}" if width else ""
        res = f"{indent}:::column{width_attr}\n"
        if has_children:
            for child in fetch_blocks(bid):
                res += convert_block_to_markdown(child, indent_level + 1)
        res += f"{indent}:::\n"
        return res

    elif btype == "toggle":
        summary = rich_text_to_markdown(bdata.get("rich_text", [])) or "Toggle"
        res = f"{indent}:::toggle {summary}\n"
        if has_children:
            for child in fetch_blocks(bid):
                res += convert_block_to_markdown(child, indent_level + 1)
        res += f"{indent}:::\n"
        return res

    elif btype == "callout":
        icon = bdata.get("icon", {}).get("emoji", "💡")
        content = rich_text_to_markdown(bdata.get("rich_text", []))
        # Callouts are mapped to quotes in our current editor logic or simple styled box
        # For simplicity, we use Markdown quote with icon prefix
        res = f"{indent}> {icon} {content}\n"
        if has_children:
            for child in fetch_blocks(bid):
                res += convert_block_to_markdown(child, indent_level + 1)
        return res

    # ── Code blocks ──
    elif btype in ("code", "equation"):
        code_text = "".join(t.get("plain_text", "") for t in bdata.get("rich_text", [])) if btype == "code" else bdata.get("expression", "")
        lang = bdata.get("language", "latex" if btype == "equation" else "")
        return f"{indent}```{lang}\n{code_text}\n{indent}```\n"

    elif btype == "divider":
        return f"{indent}---\n"

    # ── Media blocks ──
    elif btype in ("image", "file", "pdf", "video", "audio"):
        mtype = bdata.get("type", "file")
        url = bdata.get("file", {}).get("url") if mtype == "file" else bdata.get("external", {}).get("url")
        if not url: return ""
        
        caption = "".join(t.get("plain_text", "") for t in bdata.get("caption", [])) or btype.upper()
        local = download_asset(url, os.path.basename(urllib.parse.urlparse(url).path) or f"notion_{btype}")
        final_url = local if local else url
        
        if btype == "image":
            return f"{indent}![{caption}]({final_url})\n"
        else:
            return f"{indent}📎 [{caption}]({final_url})\n"

    # ── Tables ──
    elif btype == "table":
        res = ""
        table_rows = fetch_blocks(bid)
        for i, row in enumerate(table_rows):
            if row.get("type") != "table_row": continue
            cells = row.get("table_row", {}).get("cells", [])
            row_text = " | ".join(rich_text_to_markdown(cell) for cell in cells)
            res += f"{indent}| {row_text} |\n"
            if i == 0: # Add separator after header
                sep = " | ".join("---" for _ in cells)
                res += f"{indent}| {sep} |\n"
        return res

    # ── Child database (embedded view) ──
    elif btype == "child_database":
        title = bdata.get("title", "Database")
        mapped = _resolve_embedded_table_info(bid, title)

        if mapped:
            rel_path, gnosi_table_id = mapped

            # 3. Check if table already has a standard "table" view in the registry
            # We look for a view of type 'table' belonging to this table_id
            existing_view = next((v for v in _view_registry if v.get("table_id") == gnosi_table_id and v.get("type") == "table"), None)

            if existing_view:
                view_id = existing_view["id"]
            else:
                view_id = _bn_id()
                # Register new view in memory (to be saved later)
                _view_registry.append({
                    "id": view_id,
                    "table_id": gnosi_table_id,
                    "name": f"Vista: {title}",
                    "type": "table",
                    "filters": [],
                    "sort": {"field": "last_modified", "direction": "desc"}
                })

            db_props = {
                "database_table_id": gnosi_table_id,
                "viewId": view_id,
                "viewType": "table",
                "source": {
                    "notion_block_id": bid,
                    "notion_title": title,
                    "resolved": True,
                },
            }
            return f"{indent}```gnosi-database\n{json.dumps(db_props, indent=2)}\n{indent}```\n{indent}:::gnosi-ignore\n{indent}[[{title}]]\n{indent}:::\n"
        else:
            unresolved = {
                "database_table_id": None,
                "viewId": None,
                "viewType": "table",
                "source": {
                    "notion_block_id": bid,
                    "notion_title": title,
                    "resolved": False,
                },
            }
            return f"{indent}```gnosi-database\n{json.dumps(unresolved, indent=2)}\n{indent}```\n{indent}:::gnosi-ignore\n{indent}[[{title}]]\n{indent}:::\n"

    elif btype == "link_to_page":
        link_type = bdata.get("type")
        if link_type == "database_id":
            db_id = bdata.get("database_id", "")
            mapped = _resolve_embedded_table_info(db_id, "")
            if mapped:
                _, gnosi_table_id = mapped
                db_props = {
                    "database_table_id": gnosi_table_id,
                    "viewId": None,
                    "viewType": "table",
                    "source": {
                        "notion_database_id": db_id,
                        "resolved": True,
                    },
                }
                return f"{indent}```gnosi-database\n{json.dumps(db_props, indent=2)}\n{indent}```\n"

            unresolved = {
                "database_table_id": None,
                "viewId": None,
                "viewType": "table",
                "source": {
                    "notion_database_id": db_id,
                    "resolved": False,
                },
            }
            return f"{indent}```gnosi-database\n{json.dumps(unresolved, indent=2)}\n{indent}```\n"

        if link_type == "page_id":
            page_id = bdata.get("page_id", "")
            return f"{indent}> 🔗 Pàgina enllaçada: {page_id}\n"

    # ── Synced blocks ──
    elif btype == "synced_block":
        shared = bdata.get("synced_from")
        if shared and shared.get("block_id"):
            try: return convert_blocks_to_markdown(fetch_blocks(shared["block_id"]), indent_level)
            except: return f"{indent}> [synced_block: font inaccessible]\n"
        elif has_children:
            return convert_blocks_to_markdown(fetch_blocks(bid), indent_level)

    return ""

def convert_blocks_to_markdown(blocks: List[Dict], indent_level: int = 0) -> str:
    """Convert a list of Notion blocks to Gnosi Rich Markdown."""
    markdown = ""
    for block in blocks:
        markdown += convert_block_to_markdown(block, indent_level)
    return markdown


# ──────────────────────────────────────────────
#  Database migration
# ──────────────────────────────────────────────


def migrate_database(db_name: str, db_id: str) -> int:
    """Migrate a single Notion database to the vault.
    Ensures path is: {VAULT_PATH}/BD/{DatabaseName}/{TableName}
    """
    print(f"\n{'=' * 50}")
    print(f"Abocant: {db_name} ({db_id})")
    print(f"{'=' * 50}")

    # Build correct hierarchical path
    # Look up in registry first
    rel_path, _ = _reverse_db_map.get(db_id) or _reverse_db_map.get(db_id.replace("-","")) or (None, None)
    
    if not rel_path:
        # Construct fallback path if not in registry
        # We assume database "Cervell Digital" for these migrations as default
        rel_path = f"BD/Cervell Digital/{db_name}"
    
    target_folder = VAULT_PATH / rel_path
    target_folder.mkdir(parents=True, exist_ok=True)
    
    print(f"  📍 Destí: {target_folder}")

    pages = fetch_all_pages(db_id)
    print(f"  Trobades {len(pages)} pàgines.")

    count = 0
    for page in pages:
        page_id = page["id"]
        props = page.get("properties", {})

        frontmatter, title_key = extract_flat_properties(props)
        frontmatter["id"] = page_id

        print(f"  [{count + 1}/{len(pages)}] {title_key}")

        blocks = fetch_blocks(page_id)
        content_markdown = convert_blocks_to_markdown(blocks)

        # Append Obsidian-style relationship links (hidden from Gnosi UI)
        relations_links = []
        for key, val in frontmatter.items():
            # Check for relations (they are lists of UUIDs)
            if isinstance(val, list) and all(isinstance(v, str) and len(v) >= 32 for v in val):
                # We assume these are relations or some list of IDs
                for rid in val:
                    title = _resolve_relation_title(rid)
                    relations_links.append(f"- [[{title}]]")
        
        if relations_links:
            # Join links and wrap in gnosi-ignore directive
            # We add a small header for clarity in Obsidian
            content_markdown += "\n:::gnosi-ignore\n## Relacions\n"
            content_markdown += "\n".join(relations_links)
            content_markdown += "\n:::\n"

        yaml_fm = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False)
        full_content = f"---\n{yaml_fm}---\n{content_markdown}"

        filename = get_safe_filename(title_key) + ".md"
        filepath = target_folder / filename

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(full_content)
        except Exception as e:
            print(f"      ❌ Error escrivint {filename}: {e}")

        count += 1
        time.sleep(RATE_LIMIT_DELAY)

    print(f"  ✅ {db_name}: {count} entrades migrades.")
    return count


def _save_view_registry():
    """Save updated view registry (with new embedded views) to vault_db_registry.json."""
    if not _view_registry:
        return
    registry_path = VAULT_PATH / "BD" / "vault_db_registry.json"
    if not registry_path.exists():
        return
    try:
        with open(registry_path, "r", encoding="utf-8") as f:
            registry = json.load(f)

        existing_ids = {v["id"] for v in registry.get("views", [])}
        new_views = [v for v in _view_registry if v["id"] not in existing_ids]
        if new_views:
            registry.setdefault("views", []).extend(new_views)
            with open(registry_path, "w", encoding="utf-8") as f:
                json.dump(registry, f, ensure_ascii=False, indent=2)
            print(f"\n📝 {len(new_views)} noves vistes afegides al registry.")
    except Exception as e:
        print(f"  ⚠️  Error guardant view registry: {e}")


# ──────────────────────────────────────────────
#  Main
# ──────────────────────────────────────────────


def main():
    if not TOKEN:
        print("❌ NOTION_TOKEN no trobat a .env_shared")
        sys.exit(1)

    # Build reverse maps from vault_db_registry for embedded views
    _build_reverse_maps()

    # Pre-scan for titles to resolve all relations properly
    _populate_id_to_title_cache()

    # Optional argument: migrate a single database
    target_db = sys.argv[1] if len(sys.argv) > 1 else None

    if target_db:
        db_id = DATABASE_MAP.get(target_db)
        if not db_id:
            print(f"❌ Base de dades desconeguda: '{target_db}'")
            print(f"   Disponibles: {', '.join(DATABASE_MAP.keys())}")
            sys.exit(1)
        total = migrate_database(target_db, db_id)
    else:
        total = 0
        for db_name, db_id in DATABASE_MAP.items():
            if not db_id:
                print(f"⚠️  Saltant {db_name}: ID no configurat a .env_shared")
                continue
            total += migrate_database(db_name, db_id)

    # Save any new embedded views discovered during migration
    _save_view_registry()

    print(f"\n🏁 Migració completada. Total: {total} entrades.")


if __name__ == "__main__":
    main()
