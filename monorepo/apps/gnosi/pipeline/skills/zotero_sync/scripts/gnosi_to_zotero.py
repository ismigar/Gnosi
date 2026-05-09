"""Vault → Zotero sync: reads modified pages from Vault and writes them to local Zotero SQLite.

Phase 3 robustness:
  - `read_only` Zotero fields (`dateAdded`, `dateModified`, `key`) are never
    written back to sqlite — only Zotero itself should mutate them.
  - Persists `last_sync_g_to_z` and `last_sync_summary` back to the config
    using a tmp+rename atomic write.
  - Detailed counters in the JSON summary printed to stdout.
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parents[4]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "zotero_db_config.json"
TEMP_ZOTERO_PATH = "/tmp/gnosi_to_zotero_temp.sqlite"
VAULT_API = "http://localhost:8000"

# Zotero `fields.fieldName` → (target field name in sqlite, kind hint).
# Only fields the user can sensibly edit from Gnosi appear here. The keys
# match the canonical Zotero field ids used everywhere in the integration.
UPDATABLE_FIELDS = {
    "title": ("title", "title"),
    "url": ("url", "url"),
    "doi": ("DOI", "text"),
    "abstractNote": ("abstractNote", "text"),
    "date": ("date", "text"),
}

# Fields owned by Zotero — never propagate from Vault to sqlite.
READ_ONLY_FIELDS = {"dateAdded", "dateModified", "key", "typeName", "tags", "creators"}


# ---------------------------------------------------------------------------
# Config helpers (atomic write — see zotero_to_vault.py for rationale).
# ---------------------------------------------------------------------------


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found at {CONFIG_PATH}")
    with open(CONFIG_PATH) as f:
        return json.load(f)


def save_config_atomic(data: dict) -> None:
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


def zotero_running() -> bool:
    result = subprocess.run(["pgrep", "-x", "Zotero"], capture_output=True)
    return result.returncode == 0


# ---------------------------------------------------------------------------
# Vault & Zotero accessors.
# ---------------------------------------------------------------------------


def get_pages(table_id: str) -> list:
    res = requests.get(f"{VAULT_API}/api/vault/pages/by-table/{table_id}", timeout=30)
    res.raise_for_status()
    data = res.json()
    return data if isinstance(data, list) else data.get("pages", [])


def get_property_names(table_id: str) -> dict:
    """Resolves `property_id → property.name actual` via the inspect endpoint."""
    res = requests.get(f"{VAULT_API}/api/zotero/inspect/{table_id}", timeout=30)
    res.raise_for_status()
    data = res.json()
    return {p["id"]: p.get("name", "") for p in data.get("properties", []) if p.get("id")}


def get_zotero_conn(path: str) -> sqlite3.Connection:
    expanded = os.path.expanduser(path)
    if not os.path.exists(expanded):
        raise FileNotFoundError(f"Zotero DB not found at {expanded}")
    shutil.copy2(expanded, TEMP_ZOTERO_PATH)
    return sqlite3.connect(TEMP_ZOTERO_PATH)


def get_field_id(z_conn: sqlite3.Connection, field_name: str):
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


def get_item_id_by_key(z_conn: sqlite3.Connection, key: str):
    row = z_conn.execute("SELECT itemID FROM items WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def writable_zfield_to_meta_key(mapping: dict, prop_names: dict) -> dict:
    """Returns `{zotero_field: vault_metadata_key}` for fields we should write
    back. Skips read-only fields and any mapping entry whose property has
    been deleted.
    """
    out = {}
    for z_field, pid in (mapping or {}).items():
        if z_field in READ_ONLY_FIELDS:
            continue
        if z_field not in UPDATABLE_FIELDS:
            continue
        if not pid or pid not in prop_names:
            continue
        out[z_field] = prop_names[pid]
    return out


# ---------------------------------------------------------------------------
# Sync logic.
# ---------------------------------------------------------------------------


def sync() -> dict:
    config = load_config()
    if not config.get("enabled"):
        return {"status": "disabled"}

    if zotero_running():
        return {"status": "zotero_open"}

    table_id = config.get("target_table", "")
    mapping = config.get("mapping", {})
    zotero_db = config.get("zotero_db", "~/Zotero/zotero.sqlite")

    if not table_id:
        return {"status": "no_target_table"}

    prop_names = get_property_names(table_id)
    zfield_to_meta_key = writable_zfield_to_meta_key(mapping, prop_names)

    # zotero_key i title sí els llegim del metadata, però no els ESCRIVIM —
    # només els usem per identificar la pàgina.
    zkey_meta_key = (prop_names.get(mapping.get("key")) if mapping.get("key") else None) or "zotero_key"
    title_pid = mapping.get("title")
    title_meta_key = prop_names.get(title_pid) if title_pid else None

    pages = get_pages(table_id)

    z_conn = get_zotero_conn(zotero_db)
    counters = {"updated": 0, "skipped_no_key": 0, "skipped_unknown_item": 0, "errors": 0}

    try:
        for page in pages:
            meta = page.get("metadata", {})
            zkey = meta.get(zkey_meta_key) or meta.get("zotero_key")
            if not zkey:
                counters["skipped_no_key"] += 1
                continue

            try:
                item_id = get_item_id_by_key(z_conn, zkey)
            except sqlite3.Error as e:
                counters["errors"] += 1
                print(f"[gnosi→zotero] sqlite error for {zkey}: {e}", file=sys.stderr)
                continue

            if item_id is None:
                counters["skipped_unknown_item"] += 1
                continue

            wrote_anything = False
            for z_field, meta_key in zfield_to_meta_key.items():
                zotero_db_field = UPDATABLE_FIELDS[z_field][0]
                # Title pot venir al camp `title` de la pàgina si no hi ha
                # metadata explícita amb la mateixa clau.
                value = meta.get(meta_key)
                if not value and z_field == "title" and title_meta_key:
                    value = page.get("title")
                if value:
                    update_item_field(z_conn, item_id, zotero_db_field, str(value))
                    wrote_anything = True

            if wrote_anything:
                z_conn.execute(
                    "UPDATE items SET dateModified = datetime('now') WHERE itemID = ?", (item_id,)
                )
                counters["updated"] += 1

        z_conn.commit()
    finally:
        z_conn.close()

    # Write back the modified copy to the real Zotero DB
    expanded = os.path.expanduser(zotero_db)
    shutil.copy2(TEMP_ZOTERO_PATH, expanded)
    if os.path.exists(TEMP_ZOTERO_PATH):
        os.remove(TEMP_ZOTERO_PATH)

    summary = {
        "direction": "g_to_z",
        "ts": now_iso(),
        "pages_seen": len(pages),
        "writable_fields": list(zfield_to_meta_key.keys()),
        **counters,
    }

    fresh = load_config()
    fresh["last_sync_at"] = summary["ts"]
    fresh["last_sync_g_to_z"] = summary["ts"]
    fresh["last_sync_summary"] = summary
    save_config_atomic(fresh)

    return summary


if __name__ == "__main__":
    out = sync()
    print(json.dumps(out, ensure_ascii=False))
