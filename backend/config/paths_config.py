from pathlib import Path
import os
from typing import Dict, Optional

from .data_dir import resolve_data_dir

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
    # Priority: environment (Docker: DIGITAL_BRAIN_VAULT_PATH=/vault; host: VAULT_HOST_PATH)
    # > params.yaml (Settings UI).
    env_vault_docker = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    env_vault_host = os.environ.get("VAULT_HOST_PATH")
    env_vault = env_vault_docker or env_vault_host
    vault_path: Path | None
    if env_vault and (env_vault_docker or Path(env_vault).exists()):
        vault_path = Path(env_vault)
    else:
        vault_raw = overrides.get("vault")
        vault_path = Path(vault_raw) if vault_raw else None
        # Robustness across Macs (outside Docker): `params.yaml` lives INSIDE the vault and
        # is synced via OneDrive, so `vault:` can be the absolute path of
        # the OTHER Mac (/Users/<other_user>/...) and not exist here. If that's the case,
        # we re-root the segment after the user to the current $HOME (without hardcoding
        # user or cloud). In Docker this never activates: DIGITAL_BRAIN_VAULT_PATH governs.
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
    local_data = resolve_data_dir(create=True)
    try:
        local_data.mkdir(parents=True, exist_ok=True)
        (local_data / "cache").mkdir(parents=True, exist_ok=True)
        (local_data / "system").mkdir(parents=True, exist_ok=True)
        # Per-agent LangGraph checkpoints land here.
        (local_data / "system" / "checkpoints").mkdir(parents=True, exist_ok=True)
        # Operational logs (notifications, etc.) — created at boot so that the
        # modules that write here (notification_service, etc.) don't have to
        # of doing a defensive mkdir every time.
        (local_data / "logs").mkdir(parents=True, exist_ok=True)
        (local_data / "audio").mkdir(parents=True, exist_ok=True)
        (local_data / "out").mkdir(parents=True, exist_ok=True)
        (local_data / "backups").mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    # ── Secrets (integration credentials: Google Calendar/Mail, etc.) ──
    # PREVIOUSLY lived at project_root/pipeline/private_skills/secrets, a BIND MOUNT
    # inside the git tree. A `git clean -fdx` (or a cleanup/reinstall)
    # deleted integrations.json and ALL Google integrations stopped
    # loading (empty calendars/mail, without even an auth error).
    # They now live in the volume named `gnosi_local_data` (/app/data), like
    # management.sqlite: outside git, outside OneDrive (no dataless/EDEADLK),
    # persistent across rebuilds. It's local per machine — it reconnects once per
    # Mac via OAuth and is no longer lost. See directive environment_integrity.md.
    secrets_dir = local_data / "secrets"
    try:
        secrets_dir.mkdir(parents=True, exist_ok=True)
        # Idempotent migration (one-time only): if the file still exists at the
        # old location —e.g. the other Mac after a `git pull`— we copy it
        # to the new volume. We don't delete the old one (it's harmless as a fallback).
        _old_secrets = (
            project_root / "pipeline" / "private_skills" / "secrets" / "integrations.json"
        )
        _new_secrets = secrets_dir / "integrations.json"
        if _old_secrets.exists() and not _new_secrets.exists():
            import shutil

            shutil.copy2(_old_secrets, _new_secrets)
    except Exception:
        pass

    db_path = safe_base / "BD"
    # Newsletters: key maintained by the frontend (settings tab) for
    # future subscriptions, but it is NOT automatically created on disk to
    # avoid empty folders in the vault. The path only exists if some
    # module actively uses it and does its own mkdir.
    newsletters_path = safe_base / "Newsletters"
    assets_path = safe_base / "Assets"
    calendar_path = safe_base / "Calendar"
    mail_path = safe_base / "Mail"
    # Canonical English names. The legacy "Plantilles"/"Dibuixos" from the first
    # design get deleted — the current code writes to Templates/Drawings.
    plantilles_path = safe_base / "Templates"
    dibuixos_path = safe_base / "Drawings"
    wiki_path = safe_base / "Wiki"
    dashboard_path = safe_base / ".Dashboards"

    registry = db_path / "vault_db_registry.json"

    # ── Persistent App Data (Vault-first) ──
    # `.gnosi/` is the only vault-first configuration folder: it holds
    # identity, scheduler, custom icons and agent instructions/tools. All the
    # that belongs to a specific instance (caches, SQLite, vector stores,
    # checkpoints, audio, logs, backups) lives in `local_data/` (per device,
    # not synchronized).
    persistent_base = safe_base / ".gnosi"
    agent_instructions = persistent_base / "agent" / "instructions"
    agent_tools = persistent_base / "agent" / "generated_tools"

    # ── Ensure foundational directories exist (Safe mode) ──
    if vault_path:
        for p in [
            vault_path,
            db_path,
            assets_path,
            calendar_path,
            mail_path,
            plantilles_path,
            dibuixos_path,
            wiki_path,
            dashboard_path,
            persistent_base,
            agent_instructions,
            agent_tools,
        ]:
            if p:
                try:
                    if not p.exists():
                        p.mkdir(parents=True, exist_ok=True)
                except Exception:
                    pass

    return {
        "PROJECT_DIR": project_root,
        "VAULT": vault_path,  # Keep original as None if not set
        "DATABASES": db_path,
        "NEWSLETTERS": newsletters_path,
        "ASSETS": assets_path,
        "CALENDAR": calendar_path,
        "MAIL": mail_path,
        "PLANTILLES": plantilles_path,
        "DIBUIXOS": dibuixos_path,
        "WIKI": wiki_path,
        "DASHBOARDS": dashboard_path,
        # `.gnosi/` canonical base for synced config.
        "GNOSI_CONFIG": persistent_base,
        "REGISTRY": registry,
        # Operational logs — per-instance (go to local_data inside the container).
        "LOGS": local_data / "logs",
        "LOG_DIR": local_data / "logs",
        # Vector store and audio: per-instance, never in the vault.
        "CHROMA": local_data / "chroma_db",
        "AUDIO": local_data / "audio",
        # Vault-first synchronized configuration through .gnosi/.
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
        "SECRETS": secrets_dir,
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
