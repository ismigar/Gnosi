from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
import json
import os
import subprocess
import uuid
from typing import Dict, Any, List

from backend.config.app_config import load_params
from backend.api.vault_routes import (
    load_registry,
    save_registry,
    _ensure_asset_dirs_for_table_entry,
    _ensure_table_vault_folder,
    _normalize_rel_folder,
)

router = APIRouter(prefix="/api/zotero", tags=["zotero"])

cfg = load_params(strict_env=False)
BASE_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = BASE_DIR / "pipeline/skills/zotero_sync/zotero_db_config.json"
REGISTRY_PATH = cfg.paths["REGISTRY"]
SYNC_SCRIPT_PATH = BASE_DIR / "pipeline/skills/zotero_sync/scripts/zotero_to_vault.py"
SYNC_BACK_SCRIPT_PATH = BASE_DIR / "pipeline/skills/zotero_sync/scripts/gnosi_to_zotero.py"

DEFAULT_MAPPING = {
    "key": "zotero_key",
    "title": "title",
    "typeName": "tipus_item",
    "creators": "authors",
    "tags": "tags",
    "date": "date",
    "url": "url",
    "doi": "doi",
    "abstractNote": "resum",
    "dateAdded": "creat_el",
    "dateModified": "modificat_el",
}

DEFAULT_CONFIG = {
    "enabled": False,
    "zotero_db": "~/Zotero/zotero.sqlite",
    "target_table": "",
    "mapping": DEFAULT_MAPPING,
}

ZOTERO_FIELDS = [
    {"id": "key", "label": "Zotero Key"},
    {"id": "title", "label": "Títol"},
    {"id": "typeName", "label": "Tipus d'ítem"},
    {"id": "creators", "label": "Autors"},
    {"id": "tags", "label": "Etiquetes"},
    {"id": "date", "label": "Data de publicació"},
    {"id": "url", "label": "URL"},
    {"id": "doi", "label": "DOI"},
    {"id": "abstractNote", "label": "Resum"},
    {"id": "dateAdded", "label": "Data d'addició"},
    {"id": "dateModified", "label": "Data de modificació"},
]

RECURSOS_SCHEMA = [
    {"name": "title", "type": "title"},
    {"name": "zotero_key", "type": "text"},
    {"name": "tipus_item", "type": "select"},
    {"name": "authors", "type": "text"},
    {"name": "date", "type": "date"},
    {"name": "url", "type": "url"},
    {"name": "doi", "type": "text"},
    {"name": "resum", "type": "rich_text"},
    {"name": "tags", "type": "multi_select"},
    {"name": "creat_el", "type": "date"},
    {"name": "modificat_el", "type": "date"},
]


def load_json(path: Path, default: Any = None) -> Any:
    if path is None or not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@router.get("/config")
async def get_config():
    config = load_json(CONFIG_PATH, {})
    return {**DEFAULT_CONFIG, **config}


@router.post("/config")
async def save_config(config: Dict[str, Any]):
    existing = load_json(CONFIG_PATH, {})
    merged = {**DEFAULT_CONFIG, **existing, **config}
    save_json(CONFIG_PATH, merged)
    return {"status": "success"}


@router.post("/setup")
async def setup_recursos():
    """Creates the 'Recursos' vault table if it doesn't exist and saves its id to config."""
    registry = load_registry()
    tables = registry.get("tables", [])

    existing = next((t for t in tables if t.get("name") == "Recursos"), None)
    if existing:
        table_id = existing["id"]
        created = False
    else:
        table_id = str(uuid.uuid4())
        props = [{"id": str(uuid.uuid4()), **p} for p in RECURSOS_SCHEMA]
        table_entry = {
            "id": table_id,
            "name": "Recursos",
            "folder": _normalize_rel_folder("Recursos"),
            "database_id": "gnosi_vault_db",
            "properties": props,
            "order": len(tables),
        }
        registry["tables"].append(table_entry)
        _ensure_asset_dirs_for_table_entry(table_entry, registry)
        _ensure_table_vault_folder(table_entry, registry)
        save_registry(registry)
        created = True

    # Save table_id and default mapping to config
    config = load_json(CONFIG_PATH, {})
    config = {**DEFAULT_CONFIG, **config, "target_table": table_id}
    if not config.get("mapping"):
        config["mapping"] = DEFAULT_MAPPING
    save_json(CONFIG_PATH, config)

    return {"table_id": table_id, "created": created}


@router.get("/tables")
async def get_tables():
    registry = load_registry()
    return registry.get("tables", [])


@router.get("/fields")
async def get_fields():
    return ZOTERO_FIELDS


@router.post("/sync")
async def trigger_sync(background_tasks: BackgroundTasks):
    """Triggers Zotero → Vault sync in background."""
    config = load_json(CONFIG_PATH, DEFAULT_CONFIG)
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
            )
            if result.returncode != 0:
                print(f"Zotero→Vault sync failed: {result.stderr}")
        except Exception as e:
            print(f"Zotero sync error: {e}")

    background_tasks.add_task(run_sync)
    return {"status": "started", "direction": "zotero→vault"}


@router.post("/sync-back")
async def trigger_sync_back(background_tasks: BackgroundTasks):
    """Triggers Vault → Zotero sync in background. Checks Zotero is not running first."""
    config = load_json(CONFIG_PATH, DEFAULT_CONFIG)
    if not config.get("enabled"):
        raise HTTPException(status_code=400, detail="La integració Zotero no està activada.")

    check = subprocess.run(["pgrep", "-x", "Zotero"], capture_output=True)
    if check.returncode == 0:
        return {"status": "zotero_open", "message": "Tanca Zotero abans de sincronitzar els canvis de Gnosi cap a Zotero."}

    def run_sync_back():
        try:
            result = subprocess.run(
                ["python3", str(SYNC_BACK_SCRIPT_PATH)],
                capture_output=True,
                text=True,
                cwd=str(BASE_DIR),
            )
            if result.returncode != 0:
                print(f"Vault→Zotero sync failed: {result.stderr}")
        except Exception as e:
            print(f"Zotero sync-back error: {e}")

    background_tasks.add_task(run_sync_back)
    return {"status": "started", "direction": "vault→zotero"}
