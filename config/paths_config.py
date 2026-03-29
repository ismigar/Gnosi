# config/paths_config.py
from pathlib import Path
import sys
import os
from typing import Dict, Optional

# ──────────────────────────────────────────────
# 1️⃣ Garanteix que el directori arrel (src/) estigui al PYTHONPATH
# ──────────────────────────────────────────────
_this_file = Path(__file__).resolve()
project_root = _this_file.parents[1]  # config -> gnosi
src_dir = project_root / "backend" # Ara el codi és a backend/

if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

# ──────────────────────────────────────────────
# 2️⃣ Globals per retro-compatibilitat (usats per imports directes)
# ──────────────────────────────────────────────
_root = Path(__file__).resolve().parents[1]
LOG_DIR = _root / "backend" / "data" / "logs"
CONFIG_DIR = _root / "config"
OUT_DIR = _root / "backend" / "data"
STOPWORDS_PATH = CONFIG_DIR / "stopwords.json"

# ──────────────────────────────────────────────
# 3️⃣ API pública: obtenir totes l'rutes
# ──────────────────────────────────────────────

def get_paths(overrides: Optional[Dict[str, str]] = None) -> Dict[str, Path]:
    """
    Returns a dictionary of absolute paths for the whole project.
    Prioritizes: 1. overrides, 2. DIGITAL_BRAIN_VAULT_PATH, 3. gnosi_VAULT_PATH.
    """
    if overrides is None:
        overrides = {}

    from .env_config import load_env
    load_env()

    _this_file = Path(__file__).resolve()
    project_root = _this_file.parents[1] # config -> gnosi

    # 1. Detect Vault Path
    vault_env_primary = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    vault_env_secondary = os.environ.get("gnosi_VAULT_PATH")
    
    # Keep Docker/runtime env authoritative when present.
    vault_raw = vault_env_primary or vault_env_secondary or overrides.get("vault")
    
    if not vault_raw:
        # We don't raise error here to allow app to start even if vault is not yet set
        # but we return None for VAULT to let services handle it.
        # However, for deterministic tools, we might want to know it's missing.
        vault_path = None
    else:
        vault_path = Path(vault_raw)
        if not vault_path.is_absolute():
            vault_path = project_root / vault_path

    # DB Path
    db_env = os.environ.get("DIGITAL_BRAIN_DB_PATH") or "backend/data"
    db_path = Path(overrides.get("databases") or db_env)
    
    if not db_path.is_absolute():
        db_path = project_root / db_path

    # Files
    out_json = db_path / "vault_pages.json"
    out_graph = db_path / "vault_graph.json"
    registry = vault_path / "vault_db_registry.json" if vault_path else None

    # Ensure directories exist (only if configured and missing)
    # Evitem comprovar .exists() a /vault directament perquè pot bloquejar-se en macOS/OneDrive
    if vault_path and str(vault_path) != "/vault":
        try:
            if not vault_path.exists():
                vault_path.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
    
    if not db_path.exists():
        db_path.mkdir(parents=True, exist_ok=True)

    return {
        "PROJECT_DIR": project_root,
        "VAULT": vault_path,
        "DATABASES": db_path,
        "OUT_JSON": out_json,
        "OUT_GRAPH": out_graph,
        "REGISTRY": registry,
        "LOGS": db_path / "logs",
        "LOG_DIR": db_path / "logs",
        "CHROMA": db_path / "chroma_db",
        "AUDIO": db_path / "audio",
        "SCHEDULER": db_path / "scheduler_config.json",
        "CACHE": db_path / "content_cache.json",
        "TOOLS": project_root / "data",
        "CHECKPOINTS": project_root / "data",
        "BACKUPS": project_root / "data" / "backups",
        "SECRETS": project_root / "pipeline" / "private_skills" / "secrets",
        "CONFIG_DIR": project_root / "config",
        "OUT_DIR": db_path,
        "STOPWORDS_PATH": project_root / "config" / "stopwords.json"
    }
