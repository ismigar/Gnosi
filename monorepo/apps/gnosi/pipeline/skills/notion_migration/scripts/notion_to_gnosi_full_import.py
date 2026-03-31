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
#  Environment & Configuration
# ──────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[7]  # -> Projectes/
ENV_SHARED = PROJECT_ROOT / ".env_shared"

if ENV_SHARED.exists():
    load_dotenv(ENV_SHARED, override=True)

TOKEN = os.getenv("NOTION_TOKEN")
VAULT_ROOT = (
    os.getenv("VAULT_PATH")
    or os.getenv("DIGITAL_BRAIN_VAULT_PATH")
    or os.getenv("gnosi_VAULT_PATH")
)

if not VAULT_ROOT:
    print("❌ ERROR: No s'ha trobat cap ruta al Vault (VAULT_PATH).")
    print("Siusplau, configura la carpeta structural a settings o al fitxer .env_shared.")
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

# Reverse map: Notion DB ID → (vault folder name, Gnosi table_id from registry)
_reverse_db_map: Dict[str, Tuple[str, str]] = {}
_view_registry: List[Dict] = []


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
            if nid:
                table_folder = table.get("folder", "")
                db_id = table.get("database_id")
                db_folder = db_folders.get(db_id, "BD") # Default to BD if not found
                
                # Full relative path: BD/Database/Table
                full_path = f"{db_folder}/{table_folder}".replace("//", "/")
                _reverse_db_map[nid] = (full_path, nid)
                _reverse_db_map[nid.replace("-", "")] = (full_path, nid)

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


def rich_text_to_blocknote(rich_text_array: list) -> list:
    """Convert Notion rich_text to BlockNote inline content items.

    Returns list of {"type": "text", "text": "...", "styles": {...}}.
    """
    items = []
    for rt in rich_text_array:
        text = rt.get("plain_text", "")
        if not text:
            continue
        annots = rt.get("annotations", {})
        href = rt.get("href")
        styles = {}

        if annots.get("bold"):
            styles["bold"] = True
        if annots.get("italic"):
            styles["italic"] = True
        if annots.get("strikethrough"):
            styles["strike"] = True
        if annots.get("code"):
            styles["code"] = True

        color = annots.get("color", "default")
        if color and color != "default":
            bn_color = _notion_color_to_blocknote(color, _is_background_color(color))
            if _is_background_color(color):
                styles["backgroundColor"] = bn_color
            else:
                styles["textColor"] = bn_color

        if rt.get("type") == "mention":
            mention = rt.get("mention", {})
            if mention.get("type") == "page":
                page_id = mention["page"]["id"]
                text = f"{text} (notion://page/{page_id})"
        elif href:
            text = f"{text} ({href})"

        items.append({"type": "text", "text": text, "styles": styles})

    return items if items else [{"type": "text", "text": "", "styles": {}}]


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


