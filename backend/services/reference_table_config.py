"""Storage for the Vault's "References Table" designation.

This configuration was originally shared with the Zotero ↔ Vault sync
(removed in the deprecated sync code cleanup). What survives: the
**designation of which Vault table is the Recursos one** (for gating
the Citations modal, export with resolved citations via pandoc, etc.).

The JSON lives at GNOSI_DATA_DIR/config/references.json. An older source-tree
configuration requires the explicit, journaled migration tool before startup;
runtime never copies or overwrites the legacy file.

Fields kept:
  - `target_table`: UUID of the Vault table designated as Recursos.
  - `references_configured`: bool, indicates whether the user has touched Settings
    (even if just to disable it). If True, it does NOT auto-migrate to a
    new table found by heuristics.
  - `linked_attachments_base`: optional, path to the folder of linked
    PDFs (inherited from Phase 6 attachments).

Fields inherited from the deprecated sync (may exist in the JSON but the
live code ignores them): `enabled`, `mapping`, `last_sync_*`, `existing_pages_strategy`,
`zotero_db`. We don't reproduce them in `DEFAULT_CONFIG` because merging the
defaults would be semantically false.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from backend.config.data_dir import resolve_data_dir
from backend.config.validation_runtime import validation_runtime_enabled

# Serializes the WHOLE load→modify→save cycle of the config. There are two writers
# independent: the designation from Settings (`_set_reference_table_id`) and
# the one-shot auto-migration of `get_reference_table_id` (adopts a table with
# 'Citation Key' in old vaults). Without a lock, an in-progress auto-migration
# could clobber the designation the user had just saved in Settings.
cfg_lock = threading.Lock()

_BASE_DIR = Path(__file__).resolve().parents[2]


def _config_path() -> Path:
    """Resolve canonical storage, checking any disposable validation boundary."""
    validation_runtime_enabled()
    return resolve_data_dir() / "config" / "references.json"


CONFIG_PATH = _config_path()

DEFAULT_CONFIG: dict[str, object] = {
    "target_table": "",
    "references_configured": False,
    "linked_attachments_base": "",
}


def assert_reference_config_ready() -> None:
    """Fail before startup/writes rather than silently discard a legacy designation."""
    if validation_runtime_enabled() or CONFIG_PATH.exists():
        return
    legacy = _BASE_DIR / "pipeline/skills/zotero_sync/zotero_db_config.json"
    if legacy.exists() or legacy.is_symlink():
        raise RuntimeError(
            "Legacy references configuration requires explicit migration. Stop Gnosi, "
            "run scripts/migrate-reference-config.py plan SOURCE DATA_DIR, then migrate "
            "with --writers-stopped; see docs/data-migration-3.md. Original preserved."
        )


def load_json(path: Path, default: dict[str, object] | None = None) -> dict[str, object] | None:
    """Reads a JSON file. Returns `default` if it doesn't exist or is malformed."""
    if path == CONFIG_PATH:
        assert_reference_config_ready()
    if path is None or not path.exists():
        return default
    try:
        value: object = json.loads(path.read_text(encoding="utf-8"))
        return (
            {str(key): item for key, item in value.items()} if isinstance(value, dict) else default
        )
    except (OSError, ValueError, UnicodeError):
        return default


def save_json(path: Path, data: dict[str, object]) -> None:
    """Writes a JSON atomically (avoids corruption mid-write)."""
    if path == CONFIG_PATH:
        assert_reference_config_ready()
    path.parent.mkdir(parents=True, exist_ok=True)
    from backend.utils.safe_io import safe_write_json

    safe_write_json(path, data, indent=2, ensure_ascii=False)
