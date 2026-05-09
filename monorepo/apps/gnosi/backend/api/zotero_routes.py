from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Body
from pathlib import Path
import json
import logging
import os
import re
import subprocess
import unicodedata
import uuid
from typing import Dict, Any, List, Optional, Tuple

from backend.config.app_config import load_params
from backend.services.workspace_service import require_role
from backend.api.vault_routes import (
    load_registry,
    save_registry,
    _ensure_asset_dirs_for_table_entry,
    _ensure_table_vault_folder,
    _normalize_rel_folder,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/zotero", tags=["zotero"])

cfg = load_params(strict_env=False)
BASE_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = BASE_DIR / "pipeline/skills/zotero_sync/zotero_db_config.json"
REGISTRY_PATH = cfg.paths["REGISTRY"]
SYNC_SCRIPT_PATH = BASE_DIR / "pipeline/skills/zotero_sync/scripts/zotero_to_vault.py"
SYNC_BACK_SCRIPT_PATH = BASE_DIR / "pipeline/skills/zotero_sync/scripts/gnosi_to_zotero.py"

# ---------------------------------------------------------------------------
# Camps canònics Zotero (ids estables).
# El frontend els tradueix via i18n; el backend només els usa com a clau.
# ---------------------------------------------------------------------------
ZOTERO_FIELDS: List[Dict[str, str]] = [
    {"id": "key", "slug": "zotero_key"},
    {"id": "title", "slug": "title"},
    {"id": "typeName", "slug": "item_type"},
    {"id": "creators", "slug": "authors"},
    {"id": "tags", "slug": "tags"},
    {"id": "date", "slug": "date"},
    {"id": "url", "slug": "url"},
    {"id": "doi", "slug": "doi"},
    {"id": "abstractNote", "slug": "abstract"},
    {"id": "dateAdded", "slug": "date_added"},
    {"id": "dateModified", "slug": "date_modified"},
]

ZOTERO_FIELD_TYPES: Dict[str, str] = {
    "zotero_key": "text",
    "title": "title",
    "item_type": "select",
    "authors": "text",
    "date": "date",
    "url": "url",
    "doi": "text",
    "abstract": "rich_text",
    "tags": "multi_select",
    "date_added": "date",
    "date_modified": "date",
}

# ---------------------------------------------------------------------------
# Labels localitzats — `RECURSOS_LABELS[lang][slug]`.
# El name de la property al registry es crea amb aquests labels segons l'idioma
# actiu de l'usuari. L'usuari pot renombrar-les lliurement després; el sync
# resol property_id (immutable) → name actual al runtime.
# ---------------------------------------------------------------------------
RECURSOS_LABELS: Dict[str, Dict[str, str]] = {
    "en": {
        "title": "Title",
        "zotero_key": "Zotero Key",
        "item_type": "Type",
        "authors": "Authors",
        "date": "Date",
        "url": "URL",
        "doi": "DOI",
        "abstract": "Abstract",
        "tags": "Tags",
        "date_added": "Created",
        "date_modified": "Modified",
        "table_name": "Resources",
    },
    "ca": {
        "title": "Títol",
        "zotero_key": "Clau Zotero",
        "item_type": "Tipus",
        "authors": "Autors",
        "date": "Data",
        "url": "URL",
        "doi": "DOI",
        "abstract": "Resum",
        "tags": "Etiquetes",
        "date_added": "Creat",
        "date_modified": "Modificat",
        "table_name": "Recursos",
    },
    "es": {
        "title": "Título",
        "zotero_key": "Clave Zotero",
        "item_type": "Tipo",
        "authors": "Autores",
        "date": "Fecha",
        "url": "URL",
        "doi": "DOI",
        "abstract": "Resumen",
        "tags": "Etiquetas",
        "date_added": "Creado",
        "date_modified": "Modificado",
        "table_name": "Recursos",
    },
    "fr": {
        "title": "Titre",
        "zotero_key": "Clé Zotero",
        "item_type": "Type",
        "authors": "Auteurs",
        "date": "Date",
        "url": "URL",
        "doi": "DOI",
        "abstract": "Résumé",
        "tags": "Étiquettes",
        "date_added": "Créé",
        "date_modified": "Modifié",
        "table_name": "Ressources",
    },
}

DEFAULT_LANG = "en"

# Sinònims acceptats per autocorrelació de propietats existents.
# Tot normalitzat (lowercase, sense accents/símbols) abans de comparar.
MAPPING_SYNONYMS: Dict[str, List[str]] = {
    "title": ["title", "titol", "titulo", "titre", "nom", "name"],
    "zotero_key": ["zoterokey", "clauzotero", "clavezotero", "clezotero", "key", "zkey"],
    "item_type": ["itemtype", "tipusitem", "tipus", "tipo", "type", "kind"],
    "authors": ["authors", "autors", "autores", "auteurs", "author", "creators"],
    "date": ["date", "data", "fecha", "any", "year"],
    "url": ["url", "link", "enllac", "enlace"],
    "doi": ["doi"],
    "abstract": ["abstract", "abstractnote", "resum", "resumen", "resume", "summary"],
    "tags": ["tags", "etiquetes", "etiquetas", "etiquettes", "keywords"],
    "date_added": ["dateadded", "creat", "creado", "cree", "created", "createdtime", "createdat"],
    "date_modified": ["datemodified", "modificat", "modificado", "modifie", "modified", "lasteditedtime", "updatedat"],
}


def _norm(s: str) -> str:
    """Lowercase, strip diacritics, keep only alphanumerics. Used for fuzzy match of property names."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s.lower())


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def _is_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(_UUID_RE.match(value))


def _resolve_lang(value: Optional[str]) -> str:
    if not value:
        # Fallback to user's params.yaml language, then English.
        try:
            return cfg.settings.get("language", DEFAULT_LANG) or DEFAULT_LANG
        except Exception:
            return DEFAULT_LANG
    code = str(value).strip().lower()[:2]
    return code if code in RECURSOS_LABELS else DEFAULT_LANG


def build_recursos_schema(lang: str) -> List[Dict[str, str]]:
    """Builds the property list for the Recursos table localized to `lang`."""
    labels = RECURSOS_LABELS[_resolve_lang(lang)]
    return [
        {"name": labels[slug], "type": ZOTERO_FIELD_TYPES[slug]}
        for slug in [
            "title",
            "zotero_key",
            "item_type",
            "authors",
            "date",
            "url",
            "doi",
            "abstract",
            "tags",
            "date_added",
            "date_modified",
        ]
    ]


def _slug_to_property(props: List[Dict[str, Any]], lang: str) -> Dict[str, Optional[str]]:
    """Returns `{slug: property_id}` for a freshly created table.

    Relies on label match against the localized labels of `lang`.
    """
    labels = RECURSOS_LABELS[_resolve_lang(lang)]
    by_norm = {_norm(p.get("name", "")): p.get("id") for p in props if p.get("id")}
    out: Dict[str, Optional[str]] = {}
    for slug in ZOTERO_FIELD_TYPES.keys():
        out[slug] = by_norm.get(_norm(labels.get(slug, "")))
    return out


def default_mapping_for_table(props: List[Dict[str, Any]], lang: str) -> Dict[str, str]:
    """Builds `{zotero_field_id: property_id}` mapping for a freshly created table.

    Walks `ZOTERO_FIELDS` and pairs each to the matching localized property.
    """
    slug_pid = _slug_to_property(props, lang)
    mapping: Dict[str, str] = {}
    for f in ZOTERO_FIELDS:
        pid = slug_pid.get(f["slug"])
        if pid:
            mapping[f["id"]] = pid
    return mapping


# ---------------------------------------------------------------------------
# Suggest mapping (used when reusing an existing table the user already has).
# ---------------------------------------------------------------------------


def _suggest_property_for_slug(slug: str, props: List[Dict[str, Any]]) -> Optional[str]:
    """Finds the most likely property id for a Zotero canonical slug.

    Strategy:
      1. Exact normalized match against synonyms list.
      2. Substring containment fallback (e.g. "Modification date" → date_modified).
    """
    candidates = MAPPING_SYNONYMS.get(slug, [slug])
    norm_targets = [_norm(c) for c in candidates if _norm(c)]
    by_norm = [(p, _norm(p.get("name", ""))) for p in props if p.get("id")]

    for target in norm_targets:
        for prop, pname in by_norm:
            if pname == target:
                return prop["id"]

    for target in norm_targets:
        for prop, pname in by_norm:
            if pname and (target in pname or pname in target):
                return prop["id"]

    return None


def suggest_mapping_for_table(props: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Returns suggested mapping + diagnostics for a target table's properties."""
    mapping: Dict[str, Optional[str]] = {}
    unmapped: List[str] = []
    conflicts: List[Dict[str, str]] = []

    prop_by_id = {p["id"]: p for p in props if p.get("id")}

    for f in ZOTERO_FIELDS:
        slug = f["slug"]
        pid = _suggest_property_for_slug(slug, props)
        mapping[f["id"]] = pid

        if not pid:
            unmapped.append(f["id"])
            continue

        expected_type = ZOTERO_FIELD_TYPES.get(slug)
        actual_type = (prop_by_id[pid].get("type") or "").strip()
        if expected_type and actual_type and expected_type != actual_type:
            conflicts.append(
                {
                    "zotero_field": f["id"],
                    "property_id": pid,
                    "property_name": prop_by_id[pid].get("name", ""),
                    "expected_type": expected_type,
                    "actual_type": actual_type,
                }
            )

    return {"mapping": mapping, "unmapped": unmapped, "conflicts": conflicts}


# ---------------------------------------------------------------------------
# Legacy mapping migration (name → property_id).
# ---------------------------------------------------------------------------


def _migrate_legacy_mapping(config: Dict[str, Any], registry: Dict[str, Any]) -> Dict[str, Any]:
    """If `mapping` values are property names instead of UUIDs, resolve them
    against `target_table` and rewrite. Idempotent: returns config unchanged
    when all values are already UUIDs (or when no target table is set).
    """
    mapping = config.get("mapping") or {}
    if not mapping:
        return config

    if all(_is_uuid(v) for v in mapping.values() if v):
        return config

    table_id = config.get("target_table")
    if not table_id:
        return config

    table = next((t for t in registry.get("tables", []) if t.get("id") == table_id), None)
    if not table:
        return config

    by_norm = {_norm(p.get("name", "")): p.get("id") for p in table.get("properties", []) if p.get("id")}
    new_mapping: Dict[str, str] = {}
    migrated = 0
    for z_field, value in mapping.items():
        if _is_uuid(value):
            new_mapping[z_field] = value
            continue
        pid = by_norm.get(_norm(value or ""))
        if pid:
            new_mapping[z_field] = pid
            migrated += 1

    if migrated > 0:
        log.info(f"zotero: migrated {migrated} legacy mapping entries name→id")

    config["mapping"] = new_mapping
    return config


# ---------------------------------------------------------------------------
# Persistence helpers.
# ---------------------------------------------------------------------------


# Camps Zotero que NO han de propagar-se de tornada al sqlite (només Zotero
# els hauria de mutar). Si l'usuari els té al mapping, el sync G→Z els salta.
READ_ONLY_FIELDS: List[str] = ["dateAdded", "dateModified", "key"]

# Estratègies de match per pàgines pre-existents sense `zotero_key`.
# - match_by_title: indexa pàgines per títol normalitzat; un match → PUT que
#   omple el zotero_key que faltava (sense duplicar).
# - skip: ignora pàgines sense zotero_key (comportament heretat).
EXISTING_PAGE_STRATEGIES: List[str] = ["match_by_title", "skip"]
DEFAULT_EXISTING_PAGE_STRATEGY = "match_by_title"


DEFAULT_CONFIG: Dict[str, Any] = {
    "enabled": False,
    "zotero_db": "~/Zotero/zotero.sqlite",
    "target_table": "",
    "mapping": {},
    "existing_pages_strategy": DEFAULT_EXISTING_PAGE_STRATEGY,
    "last_sync_at": None,            # ISO timestamp de l'última sync (qualsevol direcció)
    "last_sync_z_to_g": None,        # ISO de l'última Z→G
    "last_sync_g_to_z": None,        # ISO de l'última G→Z
    "last_sync_summary": None,       # dict resum del darrer sync (per UI)
}


def load_json(path: Path, default: Any = None) -> Any:
    if path is None or not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write: zotero_db_config.json conté target_table_id i mapping;
    # un crash a meitat de json.dump deixaria la integració trencada.
    from backend.utils.safe_io import safe_write_json
    safe_write_json(path, data, indent=2, ensure_ascii=False)


def load_config_with_migration() -> Dict[str, Any]:
    """Loads the persisted config, applies legacy mapping migration if needed,
    and persists the migration result so subsequent reads are stable.
    """
    raw = load_json(CONFIG_PATH, {}) or {}
    merged = {**DEFAULT_CONFIG, **raw}
    before = json.dumps(merged.get("mapping") or {}, sort_keys=True)
    migrated = _migrate_legacy_mapping(merged, load_registry())
    after = json.dumps(migrated.get("mapping") or {}, sort_keys=True)
    if before != after:
        save_json(CONFIG_PATH, migrated)
    return migrated


# ---------------------------------------------------------------------------
# Endpoints.
# ---------------------------------------------------------------------------


@router.get("/config")
async def get_config():
    return load_config_with_migration()


@router.post("/config", dependencies=[Depends(require_role("editor"))])
async def save_config(config: Dict[str, Any] = Body(...)):
    existing = load_json(CONFIG_PATH, {}) or {}
    merged = {**DEFAULT_CONFIG, **existing, **config}

    # Sanejat: només acceptem estratègies conegudes per a `existing_pages_strategy`.
    strategy = merged.get("existing_pages_strategy")
    if strategy not in EXISTING_PAGE_STRATEGIES:
        merged["existing_pages_strategy"] = DEFAULT_EXISTING_PAGE_STRATEGY

    save_json(CONFIG_PATH, merged)
    return {"status": "success"}


@router.get("/last-sync")
async def get_last_sync():
    """Reports timestamps + summary of the most recent sync runs (Z→G and G→Z)."""
    cfg = load_config_with_migration()
    return {
        "last_sync_at": cfg.get("last_sync_at"),
        "last_sync_z_to_g": cfg.get("last_sync_z_to_g"),
        "last_sync_g_to_z": cfg.get("last_sync_g_to_z"),
        "last_sync_summary": cfg.get("last_sync_summary"),
    }


@router.get("/fields")
async def get_fields():
    """Canonical Zotero fields — the frontend localizes labels via i18n."""
    return ZOTERO_FIELDS


@router.get("/tables")
async def get_tables():
    registry = load_registry()
    return registry.get("tables", [])


@router.get("/inspect/{table_id}")
async def inspect_table(table_id: str):
    """Returns the target table's properties + page counts (with/without zotero_key)."""
    registry = load_registry()
    table = next((t for t in registry.get("tables", []) if t.get("id") == table_id), None)
    if not table:
        raise HTTPException(status_code=404, detail=f"Table {table_id} not found")

    properties = [
        {"id": p.get("id"), "name": p.get("name"), "type": p.get("type")}
        for p in (table.get("properties") or [])
        if p.get("id")
    ]

    # Comptatge de pàgines (best-effort — només per UI)
    total_pages = 0
    pages_with_key = 0
    try:
        import asyncio as _asyncio
        from backend.api.vault_routes import _get_pages_snapshot  # type: ignore

        pages = await _asyncio.to_thread(_get_pages_snapshot)
        filtered = [p for p in pages if getattr(p, "resolved_table_id", None) == table_id]
        total_pages = len(filtered)
        pages_with_key = sum(
            1 for p in filtered if (getattr(p, "metadata", {}) or {}).get("zotero_key")
        )
    except Exception as e:
        # No bloquejar la inspecció si el helper falla (cold OneDrive, etc.)
        log.debug(f"zotero inspect: page count unavailable ({e})")

    return {
        "table_id": table_id,
        "table_name": table.get("name"),
        "properties": properties,
        "total_pages": total_pages,
        "pages_with_zotero_key": pages_with_key,
        "pages_without_zotero_key": max(0, total_pages - pages_with_key),
    }


@router.post("/suggest-mapping", dependencies=[Depends(require_role("editor"))])
async def suggest_mapping(payload: Dict[str, Any] = Body(...)):
    """Heuristic auto-mapping for a target table (synonyms + normalized match)."""
    table_id = payload.get("table_id")
    if not table_id:
        raise HTTPException(status_code=400, detail="table_id is required")

    registry = load_registry()
    table = next((t for t in registry.get("tables", []) if t.get("id") == table_id), None)
    if not table:
        raise HTTPException(status_code=404, detail=f"Table {table_id} not found")

    return suggest_mapping_for_table(table.get("properties") or [])


@router.post("/setup", dependencies=[Depends(require_role("editor"))])
async def setup_recursos(payload: Optional[Dict[str, Any]] = Body(default=None)):
    """Creates the Resources table localized to the active language.

    If a table named matching the localized "Resources" already exists, it is
    reused; the mapping is auto-suggested against its current properties.
    """
    body = payload or {}
    lang = _resolve_lang(body.get("lang"))
    table_name = RECURSOS_LABELS[lang]["table_name"]

    registry = load_registry()
    tables = registry.get("tables", [])

    # Trobem una taula existent que tingui el nom localitzat o un dels noms
    # localitzats de qualsevol idioma (per no crear duplicats si l'usuari
    # canvia d'idioma entre setups).
    candidate_names = {RECURSOS_LABELS[l]["table_name"] for l in RECURSOS_LABELS}
    existing = next((t for t in tables if t.get("name") in candidate_names), None)

    suggested: Dict[str, Any]
    if existing:
        table_id = existing["id"]
        created = False
        suggested = suggest_mapping_for_table(existing.get("properties") or [])
    else:
        table_id = str(uuid.uuid4())
        schema = build_recursos_schema(lang)
        props = [{"id": str(uuid.uuid4()), **p} for p in schema]
        table_entry = {
            "id": table_id,
            "name": table_name,
            "folder": _normalize_rel_folder(table_name),
            "database_id": "gnosi_vault_db",
            "properties": props,
            "order": len(tables),
        }
        registry["tables"].append(table_entry)
        _ensure_asset_dirs_for_table_entry(table_entry, registry)
        _ensure_table_vault_folder(table_entry, registry)
        save_registry(registry)
        created = True

        mapping = default_mapping_for_table(props, lang)
        suggested = {"mapping": mapping, "unmapped": [], "conflicts": []}

    config = load_json(CONFIG_PATH, {}) or {}
    config = {**DEFAULT_CONFIG, **config, "target_table": table_id}
    # Persisteix el mapping suggerit només si encara no n'hi havia un personalitzat,
    # o si l'existent està buit.
    if not config.get("mapping"):
        # Filtrem entrades sense match per no desar Nones.
        config["mapping"] = {k: v for k, v in (suggested.get("mapping") or {}).items() if v}
    save_json(CONFIG_PATH, config)

    return {
        "table_id": table_id,
        "table_name": table_name,
        "created": created,
        "lang": lang,
        "mapping": suggested.get("mapping", {}),
        "unmapped": suggested.get("unmapped", []),
        "conflicts": suggested.get("conflicts", []),
    }


@router.post("/create-column", dependencies=[Depends(require_role("editor"))])
async def create_column(payload: Dict[str, Any] = Body(...)):
    """Adds a new property to the target table (typed for a Zotero canonical field).

    Body: { table_id, zotero_field_id, label?, type? }
    Returns the created property dict (id + name + type).
    """
    table_id = payload.get("table_id")
    z_field_id = payload.get("zotero_field_id")
    label = (payload.get("label") or "").strip()
    explicit_type = (payload.get("type") or "").strip()

    if not table_id or not z_field_id:
        raise HTTPException(status_code=400, detail="table_id and zotero_field_id are required")

    field = next((f for f in ZOTERO_FIELDS if f["id"] == z_field_id), None)
    if not field:
        raise HTTPException(status_code=400, detail=f"Unknown Zotero field: {z_field_id}")
    slug = field["slug"]

    registry = load_registry()
    table = next((t for t in registry.get("tables", []) if t.get("id") == table_id), None)
    if not table:
        raise HTTPException(status_code=404, detail=f"Table {table_id} not found")

    props = table.setdefault("properties", [])

    if not label:
        # Fall back to the localized label from the user's active language.
        lang = _resolve_lang(None)
        label = RECURSOS_LABELS[lang].get(slug, slug)

    # Validació: no permetre col·lisió de noms a la mateixa taula
    if any((p.get("name") or "").strip() == label for p in props):
        raise HTTPException(status_code=409, detail=f"Property '{label}' already exists in table")

    new_prop = {
        "id": str(uuid.uuid4()),
        "name": label,
        "type": explicit_type or ZOTERO_FIELD_TYPES.get(slug, "text"),
    }
    props.append(new_prop)
    save_registry(registry)
    return new_prop


@router.get("/validate-config")
async def validate_config():
    """Validates the persisted mapping against the live registry.

    Returns:
      - ok: bool
      - errors: list of fatal issues (missing table / property)
      - warnings: list of non-fatal issues (type mismatches, unmapped fields)
    """
    config = load_config_with_migration()
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []

    if not config.get("enabled"):
        return {"ok": True, "errors": [], "warnings": [{"code": "disabled", "msg": "Integration is disabled"}]}

    table_id = config.get("target_table")
    if not table_id:
        errors.append({"code": "no_target_table", "msg": "No target_table configured"})
        return {"ok": False, "errors": errors, "warnings": warnings}

    registry = load_registry()
    table = next((t for t in registry.get("tables", []) if t.get("id") == table_id), None)
    if not table:
        errors.append({"code": "table_missing", "msg": f"Target table {table_id} not found"})
        return {"ok": False, "errors": errors, "warnings": warnings}

    props_by_id = {p["id"]: p for p in (table.get("properties") or []) if p.get("id")}
    mapping = config.get("mapping") or {}

    field_to_slug = {f["id"]: f["slug"] for f in ZOTERO_FIELDS}
    mapped_fields = set(mapping.keys())

    for z_field, pid in mapping.items():
        if not pid:
            continue
        if pid not in props_by_id:
            errors.append(
                {
                    "code": "property_missing",
                    "zotero_field": z_field,
                    "property_id": pid,
                    "msg": f"Property {pid} mapped from {z_field} no longer exists in table",
                }
            )
            continue
        slug = field_to_slug.get(z_field)
        expected_type = ZOTERO_FIELD_TYPES.get(slug or "")
        actual_type = props_by_id[pid].get("type")
        if expected_type and actual_type and expected_type != actual_type:
            warnings.append(
                {
                    "code": "type_mismatch",
                    "zotero_field": z_field,
                    "property_id": pid,
                    "property_name": props_by_id[pid].get("name"),
                    "expected_type": expected_type,
                    "actual_type": actual_type,
                }
            )

    for f in ZOTERO_FIELDS:
        if f["id"] not in mapped_fields:
            warnings.append(
                {
                    "code": "unmapped",
                    "zotero_field": f["id"],
                    "msg": f"Zotero field '{f['id']}' is not mapped",
                }
            )

    return {"ok": len(errors) == 0, "errors": errors, "warnings": warnings}


@router.post("/sync", dependencies=[Depends(require_role("editor"))])
async def trigger_sync(background_tasks: BackgroundTasks):
    """Triggers Zotero → Vault sync in background."""
    config = load_config_with_migration()
    if not config.get("enabled"):
        raise HTTPException(status_code=400, detail="La integració Zotero no està activada.")
    if not config.get("target_table"):
        raise HTTPException(status_code=400, detail="No hi ha cap taula de destí configurada.")

    def run_sync():
        try:
            result = subprocess.run(
                ["python3", str(SYNC_SCRIPT_PATH)],
                capture_output=True,
                text=True,
                cwd=str(BASE_DIR),
                timeout=300,  # 5 min — biblioteca Zotero gran pot trigar
            )
            if result.returncode != 0:
                log.error(f"Zotero→Vault sync failed: {result.stderr}")
        except subprocess.TimeoutExpired:
            log.error("Zotero→Vault sync timeout (5 min)")
        except Exception as e:
            log.error(f"Zotero sync error: {e}")

    background_tasks.add_task(run_sync)
    return {"status": "started", "direction": "zotero→vault"}


@router.post("/sync-back", dependencies=[Depends(require_role("editor"))])
async def trigger_sync_back(background_tasks: BackgroundTasks):
    """Triggers Vault → Zotero sync in background. Checks Zotero is not running first."""
    config = load_config_with_migration()
    if not config.get("enabled"):
        raise HTTPException(status_code=400, detail="La integració Zotero no està activada.")

    try:
        check = subprocess.run(["pgrep", "-x", "Zotero"], capture_output=True, timeout=5)
    except subprocess.TimeoutExpired:
        # pgrep penjat — assumim que Zotero no està obert i continuem
        check = None
    if check is not None and check.returncode == 0:
        return {"status": "zotero_open", "message": "Tanca Zotero abans de sincronitzar els canvis de Gnosi cap a Zotero."}

    def run_sync_back():
        try:
            result = subprocess.run(
                ["python3", str(SYNC_BACK_SCRIPT_PATH)],
                capture_output=True,
                text=True,
                cwd=str(BASE_DIR),
                timeout=300,
            )
            if result.returncode != 0:
                log.error(f"Vault→Zotero sync failed: {result.stderr}")
        except subprocess.TimeoutExpired:
            log.error("Vault→Zotero sync timeout (5 min)")
        except Exception as e:
            log.error(f"Zotero sync-back error: {e}")

    background_tasks.add_task(run_sync_back)
    return {"status": "started", "direction": "vault→zotero"}