def convert_block_to_blocknote(block: dict) -> List[Dict]:
    """Convert a single Notion block to one or more BlockNote JSON blocks.

    Returns a list because some Notion blocks produce multiple BlockNote blocks
    (e.g., table rows → multiple paragraph blocks).
    """
    btype = block.get("type")
    if not btype:
        return []
    bdata = block.get(btype, {})
    has_children = block.get("has_children", False)
    bid = block["id"]
    results = []

    def _make_block(
        bn_type, content=None, children=None, extra_props=None, block_data=None
    ):
        data = block_data or bdata
        props = {"textAlignment": "left"}
        props.update(_extract_block_colors(data))
        if extra_props:
            props.update(extra_props)
        return {
            "id": _bn_id(),
            "type": bn_type,
            "props": props,
            "content": content if content is not None else [],
            "children": children if children is not None else [],
        }

    inline = rich_text_to_blocknote(bdata.get("rich_text", []))

    # ── Text blocks ──
    if btype == "paragraph":
        children = []
        if has_children:
            children = convert_blocks_to_blocknote(fetch_blocks(bid))
        results.append(_make_block("paragraph", inline, children))

    elif btype in ("heading_1", "heading_2", "heading_3"):
        level = btype.split("_")[1]
        results.append(_make_block(f"heading{level}", inline))

    elif btype == "bulleted_list_item":
        children = []
        if has_children:
            children = convert_blocks_to_blocknote(fetch_blocks(bid))
        results.append(_make_block("bulletListItem", inline, children))

    elif btype == "numbered_list_item":
        children = []
        if has_children:
            children = convert_blocks_to_blocknote(fetch_blocks(bid))
        results.append(_make_block("numberedListItem", inline, children))

    elif btype == "to_do":
        checked = bdata.get("checked", False)
        children = []
        if has_children:
            children = convert_blocks_to_blocknote(fetch_blocks(bid))
        results.append(
            _make_block("checkListItem", inline, children, {"checked": checked})
        )

    elif btype == "quote":
        children = []
        if has_children:
            children = convert_blocks_to_blocknote(fetch_blocks(bid))
        results.append(_make_block("quote", inline, children))

    elif btype == "callout":
        icon = bdata.get("icon", {}).get("emoji", "💡")
        caption_text = f"{icon} "
        for item in inline:
            caption_text += item.get("text", "")
        caption_inline = [{"type": "text", "text": caption_text, "styles": {}}]
        children = []
        if has_children:
            children = convert_blocks_to_blocknote(fetch_blocks(bid))
        results.append(_make_block("quote", caption_inline, children))

    elif btype == "toggle":
        summary_text = "".join(item.get("text", "") for item in inline)
        bold_inline = [{"type": "text", "text": summary_text, "styles": {"bold": True}}]
        children = []
        if has_children:
            children = convert_blocks_to_blocknote(fetch_blocks(bid))
        results.append(_make_block("paragraph", bold_inline, children))

    elif btype == "code":
        code_text = "".join(t.get("plain_text", "") for t in bdata.get("rich_text", []))
        lang = bdata.get("language", "")
        results.append(
            _make_block(
                "codeBlock",
                [{"type": "text", "text": code_text, "styles": {}}],
                extra_props={"language": lang},
            )
        )

    elif btype == "equation":
        expr = bdata.get("expression", "")
        results.append(
            _make_block("codeBlock", [{"type": "text", "text": expr, "styles": {}}])
        )

    elif btype == "divider":
        results.append(
            {
                "id": _bn_id(),
                "type": "divider",
                "props": {},
                "content": [],
                "children": [],
            }
        )

    # ── Media blocks ──
    elif btype == "image":
        img_type = bdata.get("type")
        url = (
            bdata.get("file", {}).get("url")
            if img_type == "file"
            else bdata.get("external", {}).get("url")
        )
        if url:
            orig_name = os.path.basename(urllib.parse.urlparse(url).path) or "image"
            local = download_asset(url, orig_name)
            caption_text = "".join(
                t.get("plain_text", "") for t in bdata.get("caption", [])
            )
            results.append(
                {
                    "id": _bn_id(),
                    "type": "imageBlock" if False else "image",
                    "props": {
                        "url": local if local else url,
                        "caption": caption_text,
                        "textAlignment": "left",
                        "backgroundColor": "default",
                        "textColor": "default",
                    },
                    "content": [],
                    "children": [],
                }
            )
        else:
            results.append(
                _make_block(
                    "paragraph",
                    [{"type": "text", "text": "[Imatge sense URL]", "styles": {}}],
                )
            )

    elif btype in ("file", "pdf", "video", "audio"):
        url = (
            bdata.get("file", {}).get("url")
            if bdata.get("type") == "file"
            else bdata.get("external", {}).get("url")
        )
        label = (
            "".join(t.get("plain_text", "") for t in bdata.get("caption", []))
            or btype.upper()
        )
        if url:
            orig_name = (
                os.path.basename(urllib.parse.urlparse(url).path) or f"notion_{btype}"
            )
            local = download_asset(url, orig_name)
            link_url = local if local else url
        else:
            link_url = ""
        results.append(
            _make_block(
                "paragraph",
                [
                    {"type": "text", "text": f"📎 {label}", "styles": {}},
                    {"type": "text", "text": f" ({link_url})", "styles": {}},
                ],
            )
        )

    # ── Table ──
    elif btype == "table":
        table_rows = fetch_blocks(bid)
        for row in table_rows:
            if row.get("type") != "table_row":
                continue
            cells = row.get("table_row", {}).get("cells", [])
            cell_text = " | ".join(
                "".join(t.get("plain_text", "") for t in cell) for cell in cells
            )
            results.append(
                _make_block(
                    "paragraph",
                    [{"type": "text", "text": cell_text, "styles": {}}],
                )
            )

    # ── Columns ──
    elif btype == "column_list":
        columns_bn = []
        if has_children:
            child_columns = fetch_blocks(bid)
            for col_block in child_columns:
                if col_block.get("type") != "column":
                    continue
                col_children = []
                if col_block.get("has_children", False):
                    col_children = convert_blocks_to_blocknote(
                        fetch_blocks(col_block["id"])
                    )
                if not col_children:
                    col_children = [
                        {
                            "id": _bn_id(),
                            "type": "paragraph",
                            "props": {
                                "textAlignment": "left",
                                "backgroundColor": "default",
                                "textColor": "default",
                            },
                            "content": [],
                            "children": [],
                        }
                    ]
                columns_bn.append(
                    {
                        "id": _bn_id(),
                        "type": "column",
                        "props": {},
                        "content": [],
                        "children": col_children,
                    }
                )
        if not columns_bn:
            columns_bn = [
                {
                    "id": _bn_id(),
                    "type": "column",
                    "props": {},
                    "content": [],
                    "children": [
                        {
                            "id": _bn_id(),
                            "type": "paragraph",
                            "props": {
                                "textAlignment": "left",
                                "backgroundColor": "default",
                                "textColor": "default",
                            },
                            "content": [],
                            "children": [],
                        }
                    ],
                }
            ]
        results.append(
            {
                "id": _bn_id(),
                "type": "columnList",
                "props": {"backgroundColor": "default"},
                "children": columns_bn,
            }
        )

    elif btype == "column":
        if has_children:
            col_children = convert_blocks_to_blocknote(fetch_blocks(bid))
            results.append(
                {
                    "id": _bn_id(),
                    "type": "column",
                    "props": {},
                    "content": [],
                    "children": col_children,
                }
            )

    # ── Embedded / linked content ──
    elif btype == "embed":
        url = bdata.get("url", "")
        results.append(
            _make_block(
                "paragraph",
                [{"type": "text", "text": f"🔗 Embed: {url}", "styles": {}}],
            )
        )

    elif btype == "bookmark":
        url = bdata.get("url", "")
        caption = (
            "".join(t.get("plain_text", "") for t in bdata.get("caption", [])) or url
        )
        results.append(
            _make_block(
                "paragraph",
                [{"type": "text", "text": f"🔖 {caption}", "styles": {}}],
            )
        )

    elif btype == "link_preview":
        url = bdata.get("url", "")
        results.append(
            _make_block(
                "paragraph",
                [{"type": "text", "text": f"🔗 {url}", "styles": {}}],
            )
        )

    elif btype == "link_to_page":
        page_id = bdata.get("page_id") or bdata.get("database_id", "")
        results.append(
            _make_block(
                "paragraph",
                [
                    {
                        "type": "text",
                        "text": f"🔗 Enllaç a pàgina (notion://page/{page_id})",
                        "styles": {},
                    }
                ],
            )
        )

    # ── Synced blocks ──
    elif btype == "synced_block":
        synced_from = bdata.get("synced_from")
        if synced_from and synced_from.get("block_id"):
            try:
                synced_children = convert_blocks_to_blocknote(
                    fetch_blocks(synced_from["block_id"])
                )
                results.extend(synced_children)
            except Exception:
                results.append(
                    _make_block(
                        "paragraph",
                        [
                            {
                                "type": "text",
                                "text": "[synced_block: font inaccessible]",
                                "styles": {},
                            }
                        ],
                    )
                )
        elif has_children:
            synced_children = convert_blocks_to_blocknote(fetch_blocks(bid))
            results.extend(synced_children)

    # ── Child page ──
    elif btype == "child_page":
        title = bdata.get("title", "Untitled")
        results.append(
            _make_block(
                "paragraph",
                [
                    {
                        "type": "text",
                        "text": f"📄 {title} (subpàgina)",
                        "styles": {"bold": True},
                    }
                ],
            )
        )

    # ── Child database (embedded view) ──
    elif btype == "child_database":
        title = bdata.get("title", "Database")
        # Notion database IDs can be block IDs OR found in parent/id
        notion_id_raw = bid
        notion_id_norm = bid.replace("-", "")

        # Try to find matching Gnosi table
        folder_name, gnosi_table_id = _reverse_db_map.get(notion_id_raw) or _reverse_db_map.get(notion_id_norm) or (None, None)

        if gnosi_table_id:
            # Create a database block pointing to the Gnosi table
            db_view_id = _bn_id()
            results.append(
                {
                    "id": _bn_id(),
                    "type": "database",
                    "props": {
                        "database_table_id": gnosi_table_id,
                        "viewId": db_view_id,
                        "viewType": "table",
                    },
                    "children": [],
                }
            )
            # Register a default view for this table
            _view_registry.append(
                {
                    "id": db_view_id,
                    "table_id": gnosi_table_id,
                    "name": title,
                    "type": "table",
                    "filters": [],
                    "sort": {"field": "last_modified", "direction": "desc"},
                }
            )
            print(
                f"      🔗 Vista incrustada: '{title}' → taula Gnosi {gnosi_table_id}"
            )
        else:
            # Fallback: informational callout
            results.append(
                _make_block(
                    "quote",
                    [
                        {
                            "type": "text",
                            "text": f"🗃️ {title}",
                            "styles": {"bold": True},
                        },
                        {
                            "type": "text",
                            "text": " (vista incrustada — taula no trobada al registry)",
                            "styles": {},
                        },
                    ],
                )
            )

    # ── Fallback ──
    else:
        results.append(
            _make_block(
                "paragraph",
                [
                    {
                        "type": "text",
                        "text": f"[bloc no suportat: {btype}]",
                        "styles": {},
                    }
                ],
            )
        )

    return results


def convert_blocks_to_blocknote(blocks: List[Dict]) -> List[Dict]:
    """Convert a list of Notion blocks to a BlockNote JSON array."""
    bn_blocks = []
    for block in blocks:
        bn_blocks.extend(convert_block_to_blocknote(block))
    return bn_blocks


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
        bn_blocks = convert_blocks_to_blocknote(blocks)
        content_json = json.dumps(bn_blocks, ensure_ascii=False)

        yaml_fm = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False)
        full_content = f"---\n{yaml_fm}---\n{content_json}"

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
