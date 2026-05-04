from pathlib import Path
import os
from typing import Dict, Optional

# --- Early Boot Paths (Safe Fallbacks) ---
# This allows logger_config to import LOG_DIR safely before get_paths() is called.
_tmp_base = Path("/tmp/gnosi_pending_vault")
LOG_DIR = _tmp_base / "data" / "logs"

def get_paths(overrides: Optional[Dict[str, str]] = None) -> Dict[str, Optional[Path]]:
    """
    Returns a dictionary of absolute paths for the whole project.
    
    NO DEFAULT VAULT FOLDER: If no path is provided in overrides (Settings), 
    the vault_path will be None and the system should handle it gracefully.
    """
    if overrides is None:
        overrides = {}

    from .env_config import load_env
    load_env()

    _this_file = Path(__file__).resolve()
    project_root = _this_file.parents[2]  # backend/config -> gnosi

    # ── Resolve Vault Path ──
    # Prioritat: Variable d'entorn (Docker) > params.yaml (Settings UI)
    env_vault = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    if env_vault:
        vault_path = Path(env_vault)
    else:
        vault_raw = overrides.get("vault")
        vault_path = Path(vault_raw) if vault_raw else None
    
    if vault_path and not vault_path.is_absolute():
        vault_path = project_root / vault_path

    # ── Derived paths (Standardized) ──
    # USE SAFE FALLBACKS: If vault_path is None, we use a temporary dummy path 
    # to avoid "None / 'str'" crashes during startup.
    safe_base = vault_path if vault_path else Path("/tmp/gnosi_pending_vault")
    
    db_path = safe_base / "BD"
    newsletters_path = safe_base / "Newsletters"
    assets_path = safe_base / "Assets"
    calendar_path = safe_base / "Calendar"
    mail_path = safe_base / "Mail"
    plantilles_path = safe_base / "Plantilles"
    dibuixos_path = safe_base / "Dibuixos"
    wiki_path = safe_base / "Wiki"
    dashworks_path = safe_base / ".Dashworks"
    data_path = safe_base / "data"

    # Files and specific sub-dirs
    out_json = db_path / "vault_pages.json"
    out_graph = db_path / "vault_graph.json"
    registry = db_path / "vault_db_registry.json"

    # ── Ensure foundational directories exist (Safe mode) ──
    if vault_path:
        for p in [vault_path, db_path, assets_path, newsletters_path, calendar_path, mail_path, plantilles_path, dibuixos_path, wiki_path, dashworks_path, data_path]:
            if p:
                try:
                    if not p.exists():
                        p.mkdir(parents=True, exist_ok=True)
                except Exception:
                    pass

    return {
        "PROJECT_DIR": project_root,
        "VAULT": vault_path, # Keep original as None if not set
        "DATABASES": db_path,
        "NEWSLETTERS": newsletters_path,
        "ASSETS": assets_path,
        "CALENDAR": calendar_path,
        "MAIL": mail_path,
        "PLANTILLES": plantilles_path,
        "DIBUIXOS": dibuixos_path,
        "WIKI": wiki_path,
        "DASHWORKS": dashworks_path,
        "DATA": data_path,
        "OUT_JSON": out_json,
        "OUT_GRAPH": out_graph,
        "REGISTRY": registry,
        "LOGS": data_path / "logs",
        "CHROMA": data_path / "chroma_db",
        "AUDIO": data_path / "audio",
        "SCHEDULER": data_path / "scheduler_config.json",
        "CACHE": data_path / "content_cache.json",
        "TOOLS": safe_base / "Tools",
        "CHECKPOINTS": data_path / "checkpoints",
        "BACKUPS": data_path / "backups",
        "SECRETS": project_root / "pipeline" / "private_skills" / "secrets",
    }
