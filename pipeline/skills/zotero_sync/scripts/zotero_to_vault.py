"""Zotero → Vault sync: reads local Zotero SQLite and upserts pages into the Vault via API.

Phase 3 robustness:
  - Incremental: skips items whose dateModified is older than `last_sync_at`.
  - Title-based linking: pages without zotero_key but with a matching title get
    their zotero_key filled instead of producing a duplicate (configurable via
    `existing_pages_strategy`).
  - Detailed counters in the JSON summary printed to stdout.
  - Persists `last_sync_at`, `last_sync_z_to_g` and `last_sync_summary` back to
    the config file using a tmp+rename atomic write.
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parents[4]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "zotero_db_config.json"
TEMP_ZOTERO_PATH = "/tmp/zotero_sync_temp.sqlite"
VAULT_API = "http://localhost:8000"


# ---------------------------------------------------------------------------
# Config helpers (atomic write — backend.utils.safe_io is not importable from
# this standalone subprocess, so we replicate the tmp+rename idiom locally).
# ---------------------------------------------------------------------------


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found at {CONFIG_PATH}")
    with open(CONFIG_PATH) as f:
        return json.load(f)


def save_config_atomic(data: dict) -> None:
    """Atomic write: tempfile in same dir + os.replace.

    Guarantees that a crash mid-write never leaves a half-written config.
    """
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".zotero_db_config.", suffix=".tmp", dir=str(CONFIG_PATH.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, CONFIG_PATH)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_zotero_ts(value: str):
    """Zotero stores `dateModified` as 'YYYY-MM-DD HH:MM:SS' (UTC). Returns datetime or None."""
    if not value:
        return None
    s = str(value).strip().replace("T", " ").rstrip("Z")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Text helpers.
# ---------------------------------------------------------------------------


def normalize_text(value: str) -> str:
    """Lowercase, NFD-stripped, alphanumeric+space only. Used as a stable key
    for title-based matching of pre-existing Vault pages.
    """
    if not value:
        return ""
    value = str(value).strip().lower()
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def extract_year(value: str) -> str:
    if not value:
        return ""
    m = re.search(r"(1[5-9]\d\d|20\d\d)", str(value))
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# Zotero SQLite extraction.
# ---------------------------------------------------------------------------


def get_zotero_conn(path: str) -> sqlite3.Connection:
    expanded = os.path.expanduser(path)
    if not os.path.exists(expanded):
        raise FileNotFoundError(f"Zotero DB not found at {expanded}")
    shutil.copy2(expanded, TEMP_ZOTERO_PATH)
    return sqlite3.connect(TEMP_ZOTERO_PATH)


def extract_items(z_conn: sqlite3.Connection) -> list:
    cur = z_conn.cursor()
    cur.execute("""
        SELECT items.itemID, items.key, itemTypes.typeName, items.dateAdded, items.dateModified
        FROM items
        JOIN itemTypes ON items.itemTypeID = itemTypes.itemTypeID
        WHERE itemTypes.typeName NOT IN ('attachment', 'note')
    """)
    items = []
    for item_id, item_key, type_name, date_added, date_modified in cur.fetchall():
        cur.execute("""
            SELECT f.fieldName, dv.value
            FROM itemData id
            JOIN fields f ON id.fieldID = f.fieldID
            JOIN itemDataValues dv ON id.valueID = dv.valueID
            WHERE id.itemID = ?
        """, (item_id,))
        fields = dict(cur.fetchall())

        cur.execute("""
            SELECT c.firstName, c.lastName
            FROM itemCreators ic
            JOIN creators c ON ic.creatorID = c.creatorID
            WHERE ic.itemID = ?
            ORDER BY ic.orderIndex
        """, (item_id,))
        authors = ", ".join(f"{r[0]} {r[1]}".strip() for r in cur.fetchall())

        cur.execute("""
            SELECT t.name FROM itemTags it JOIN tags t ON it.tagID = t.tagID WHERE it.itemID = ?
        """, (item_id,))
        tags = ", ".join(r[0] for r in cur.fetchall())

        items.append({
            "key": item_key,
            "typeName": type_name,
            "dateAdded": date_added,
            "dateModified": date_modified,
            "creators": authors,
            "tags": tags,
            "title": fields.get("title", ""),
            "doi": fields.get("DOI", "") or fields.get("doi", ""),
            "date": fields.get("date", ""),
            "url": fields.get("url", ""),
            "abstractNote": fields.get("abstractNote", ""),
        })
    return items


# ---------------------------------------------------------------------------
# Vault API helpers.
# ---------------------------------------------------------------------------


def get_existing_pages(table_id: str) -> list:
    """Returns the raw list of pages (dicts) of the target table."""
    res = requests.get(f"{VAULT_API}/api/vault/pages/by-table/{table_id}", timeout=30)
    res.raise_for_status()
    data = res.json()
    return data if isinstance(data, list) else data.get("pages", [])


def index_pages(pages: list):
    """Builds two lookup dicts: {zotero_key: page} and {normalized_title: page}.

    The title index ignores empty titles. If two pages collide on the same
    normalized title, the later one wins (deterministic by API order).
    """
    by_key = {}
    by_title = {}
    for p in pages:
        meta = p.get("metadata") or {}
        zkey = meta.get("zotero_key")
        if zkey:
            by_key[zkey] = p
        title = p.get("title") or ""
        norm = normalize_text(title)
        if norm:
            by_title[norm] = p
    return by_key, by_title


def get_property_names(table_id: str) -> dict:
    """Resolves `property_id → property.name actual` via the inspect endpoint.

    Mapping persisteix `property_id` (UUID immutable); el name és cosmètic i pot
    canviar quan l'usuari renombra columnes. Aquesta resolució es fa cada sync.
    """
    res = requests.get(f"{VAULT_API}/api/zotero/inspect/{table_id}", timeout=30)
    res.raise_for_status()
    data = res.json()
    return {p["id"]: p.get("name", "") for p in data.get("properties", []) if p.get("id")}


def build_page_payload(item: dict, mapping: dict, table_id: str, prop_names: dict) -> dict:
    """Builds the `/api/vault/pages` payload using the property's CURRENT name.

    `mapping` is `{zotero_field_id: property_id}`. Resolving the id → name at
    runtime keeps the sync resilient to renames done elsewhere in the UI.
    """
    meta = {"database_table_id": table_id, "source": "Gnosi"}
    for z_field, prop_id in mapping.items():
        if not prop_id:
            continue
        prop_name = prop_names.get(prop_id)
        if not prop_name:
            # Property removed or orphaned id; validate-config will surface this.
            continue
        value = item.get(z_field, "")
        if value:
            meta[prop_name] = value
    return {
        "title": item.get("title") or item.get("key", ""),
        "content": "",
        "metadata": meta,
    }


def page_id_for(page: dict):
    """Returns the page id from any of the keys the Vault API may use."""
    if not page:
        return None
    return page.get("id") or (page.get("metadata") or {}).get("id")


# ---------------------------------------------------------------------------
# Sync logic.
# ---------------------------------------------------------------------------


def sync() -> dict:
    config = load_config()
    if not config.get("enabled"):
        return {"status": "disabled"}

    table_id = config.get("target_table", "")
    mapping = config.get("mapping", {})
    zotero_db = config.get("zotero_db", "~/Zotero/zotero.sqlite")
    strategy = config.get("existing_pages_strategy", "match_by_title")
    last_sync_at = config.get("last_sync_at")
    last_sync_dt = parse_zotero_ts(last_sync_at) if last_sync_at else None

    if not table_id:
        return {"status": "no_target_table"}

    prop_names = get_property_names(table_id)

    z_conn = get_zotero_conn(zotero_db)
    try:
        items = extract_items(z_conn)
    finally:
        z_conn.close()
        if os.path.exists(TEMP_ZOTERO_PATH):
            os.remove(TEMP_ZOTERO_PATH)

    pages = get_existing_pages(table_id)
    by_key, by_title = index_pages(pages)

    counters = {
        "created": 0,
        "updated": 0,
        "linked": 0,        # match per títol → omplim zotero_key
        "skipped_unchanged": 0,
        "skipped_no_match": 0,
        "errors": 0,
    }

    for item in items:
        zkey = item.get("key")
        item_modified_dt = parse_zotero_ts(item.get("dateModified"))

        # Sync incremental: si l'ítem no ha canviat des de l'última sync, salta.
        if last_sync_dt and item_modified_dt and item_modified_dt <= last_sync_dt:
            counters["skipped_unchanged"] += 1
            continue

        existing_page = by_key.get(zkey) if zkey else None
        match_kind = "key" if existing_page else None

        if existing_page is None and strategy == "match_by_title":
            norm_title = normalize_text(item.get("title", ""))
            if norm_title and norm_title in by_title:
                existing_page = by_title[norm_title]
                match_kind = "title"

        payload = build_page_payload(item, mapping, table_id, prop_names)

        try:
            if existing_page is not None:
                pid = page_id_for(existing_page)
                if not pid:
                    counters["skipped_no_match"] += 1
                    continue
                r = requests.put(f"{VAULT_API}/api/vault/pages/{pid}", json=payload, timeout=30)
                r.raise_for_status()
                if match_kind == "title":
                    counters["linked"] += 1
                else:
                    counters["updated"] += 1
            else:
                r = requests.post(f"{VAULT_API}/api/vault/pages", json=payload, timeout=30)
                r.raise_for_status()
                counters["created"] += 1
        except requests.RequestException as e:
            counters["errors"] += 1
            print(f"[zotero→vault] error syncing item {zkey}: {e}", file=sys.stderr)

    # Persisteix timestamps i resum al config (idempotent).
    summary = {
        "direction": "z_to_g",
        "ts": now_iso(),
        "items_seen": len(items),
        "pages_seen": len(pages),
        "strategy": strategy,
        **counters,
    }

    fresh = load_config()
    fresh["last_sync_at"] = summary["ts"]
    fresh["last_sync_z_to_g"] = summary["ts"]
    fresh["last_sync_summary"] = summary
    save_config_atomic(fresh)

    return summary


if __name__ == "__main__":
    out = sync()
    print(json.dumps(out, ensure_ascii=False))
