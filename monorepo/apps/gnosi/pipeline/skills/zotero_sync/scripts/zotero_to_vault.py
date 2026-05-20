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
    """Loads the Zotero config.

    Tries the API first (so derived fields like `linked_attachments_base`
    arrive resolved by the backend) and falls back to the JSON file if the
    backend is unreachable.
    """
    try:
        r = requests.get(f"{VAULT_API}/api/zotero/config", timeout=5)
        if r.ok:
            return r.json()
    except requests.RequestException:
        pass
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


# ---------------------------------------------------------------------------
# Field value normalizers — apliquem aquí transformacions que serien fràgils
# si les feiem a la cell del Vault després de sincronitzar (selects, etc.).
# ---------------------------------------------------------------------------

# Codis ISO 639 / locales → opcions canòniques del select "Idioma" del Vault.
# Definim només els idiomes habituals; valors no llistats es passen tal qual
# i quedaran com a opció no llistada al select (visible però fora del catàleg).
_LANGUAGE_CODES = {
    # Català
    "ca": "CA", "cat": "CA", "catalan": "CA", "catalonian": "CA", "catalá": "CA",
    "catala": "CA", "català": "CA",
    # Castellà
    "es": "ES", "spa": "ES", "spanish": "ES", "espanol": "ES", "español": "ES",
    "castellano": "ES", "castella": "ES", "castellà": "ES",
    # Anglès (mantenim el codi del select existent: EN-GB)
    "en": "EN-GB", "eng": "EN-GB", "english": "EN-GB",
    "en-gb": "EN-GB", "en_gb": "EN-GB", "en-uk": "EN-GB",
    "en-us": "EN-GB", "en_us": "EN-GB",
}


def _normalize_language(value):
    """Returns a canonical language code (CA/ES/EN-GB) when the input matches a
    known ISO code, locale or human name. Unknown values are returned as-is so
    nothing is silently dropped — they show up at the select as unlisted options.
    """
    if value is None:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    key = raw.lower().replace("_", "-")
    if key in _LANGUAGE_CODES:
        return _LANGUAGE_CODES[key]
    # Locale "xx-YY" → prova amb el prefix.
    if "-" in key:
        prefix = key.split("-", 1)[0]
        if prefix in _LANGUAGE_CODES:
            return _LANGUAGE_CODES[prefix]
    return raw  # passthrough


def get_zotero_conn(path: str) -> sqlite3.Connection:
    expanded = os.path.expanduser(path)
    if not os.path.exists(expanded):
        raise FileNotFoundError(f"Zotero DB not found at {expanded}")
    shutil.copy2(expanded, TEMP_ZOTERO_PATH)
    return sqlite3.connect(TEMP_ZOTERO_PATH)


# ---------------------------------------------------------------------------
# Attachment resolution (Phase 6).
# Zotero stores three flavours we care about:
#   - `attachments:<rel>`  → path relatiu a la "Linked Attachment Base
#     Directory" (configurable a `linked_attachments_base`; default = la
#     carpeta `Biblioteca` del Vault). Aquest és el cas comú quan els PDFs
#     viuen fora de Zotero i Zotero només els lliga.
#   - `storage:<file>`     → fitxer dins `~/Zotero/storage/<att_key>/<file>`.
#   - `/absolute/path.pdf` → ruta absoluta legacy.
# Tornem una ruta absoluta usable directament per `_safe_open_target` del
# Vault. No tornem cap fitxer si el path no es pot resoldre o no existeix.
# ---------------------------------------------------------------------------


def resolve_attachment_path(att: dict, linked_base: str, zotero_storage: str):
    """Returns absolute filesystem path for `att`, or None if unresolvable.

    `att` is a row from `itemAttachments` enriched with the attachment's own
    item.key (`att_key`).
    """
    raw = (att or {}).get("path") or ""
    if not raw:
        return None
    if raw.startswith("attachments:"):
        rel = raw[len("attachments:"):]
        if not linked_base:
            return None
        return os.path.join(os.path.expanduser(linked_base), rel)
    if raw.startswith("storage:"):
        rel = raw[len("storage:"):]
        att_key = (att or {}).get("att_key") or ""
        if not att_key or not zotero_storage:
            return None
        return os.path.join(os.path.expanduser(zotero_storage), att_key, rel)
    if raw.startswith("/"):
        return raw
    return None


