"""Storage for the Vault's "Cervell" (LLM Wiki) table designation.

The LLM Wiki feature (Karpathy's "LLM Wiki" pattern adapted to Gnosi) keeps
an agent-maintained knowledge table — the "Cervell" — fed by processing rows
of the references table (Recursos). This module persists WHICH table plays
the Cervell role.

Unlike the references-table designation (a GLOBAL, install-wide JSON at
``pipeline/skills/zotero_sync/zotero_db_config.json``), this designation is
PER-VAULT: it lives in ``<vault>/.gnosi/llm_wiki.json`` so it travels with
the vault (OneDrive sync between machines) and each vault can have its own
Cervell. New designations should follow this model, not the global one.

Fields:
  - ``target_table``: UUID of the Vault table designated as Cervell
    (``""`` = feature not wired to any table).
  - ``configured``: bool, the user has touched Settings (even to disable).
    Reserved for parity with the references config; there is no
    auto-migration heuristic for the Cervell (no pre-existing vaults to
    adopt), so today it only documents intent.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

# Serializes the whole load->modify->save cycle. Settings writes and future
# background consumers (ingest jobs) must not clobber each other.
cfg_lock = threading.Lock()

CONFIG_FILENAME = "llm_wiki.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "target_table": "",
    "configured": False,
}


def config_path() -> Path:
    """Path of the per-vault config file (``<vault>/.gnosi/llm_wiki.json``)."""
    # Lazy import: get_p lives in vault_routes and importing it at module
    # level would be circular (same pattern as plugin_dispatcher).
    from backend.api.vault_routes import get_p

    return get_p("GNOSI_CONFIG") / CONFIG_FILENAME


def load_config() -> dict[str, Any]:
    """Reads the config merged over defaults. Malformed/missing -> defaults."""
    path = config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    return {**DEFAULT_CONFIG, **data}


def save_config(cfg: dict[str, Any]) -> None:
    """Writes the config atomically (the vault lives on cloud-synced storage)."""
    from backend.utils.safe_io import safe_write_json

    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(path, cfg, indent=2, ensure_ascii=False)


def get_brain_table_id() -> str | None:
    """Id of the designated Cervell table, or None if not configured."""
    tid = str(load_config().get("target_table") or "").strip()
    return tid or None


def set_brain_table_id(table_id: str | None) -> None:
    """Persists the Cervell table designation (Settings -> ``target_table``)."""
    with cfg_lock:
        cfg = load_config()
        cfg["target_table"] = (table_id or "").strip()
        cfg["configured"] = True
        save_config(cfg)
