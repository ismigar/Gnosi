# config/paths_config.py
from pathlib import Path
import sys
import os
from typing import Dict, Optional

# ──────────────────────────────────────────────
# 1️⃣ Garanteix que el directori arrel (src/) estigui al PYTHONPATH
# ──────────────────────────────────────────────
_this_file = Path(__file__).resolve()
project_root = _this_file.parents[2]  # backend/config -> gnosi
src_dir = project_root / "backend"  # Ara el codi és a backend/

if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

# ──────────────────────────────────────────────
# 2️⃣ API pública: obtenir totes l'rutes
# ──────────────────────────────────────────────


def get_paths(overrides: Optional[Dict[str, str]] = None) -> Dict[str, Path]:
    """
    Returns a dictionary of absolute paths for the whole project.

    Paths are read from params.yaml (passed as overrides).
    Secrets/tokens come from .env_shared (handled by env_config).
    """
    if overrides is None:
        overrides = {}

    from .env_config import load_env

    load_env()

    _this_file = Path(__file__).resolve()
    project_root = _this_file.parents[2]  # backend/config -> gnosi

    # ── Resolve Vault Path ──
    # Source: params.yaml paths.vault (Settings UI)
    vault_raw = overrides.get("vault")

    if not vault_raw:
        # Fallback to local vault if not configured
        vault_path = project_root / "vault"
    else:
        vault_path = Path(vault_raw)
        if not vault_path.is_absolute():
            vault_path = project_root / vault_path

    # ── Derived paths (Standardized) ──
    # All system folders are now relative to the Vault root
    db_path = vault_path / "BD"
    newsletters_path = vault_path / "Newsletters"
    assets_path = vault_path / "Assets"
    calendar_path = vault_path / "Calendar"
    mail_path = vault_path / "Mail"
    plantilles_path = vault_path / "Plantilles"
    dibuixos_path = vault_path / "Dibuixos"
    wiki_path = vault_path / "Wiki"
    data_path = vault_path / "data"

    # Files and specific sub-dirs
    out_json = db_path / "vault_pages.json"
    out_graph = db_path / "vault_graph.json"
    registry = db_path / "vault_db_registry.json"

    # ── Ensure foundational directories exist ──
    # We create the vault and BD folder to ensure the registry can be saved
    for p in [vault_path, db_path, assets_path, newsletters_path, calendar_path, mail_path, plantilles_path, dibuixos_path, wiki_path, data_path]:
        try:
            if not p.exists():
                p.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    return {
        "PROJECT_DIR": project_root,
        "VAULT": vault_path,
        "DATABASES": db_path,
        "NEWSLETTERS": newsletters_path,
        "ASSETS": assets_path,
        "CALENDAR": calendar_path,
        "MAIL": mail_path,
        "PLANTILLES": plantilles_path,
        "DIBUIXOS": dibuixos_path,
        "WIKI": wiki_path,
        "DATA": data_path,
        "OUT_JSON": out_json,
        "OUT_GRAPH": out_graph,
        "REGISTRY": registry,
        "LOGS": data_path / "logs",
        "CHROMA": data_path / "chroma_db",
        "AUDIO": data_path / "audio",
        "SCHEDULER": data_path / "scheduler_config.json",
        "CACHE": data_path / "content_cache.json",
        "TOOLS": vault_path / "Tools",
        "CHECKPOINTS": data_path / "checkpoints",
        "BACKUPS": data_path / "backups",
        "SECRETS": project_root / "pipeline" / "private_skills" / "secrets",
    }