def extract_attachments_for(z_conn: sqlite3.Connection, parent_item_id: int) -> list:
    """Returns the attachments belonging to `parent_item_id`, sorted by
    insertion order. Each row is a dict with keys: att_key, linkMode, path,
    contentType.
    """
    cur = z_conn.cursor()
    cur.execute(
        """
        SELECT items.key as att_key, ia.linkMode, ia.path, ia.contentType
        FROM itemAttachments ia
        JOIN items ON items.itemID = ia.itemID
        WHERE ia.parentItemID = ?
        ORDER BY items.dateAdded ASC, items.itemID ASC
        """,
        (parent_item_id,),
    )
    return [
        {"att_key": row[0], "linkMode": row[1], "path": row[2], "contentType": row[3]}
        for row in cur.fetchall()
    ]


def pick_main_attachment(atts: list, linked_base: str, zotero_storage: str):
    """Selects the canonical attachment for a Zotero item.

    Preference order:
      1. First `application/pdf` whose path resolves and the file exists.
      2. First `application/pdf` whose path resolves (even if the file is missing —
         we still surface the path so the user can investigate).
      3. First any-content attachment with a resolvable path.
    Returns the absolute path string or None.
    """
    pdfs = [a for a in atts if (a.get("contentType") or "").lower() == "application/pdf"]
    others = [a for a in atts if a not in pdfs]

    def _try(seq, require_exists: bool):
        for a in seq:
            p = resolve_attachment_path(a, linked_base, zotero_storage)
            if not p:
                continue
            if require_exists and not os.path.exists(p):
                continue
            return p
        return None

    return _try(pdfs, True) or _try(pdfs, False) or _try(others, False)


def extract_items(z_conn: sqlite3.Connection, linked_base: str = "", zotero_storage: str = "") -> list:
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
        creator_rows = cur.fetchall()
        authors = ", ".join(f"{r[0]} {r[1]}".strip() for r in creator_rows)
        # Fase 4 — forma estructurada per a un camp de tipus `autoria`: Zotero
        # només té firstName/lastName, així que nom=firstName, cognom1=lastName
        # i cognom2 queda buit (no hi ha segon cognom a Zotero). Es preserva
        # `authors` (string) per a camps de tipus text/rich_text (enrere).
        creators_struct = [
            {"nom": (r[0] or "").strip(), "cognom1": (r[1] or "").strip(), "cognom2": ""}
            for r in creator_rows
            if (r[0] or r[1])
        ]

        cur.execute("""
            SELECT t.name FROM itemTags it JOIN tags t ON it.tagID = t.tagID WHERE it.itemID = ?
        """, (item_id,))
        tags = ", ".join(r[0] for r in cur.fetchall())

        atts = extract_attachments_for(z_conn, item_id)
        attachment_path = pick_main_attachment(atts, linked_base, zotero_storage) or ""

        # Phase 7 — exposem TOTS els camps Zotero (~123 possibles, segons l'item
        # type). El payload final només envia els que tenen mapping configurat,
        # així que l'únic cost d'exposar-los tots és afegir-los al dict en
        # memòria. Camps amb casing especial (DOI, ISBN, ISSN, PMID, PMCID) ja
        # vénen amb el seu casing original de la taula `fields`.
        item = {
            "key": item_key,
            "typeName": type_name,
            "dateAdded": date_added,
            "dateModified": date_modified,
            "creators": authors,
            "creators_struct": creators_struct,
            "tags": tags,
            "attachmentPath": attachment_path,
            **fields,
        }
        # Compatibilitat enrere amb mappings persistits que usaven `doi`
        # (lowercase) abans que el catàleg canònic adoptés `DOI` (Fase 7).
        if "DOI" in fields and "doi" not in item:
            item["doi"] = fields["DOI"]

        # Normalitza `language` a CA/ES/EN-GB perquè coincideixi amb el
        # select "Idioma" típic del Vault. Valors desconeguts es deixen
        # tal qual (passthrough); el sync no els descarta mai.
        if "language" in item:
            item["language"] = _normalize_language(item["language"])

        items.append(item)
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


