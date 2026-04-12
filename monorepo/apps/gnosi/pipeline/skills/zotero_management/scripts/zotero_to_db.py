import sqlite3
import os
import shutil
import json
import re
import unicodedata
from pathlib import Path

# =============================================================================
# ENVIRONMENT & PATHS
# =============================================================================
BASE_DIR = Path(__file__).resolve().parents[4]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "zotero_db_config.json"
TEMP_ZOTERO_PATH = "/tmp/zotero_sync_temp.sqlite"


def normalize_text(value):
    """Normalize text for fuzzy matching: lowercase, strip accents and punctuation."""
    if value is None:
        return ""
    value = str(value).strip().lower()
    if not value:
        return ""
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def extract_year(value):
    """Extract first 4-digit year from a date-like string."""
    if value is None:
        return ""
    match = re.search(r"(1[5-9]\d\d|20\d\d)", str(value))
    return match.group(1) if match else ""


def first_author_fingerprint(creators):
    """Use first author token as lightweight fingerprint key."""
    if not creators:
        return ""
    first = str(creators).split(",", 1)[0].strip()
    return normalize_text(first)


def quote_ident(ident):
    """Quote SQL identifiers safely after validating allowed chars."""
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", ident or ""):
        raise ValueError(f"Invalid SQL identifier: {ident}")
    return f'"{ident}"'


def get_table_columns(conn, table_name):
    q_table = quote_ident(table_name)
    rows = conn.execute(f"PRAGMA table_info({q_table})").fetchall()
    return {r[1] for r in rows}


def find_existing_row(conn, table_name, mapping, row_payload):
    """Layered matching:
    1) strong key (zotero key/uri),
    2) DOI exact,
    3) normalized fingerprint (title + year + first author).
    """
    table_q = quote_ident(table_name)
    columns = get_table_columns(conn, table_name)

    key_col = mapping.get("key")
    title_col = mapping.get("title")
    creators_col = mapping.get("creators")
    date_col = mapping.get("date")
    doi_col = mapping.get("doi")

    # 1) Strong key match
    if key_col and key_col in columns and row_payload.get("key"):
        q = f"SELECT rowid, * FROM {table_q} WHERE {quote_ident(key_col)} = ? LIMIT 1"
        row = conn.execute(q, (row_payload.get("key"),)).fetchone()
        if row:
            return row, "key"

    # 2) DOI exact
    if doi_col and doi_col in columns and row_payload.get("doi"):
        q = f"SELECT rowid, * FROM {table_q} WHERE {quote_ident(doi_col)} = ? LIMIT 1"
        row = conn.execute(q, (row_payload.get("doi"),)).fetchone()
        if row:
            return row, "doi"

    # 3) Fingerprint fallback
    if not (title_col and creators_col and date_col):
        return None, None
    if not (title_col in columns and creators_col in columns and date_col in columns):
        return None, None

    title_fp = normalize_text(row_payload.get("title"))
    year_fp = extract_year(row_payload.get("date"))
    author_fp = first_author_fingerprint(row_payload.get("creators"))
    if not title_fp:
        return None, None

    q = (
        f"SELECT rowid, {quote_ident(title_col)}, {quote_ident(creators_col)}, {quote_ident(date_col)} "
        f"FROM {table_q}"
    )
    for row in conn.execute(q).fetchall():
        existing_title = normalize_text(row[1])
        existing_author = first_author_fingerprint(row[2])
        existing_year = extract_year(row[3])

        title_ok = existing_title == title_fp
        year_ok = (not year_fp) or (existing_year == year_fp)
        author_ok = (not author_fp) or (existing_author == author_fp)
        if title_ok and year_ok and author_ok:
            rowid = row[0]
            full_row = conn.execute(f"SELECT rowid, * FROM {table_q} WHERE rowid = ?", (rowid,)).fetchone()
            return full_row, "fingerprint"

    return None, None


def update_row_by_rowid(conn, table_name, mapping, data_map, rowid):
    """Update row while preserving legacy PK when matched by fallback."""
    table_q = quote_ident(table_name)
    set_cols = []
    set_vals = []
    for z_f, db_col in mapping.items():
        # Do not overwrite itemID PK when patching legacy row matched by fallback.
        if z_f == "itemID":
            continue
        set_cols.append(f"{quote_ident(db_col)} = ?")
        set_vals.append(data_map.get(z_f, ""))
    if not set_cols:
        return
    set_vals.append(rowid)
    query = f"UPDATE {table_q} SET {', '.join(set_cols)} WHERE rowid = ?"
    conn.execute(query, tuple(set_vals))


def insert_new_row(conn, table_name, mapping, data_map):
    table_q = quote_ident(table_name)
    cols = []
    vals = []
    placeholders = []
    for z_f, db_col in mapping.items():
        cols.append(quote_ident(db_col))
        vals.append(data_map.get(z_f, ""))
        placeholders.append("?")
    query = f"INSERT OR REPLACE INTO {table_q} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
    conn.execute(query, tuple(vals))

def load_config():
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found at {CONFIG_PATH}")
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)

