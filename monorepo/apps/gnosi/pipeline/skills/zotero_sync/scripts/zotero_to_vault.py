"""Zotero → Vault sync: reads local Zotero SQLite and upserts pages into the Vault via API."""

import json
import os
import re
import shutil
import sqlite3
import unicodedata
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parents[4]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "zotero_db_config.json"
TEMP_ZOTERO_PATH = "/tmp/zotero_sync_temp.sqlite"
VAULT_API = "http://localhost:8000"


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found at {CONFIG_PATH}")
    with open(CONFIG_PATH) as f:
        return json.load(f)


def normalize_text(value: str) -> str:
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


def get_zotero_conn(path: str) -> sqlite3.Connection:
    expanded = os.path.expanduser(path)
    if not os.path.exists(expanded):
        raise FileNotFoundError(f"Zotero DB not found at {expanded}")
    shutil.copy2(expanded, TEMP_ZOTERO_PATH)
    return sqlite3.connect(TEMP_ZOTERO_PATH)


def extract_items(z_conn: sqlite3.Connection) -> list[dict]:
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


def get_existing_pages(table_id: str) -> dict[str, dict]:
    """Returns a dict of zotero_key → page from the vault table."""
    res = requests.get(f"{VAULT_API}/api/vault/pages/by-table/{table_id}", timeout=30)
    res.raise_for_status()
    pages = res.json() if isinstance(res.json(), list) else res.json().get("pages", [])
    return {p.get("metadata", {}).get("zotero_key", ""): p for p in pages if p.get("metadata", {}).get("zotero_key")}


def get_property_names(table_id: str) -> dict[str, str]:
    """Resolves `property_id → property.name` actual via the inspect endpoint.

    Mapping persisteix `property_id` (UUID immutable); el name és cosmètic i pot
    canviar quan l'usuari renombra columnes. Aquesta resolució es fa cada sync.
    """
    res = requests.get(f"{VAULT_API}/api/zotero/inspect/{table_id}", timeout=30)
    res.raise_for_status()
    data = res.json()
    return {p["id"]: p.get("name", "") for p in data.get("properties", []) if p.get("id")}


def build_page_payload(item: dict, mapping: dict, table_id: str, prop_names: dict[str, str]) -> dict:
    """Construeix el payload per `/api/vault/pages` amb keys de metadata actualitzades.

    `mapping` és `{zotero_field_id: property_id}`. Resolem property_id → name actual
    abans d'escriure al metadata, així renombrar columnes mai trenca el sync.
    """
    meta = {"database_table_id": table_id, "source": "Gnosi"}
    for z_field, prop_id in mapping.items():
        if not prop_id:
            continue
        prop_name = prop_names.get(prop_id)
        if not prop_name:
            # Property eliminada o id orfe — saltem silenciosament; validate-config
            # ho reportarà a l'usuari.
            continue
        value = item.get(z_field, "")
        if value:
            meta[prop_name] = value
    return {
        "title": item.get("title") or item.get("key", ""),
        "content": "",
        "metadata": meta,
    }


def sync() -> None:
    config = load_config()
    if not config.get("enabled"):
        print("Zotero integration is disabled.")
        return

    table_id = config.get("target_table", "")
    mapping = config.get("mapping", {})
    zotero_db = config.get("zotero_db", "~/Zotero/zotero.sqlite")

    if not table_id:
        print("No target table configured.")
        return

    prop_names = get_property_names(table_id)

    z_conn = get_zotero_conn(zotero_db)
    try:
        items = extract_items(z_conn)
    finally:
        z_conn.close()
        if os.path.exists(TEMP_ZOTERO_PATH):
            os.remove(TEMP_ZOTERO_PATH)

    existing = get_existing_pages(table_id)
    created = updated = 0

    for item in items:
        payload = build_page_payload(item, mapping, table_id, prop_names)
        zkey = item["key"]
        if zkey in existing:
            page_id = existing[zkey].get("id") or existing[zkey].get("metadata", {}).get("id")
            if page_id:
                requests.put(f"{VAULT_API}/api/vault/pages/{page_id}", json=payload, timeout=30)
                updated += 1
        else:
            requests.post(f"{VAULT_API}/api/vault/pages", json=payload, timeout=30)
            created += 1

    print(f"Zotero→Vault sync done. Created: {created}, Updated: {updated}")


if __name__ == "__main__":
    sync()
