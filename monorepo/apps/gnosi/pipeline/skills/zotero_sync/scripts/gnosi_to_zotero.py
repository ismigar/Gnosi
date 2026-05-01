"""Vault → Zotero sync: reads modified pages from Vault and writes them to local Zotero SQLite."""

import json
import os
import re
import shutil
import sqlite3
import subprocess
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parents[4]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "zotero_db_config.json"
TEMP_ZOTERO_PATH = "/tmp/gnosi_to_zotero_temp.sqlite"
VAULT_API = "http://localhost:8000"

UPDATABLE_FIELDS = {
    "title": ("title", "title"),
    "url": ("url", "url"),
    "doi": ("DOI", "text"),
    "abstractNote": ("abstractNote", "text"),
    "date": ("date", "text"),
}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found at {CONFIG_PATH}")
    with open(CONFIG_PATH) as f:
        return json.load(f)


def zotero_running() -> bool:
    result = subprocess.run(["pgrep", "-x", "Zotero"], capture_output=True)
    return result.returncode == 0


def get_pages(table_id: str) -> list[dict]:
    res = requests.get(f"{VAULT_API}/api/vault/pages/by-table/{table_id}", timeout=30)
    res.raise_for_status()
    data = res.json()
    return data if isinstance(data, list) else data.get("pages", [])


def get_zotero_conn(path: str) -> sqlite3.Connection:
    expanded = os.path.expanduser(path)
    if not os.path.exists(expanded):
        raise FileNotFoundError(f"Zotero DB not found at {expanded}")
    shutil.copy2(expanded, TEMP_ZOTERO_PATH)
    return sqlite3.connect(TEMP_ZOTERO_PATH)


def get_field_id(z_conn: sqlite3.Connection, field_name: str) -> int | None:
    row = z_conn.execute("SELECT fieldID FROM fields WHERE fieldName = ?", (field_name,)).fetchone()
    return row[0] if row else None


def get_or_create_value_id(z_conn: sqlite3.Connection, value: str) -> int:
    row = z_conn.execute("SELECT valueID FROM itemDataValues WHERE value = ?", (value,)).fetchone()
    if row:
        return row[0]
    z_conn.execute("INSERT INTO itemDataValues (value) VALUES (?)", (value,))
    return z_conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def update_item_field(z_conn: sqlite3.Connection, item_id: int, field_name: str, value: str) -> None:
    field_id = get_field_id(z_conn, field_name)
    if field_id is None:
        return
    value_id = get_or_create_value_id(z_conn, value)
    existing = z_conn.execute(
        "SELECT valueID FROM itemData WHERE itemID = ? AND fieldID = ?", (item_id, field_id)
    ).fetchone()
    if existing:
        z_conn.execute(
            "UPDATE itemData SET valueID = ? WHERE itemID = ? AND fieldID = ?",
            (value_id, item_id, field_id),
        )
    else:
        z_conn.execute(
            "INSERT INTO itemData (itemID, fieldID, valueID) VALUES (?, ?, ?)",
            (item_id, field_id, value_id),
        )


def get_item_id_by_key(z_conn: sqlite3.Connection, key: str) -> int | None:
    row = z_conn.execute("SELECT itemID FROM items WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def sync() -> None:
    config = load_config()
    if not config.get("enabled"):
        print("Zotero integration is disabled.")
        return

    if zotero_running():
        print("ERROR: Zotero is open. Close Zotero before running Gnosi → Zotero sync.")
        return

    table_id = config.get("target_table", "")
    mapping = config.get("mapping", {})
    zotero_db = config.get("zotero_db", "~/Zotero/zotero.sqlite")

    if not table_id:
        print("No target table configured.")
        return

    vault_field_to_zotero = {v: k for k, v in mapping.items()}
    pages = get_pages(table_id)

    z_conn = get_zotero_conn(zotero_db)
    updated = skipped = 0

    try:
        for page in pages:
            meta = page.get("metadata", {})
            zkey = meta.get("zotero_key") or meta.get(mapping.get("key", "zotero_key"))
            if not zkey:
                skipped += 1
                continue

            item_id = get_item_id_by_key(z_conn, zkey)
            if item_id is None:
                skipped += 1
                continue

            for vault_field, zotero_field in vault_field_to_zotero.items():
                if zotero_field not in UPDATABLE_FIELDS:
                    continue
                zotero_db_field = UPDATABLE_FIELDS[zotero_field][0]
                value = meta.get(vault_field) or (page.get("title") if vault_field == mapping.get("title") else "")
                if value:
                    update_item_field(z_conn, item_id, zotero_db_field, str(value))

            z_conn.execute(
                "UPDATE items SET dateModified = datetime('now') WHERE itemID = ?", (item_id,)
            )
            updated += 1

        z_conn.commit()
    finally:
        z_conn.close()

    # Write back the modified copy to the real Zotero DB
    expanded = os.path.expanduser(zotero_db)
    shutil.copy2(TEMP_ZOTERO_PATH, expanded)
    if os.path.exists(TEMP_ZOTERO_PATH):
        os.remove(TEMP_ZOTERO_PATH)

    print(f"Vault→Zotero sync done. Updated: {updated}, Skipped: {skipped}")


if __name__ == "__main__":
    sync()
