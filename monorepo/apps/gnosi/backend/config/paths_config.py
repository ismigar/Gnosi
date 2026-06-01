from pathlib import Path
import os
from typing import Dict, Optional

# --- Early Boot Paths (Safe Fallbacks) ---
# This allows logger_config to import LOG_DIR safely before get_paths() is called.
_tmp_base = Path("/tmp/gnosi_pending_vault")
LOG_DIR = _tmp_base / "logs"

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
    # Prioritat: env (Docker: DIGITAL_BRAIN_VAULT_PATH=/vault; host: VAULT_HOST_PATH)
    # > params.yaml (Settings UI).
    env_vault = os.environ.get("DIGITAL_BRAIN_VAULT_PATH") or os.environ.get("VAULT_HOST_PATH")
    if env_vault:
        vault_path = Path(env_vault)
    else:
        vault_raw = overrides.get("vault")
        vault_path = Path(vault_raw) if vault_raw else None
        # Robustesa entre Macs (fora de Docker): `params.yaml` viu DINS el vault i
        # se sincronitza per OneDrive, així que `vault:` pot ser la ruta absoluta de
        # l'ALTRE Mac (/Users/<altre_usuari>/...) i no existir aquí. Si és el cas,
        # re-arrelem el tram després de l'usuari a $HOME actual (sense hardcodejar
        # usuari ni núvol). En Docker no s'activa mai: DIGITAL_BRAIN_VAULT_PATH mana.
        if vault_path and vault_path.is_absolute() and not vault_path.exists():
            parts = vault_path.parts
            if len(parts) >= 4 and parts[1] in ("Users", "home"):
                rerooted = Path.home().joinpath(*parts[3:])
                if rerooted.exists():
                    vault_path = rerooted
    
    if vault_path and not vault_path.is_absolute():
        vault_path = project_root / vault_path

    # ── Derived paths (Standardized) ──
    # USE SAFE FALLBACKS: If vault_path is None, we use a temporary dummy path
    # to avoid "None / 'str'" crashes during startup.
    safe_base = vault_path if vault_path else Path("/tmp/gnosi_pending_vault")

    # ── Local-only data (NEVER on cloud-synced storage) ──
    # SQLite databases, caches, indices, locks. These are per-instance and must
    # not be uploaded to OneDrive/Dropbox/iCloud — cloud sync corrupts SQLite
    # binary files and causes I/O bottlenecks. Override via env var if needed.
    local_data_env = os.environ.get("GNOSI_LOCAL_DATA")
    if local_data_env:
        local_data = Path(local_data_env)
    else:
        # Default: /app/data inside the container (mounted as a Docker volume)
        local_data = Path("/app/data")
    try:
        local_data.mkdir(parents=True, exist_ok=True)
        (local_data / "cache").mkdir(parents=True, exist_ok=True)
        (local_data / "system").mkdir(parents=True, exist_ok=True)
        # Per-agent LangGraph checkpoints land here.
        (local_data / "system" / "checkpoints").mkdir(parents=True, exist_ok=True)
        # Logs operatius (notifications, etc.) — creats al boot perquè els
        # mòduls que escriuen aquí (notification_service, etc.) no hagin
        # de fer mkdir defensiu cada vegada.
        (local_data / "logs").mkdir(parents=True, exist_ok=True)
        (local_data / "audio").mkdir(parents=True, exist_ok=True)
        (local_data / "out").mkdir(parents=True, exist_ok=True)
        (local_data / "backups").mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    db_path = safe_base / "BD"
    # Newsletters: clau mantinguda pel frontend (settings tab) per a
    # subscripcions futures, però NO es crea automàticament al disc per
    # evitar carpetes buides al vault. El path només existeix si algun
    # mòdul l'utilitza activament i fa el seu propi mkdir.
    newsletters_path = safe_base / "Newsletters"
    assets_path = safe_base / "Assets"
    calendar_path = safe_base / "Calendar"
    mail_path = safe_base / "Mail"
    # Noms canònics anglesos. Els llegacy "Plantilles"/"Dibuixos" del primer
    # disseny s'eliminen — el codi actual escriu a Templates/Drawings.
    plantilles_path = safe_base / "Templates"
    dibuixos_path = safe_base / "Drawings"
    wiki_path = safe_base / "Wiki"
    dashboard_path = safe_base / ".Dashboards"

    # Files and specific sub-dirs
    out_json = db_path / "vault_pages.json"
    out_graph = db_path / "vault_graph.json"
    registry = db_path / "vault_db_registry.json"

    # ── Persistent App Data (Vault-first) ──
    # `.gnosi/` és l'única carpeta de configuració vault-first: hi viuen
    # identitat, scheduler, custom icons i agent instructions/tools. Tot el
    # que pertany a una instància concreta (caches, SQLite, vector stores,
    # checkpoints, audio, logs, backups) viu a `local_data/` (per dispositiu,
    # no sincronitzat).
    persistent_base = safe_base / ".gnosi"
    agent_instructions = persistent_base / "agent" / "instructions"
    agent_tools = persistent_base / "agent" / "generated_tools"

    # ── Ensure foundational directories exist (Safe mode) ──
    if vault_path:
        for p in [vault_path, db_path, assets_path, calendar_path, mail_path, plantilles_path, dibuixos_path, wiki_path, dashboard_path, persistent_base, agent_instructions, agent_tools]:
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
        "DASHBOARDS": dashboard_path,
        # `.gnosi/` base canònica per a config sincronitzat.
        "GNOSI_CONFIG": persistent_base,
        "OUT_JSON": out_json,
        "OUT_GRAPH": out_graph,
        "REGISTRY": registry,
        # Logs operatius — per-instància (van a local_data dins el container).
        "LOGS": local_data / "logs",
        "LOG_DIR": local_data / "logs",
        # Vector store i àudio: per-instància, mai al vault.
        "CHROMA": local_data / "chroma_db",
        "AUDIO": local_data / "audio",
        # Configs sincronitzats vault-first via .gnosi/.
        "SCHEDULER": persistent_base / "scheduler_config.json",
        "IDENTITY": persistent_base / "identity.json",
        "CUSTOM_ICONS": persistent_base / "vault_custom_icons.json",
        "CACHE": local_data / "cache" / "content_cache.json",
        "TOOLS": agent_tools,
        "AGENT_INSTRUCTIONS": agent_instructions,
        "AGENT_TOOLS": agent_tools,
        # LangGraph agent checkpoints — SQLite per agent. Like the rest of the
        # operational SQLite files, these MUST live on local-only storage,
        # not on OneDrive. Per-instance state, not user content.
        "CHECKPOINTS": local_data / "system" / "checkpoints",
        "BACKUPS": local_data / "backups",
        "OUT_DIR": local_data / "out",
        "STOPWORDS_PATH": project_root / "config" / "stopwords.json",
        "SECRETS": project_root / "pipeline" / "private_skills" / "secrets",
        "MGMT_DB": local_data / "system" / "management.sqlite",
        # SQLite of the generated-tools registry. Living on OneDrive (under
        # AGENT_TOOLS) caused the same corruption pattern as management.sqlite
        # — it must be a local-only file.
        "TOOL_REGISTRY_DB": local_data / "system" / "tool_registry.sqlite",
        "LOCAL_DATA": local_data,
        "LOCAL_CACHE": local_data / "cache",
        "PAGE_INDEX_CACHE": local_data / "cache" / "vault_page_index.json",
        "INDEX_STATUS": local_data / "cache" / "indexer_status.json",
        "CONTACTS": safe_base / "Contacts",
    }