def get_property_meta(table_id: str) -> dict:
    """Resolves `property_id → {name, type}` actual via the inspect endpoint.

    El mapping persisteix `property_id` (UUID immutable); el name és cosmètic
    i pot canviar quan l'usuari renombra columnes. El type ens cal per
    transformar valors abans d'escriure (p.ex. DOI text → URL clicable
    quan la propietat és tipus url).
    """
    res = requests.get(f"{VAULT_API}/api/zotero/inspect/{table_id}", timeout=30)
    res.raise_for_status()
    data = res.json()
    out = {}
    for p in data.get("properties", []):
        pid = p.get("id")
        if pid:
            out[pid] = {"name": p.get("name", ""), "type": (p.get("type") or "text")}
    return out


def _looks_like_url(value: str) -> bool:
    s = value.strip().lower()
    return s.startswith("http://") or s.startswith("https://") or s.startswith("doi.org/")


def transform_value_for_property(z_field: str, value, prop_type: str):
    """Adapts a raw Zotero value to fit the destination property type.

    Casos coberts:
      - `doi` → propietat tipus `url`: si el valor és un bare DOI ("10.x/y"),
        el prefixem amb `https://doi.org/` per què el Vault el reconegui com
        a URL clicable. Si ja és URL, es passa tal qual.

    Per defecte, retorna el valor original.
    """
    if value is None or value == "":
        return value
    if z_field == "doi" and prop_type == "url":
        s = str(value).strip()
        if _looks_like_url(s):
            return s if s.startswith("http") else f"https://{s}"
        return f"https://doi.org/{s}"
    return value


def build_page_payload(item: dict, mapping: dict, table_id: str, prop_meta: dict) -> dict:
    """Builds the `/api/vault/pages` payload using the property's CURRENT name.

    `mapping` is `{zotero_field_id: property_id}`. Resolving the id → name at
    runtime keeps the sync resilient to renames done elsewhere in the UI.
    `prop_meta` is `{property_id: {name, type}}`; el type s'usa per
    transformacions com DOI bare → URL clicable.
    """
    meta = {"database_table_id": table_id, "source": "Gnosi"}
    for z_field, prop_id in mapping.items():
        if not prop_id:
            continue
        info = prop_meta.get(prop_id)
        if not info or not info.get("name"):
            # Property removed or orphaned id; validate-config will surface this.
            continue
        prop_type = info.get("type", "text")
        # Fase 4: si el camp de creators és de tipus `autoria`, escriu la forma
        # estructurada (preserva firstName/lastName) en lloc de l'string, perquè
        # no es perdi l'estructura ni se sobreescrigui la migració.
        if z_field == "creators" and prop_type == "autoria":
            struct = item.get("creators_struct") or []
            if struct:
                meta[info["name"]] = struct
            continue
        value = item.get(z_field, "")
        if value:
            meta[info["name"]] = transform_value_for_property(z_field, value, prop_type)
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
    linked_base = config.get("linked_attachments_base", "") or ""
    # Storage dir: sibling of the live zotero.sqlite. Works for the standard
    # Zotero data directory layout.
    zotero_storage = str(Path(os.path.expanduser(zotero_db)).parent / "storage")

    if not table_id:
        return {"status": "no_target_table"}

    prop_meta = get_property_meta(table_id)

    z_conn = get_zotero_conn(zotero_db)
    try:
        items = extract_items(z_conn, linked_base=linked_base, zotero_storage=zotero_storage)
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

        payload = build_page_payload(item, mapping, table_id, prop_meta)

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
