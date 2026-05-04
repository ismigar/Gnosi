from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
import json
import os
import subprocess
from typing import Dict, Any, List

from backend.config.app_config import load_params

router = APIRouter(prefix="/api/zotero", tags=["zotero"])

# Paths
cfg = load_params(strict_env=False)
BASE_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = BASE_DIR / "pipeline/skills/zotero_sync/zotero_db_config.json"
REGISTRY_PATH = cfg.paths["REGISTRY"]
SYNC_SCRIPT_PATH = BASE_DIR / "pipeline/skills/zotero_sync/scripts/zotero_to_db.py"

# Available Zotero fields supported by the engine
ZOTERO_FIELDS = [
    {"id": "itemID", "label": "Item ID (Internal)"},
    {"id": "key", "label": "Zotero Key"},
    {"id": "title", "label": "Title"},
    {"id": "typeName", "label": "Item Type"},
    {"id": "creators", "label": "Creators / Authors"},
    {"id": "tags", "label": "Tags"},
    {"id": "date", "label": "Publication Date"},
    {"id": "url", "label": "URL"},
    {"id": "abstractNote", "label": "Abstract / Summary"},
    {"id": "dateAdded", "label": "Date Added"},
    {"id": "dateModified", "label": "Date Modified"},
]

def load_json(path: Path, default: Any = None) -> Any:
    if path is None or not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default

@router.get("/config")
async def get_config():
    """Returns current Zotero sync configuration."""
    config = load_json(CONFIG_PATH, {
        "zotero_db": "~/Zotero/zotero.sqlite",
        "target_db": "",
        "target_table": "",
        "mapping": {}
    })
    return config

@router.post("/config")
async def save_config(config: Dict[str, Any]):
    """Saves Zotero sync configuration."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    return {"status": "success", "message": "Configuration saved"}

@router.get("/tables")
async def get_tables():
    """Returns available tables from the vault registry."""
    registry = load_json(REGISTRY_PATH, {"tables": []})
    return registry.get("tables", [])

@router.get("/fields")
async def get_fields():
    """Returns available Zotero fields for mapping."""
    return ZOTERO_FIELDS

@router.post("/sync")
async def trigger_sync(background_tasks: BackgroundTasks):
    """Triggers the Zotero sync engine in the background."""
    def run_sync():
        try:
            # Run the python script
            result = subprocess.run(
                ["python3", str(SYNC_SCRIPT_PATH)],
                capture_output=True,
                text=True,
                cwd=str(BASE_DIR)
            )
            if result.returncode == 0:
                print(f"Zotero sync completed: {result.stdout}")
            else:
                print(f"Zotero sync failed: {result.stderr}")
        except Exception as e:
            print(f"Error running Zotero sync: {e}")

    background_tasks.add_task(run_sync)
    return {"status": "started", "message": "Sync started in the background"}
