from fastapi import APIRouter, HTTPException, Request
from config.app_config import load_params
from pathlib import Path
import yaml
import logging

router = APIRouter()
log = logging.getLogger(__name__)

PARAMS_PATH = Path(__file__).resolve().parents[2] / "config" / "params.yaml"

@router.get("/config")
async def get_config():
    try:
        # Reload params to get the latest version from disk
        cfg = load_params(strict_env=False)
        return cfg.params
    except Exception as e:
        log.error(f"Error reading config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/config")
async def update_config(request: Request):
    try:
        new_config = await request.json()
        if not new_config:
            raise HTTPException(status_code=400, detail="No data provided")

        with open(PARAMS_PATH, 'w', encoding='utf-8') as f:
            yaml.safe_dump(new_config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
            
        return {"status": "success", "message": "Configuration updated"}

    except Exception as e:
        log.error(f"Error updating config: {e}")
        raise HTTPException(status_code=500, detail=str(e))