def get_zotero_conn(zotero_path):
    zotero_path = os.path.expanduser(zotero_path)
    if not os.path.exists(zotero_path):
        raise FileNotFoundError(f"Zotero DB not found at {zotero_path}")
    shutil.copy2(zotero_path, TEMP_ZOTERO_PATH)
    return sqlite3.connect(TEMP_ZOTERO_PATH)

def get_target_conn(target_db_path):
    # Solve relative to BASE_DIR if needed
    if not target_db_path.startswith("/"):
        full_path = BASE_DIR / target_db_path
    else:
        full_path = Path(target_db_path)
    
    full_path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(full_path)

def ensure_table(conn, table_name, mapping):
    """Creates the target table based on the mapping keys (columns)."""
    columns = []
    for z_field, db_col in mapping.items():
        # Everything as TEXT for simplicity in this flex-engine
        # primary key will be Zotero itemID or key
        if z_field == "itemID":
            columns.append(f"{db_col} INTEGER PRIMARY KEY")
        else:
            columns.append(f"{db_col} TEXT")
    
    query = f"CREATE TABLE IF NOT EXISTS {table_name} ({', '.join(columns)})"
    conn.execute(query)
    conn.commit()

def sync():
    print("🚀 Starting Configurable Zotero -> DB Sync...")
    config = load_config()
    mapping = config["mapping"]
    table_name = config["target_table"]

    z_conn = get_zotero_conn(config["zotero_db"])
    t_conn = get_target_conn(config["target_db"])

    try:
        ensure_table(t_conn, table_name, mapping)
        
        z_cursor = z_conn.cursor()
        
        # 1. Fetch base items
        z_cursor.execute("""
            SELECT items.itemID, items.key, itemTypes.typeName, items.dateAdded, items.dateModified
            FROM items
            JOIN itemTypes ON items.itemTypeID = itemTypes.itemTypeID
            WHERE itemTypes.typeName NOT IN ('attachment', 'note')
        """)
        items = z_cursor.fetchall()

        created_count = 0
        updated_count = 0
        uri_corrected_count = 0
        matched_by = {"key": 0, "doi": 0, "fingerprint": 0}
        for item_id, item_key, type_name, date_added, date_modified in items:
            # Fetch fields
            z_cursor.execute("""
                SELECT f.fieldName, dv.value
                FROM itemData id
                JOIN fields f ON id.fieldID = f.fieldID
                JOIN itemDataValues dv ON id.valueID = dv.valueID
                WHERE id.itemID = ?
            """, (item_id,))
            fields = dict(z_cursor.fetchall())

            # Fetch creators
            z_cursor.execute("""
                SELECT c.firstName, c.lastName
                FROM itemCreators ic
                JOIN creators c ON ic.creatorID = c.creatorID
                WHERE ic.itemID = ?
                ORDER BY ic.orderIndex
            """, (item_id,))
            creators = ", ".join([f"{c[0]} {c[1]}".strip() for c in z_cursor.fetchall()])

            # Fetch tags
            z_cursor.execute("""
                SELECT t.name FROM itemTags it JOIN tags t ON it.tagID = t.tagID WHERE it.itemID = ?
            """, (item_id,))
            tags = ", ".join([t[0] for t in z_cursor.fetchall()])

            # Map Zotero data to DB values
            data_map = {
                "itemID": item_id,
                "key": item_key,
                "typeName": type_name,
                "dateAdded": date_added,
                "dateModified": date_modified,
                "creators": creators,
                "tags": tags,
                "title": fields.get("title", ""),
                "doi": fields.get("DOI", "") or fields.get("doi", ""),
                "date": fields.get("date", ""),
                "url": fields.get("url", ""),
                "abstractNote": fields.get("abstractNote", "")
            }

            existing_row, match_type = find_existing_row(t_conn, table_name, mapping, data_map)
            if existing_row is None:
                insert_new_row(t_conn, table_name, mapping, data_map)
                created_count += 1
                continue

            matched_by[match_type] += 1
            # row format: rowid + table columns
            row_columns = ["rowid"] + [r[1] for r in t_conn.execute(f"PRAGMA table_info({quote_ident(table_name)})").fetchall()]
            row_dict = dict(zip(row_columns, existing_row))

            key_col = mapping.get("key")
            existing_key = row_dict.get(key_col) if key_col else None
            if key_col and item_key and existing_key != item_key:
                uri_corrected_count += 1

            update_row_by_rowid(t_conn, table_name, mapping, data_map, row_dict["rowid"])
            updated_count += 1

        t_conn.commit()
        total_processed = len(items)
        print("✅ Sync successful")
        print(f"   Processed: {total_processed}")
        print(f"   Created: {created_count}")
        print(f"   Updated: {updated_count}")
        print(f"   URI corrected: {uri_corrected_count}")
        print(
            "   Matched by: "
            f"key={matched_by['key']}, doi={matched_by['doi']}, fingerprint={matched_by['fingerprint']}"
        )
        print(f"   Target: {config['target_db']} [{table_name}]")

    finally:
        z_conn.close()
        t_conn.close()
        if os.path.exists(TEMP_ZOTERO_PATH):
            os.remove(TEMP_ZOTERO_PATH)

if __name__ == "__main__":
    sync()
