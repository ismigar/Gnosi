"""Vault-aware scheduler adapters for academic literature maintenance."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.config.app_config import load_params
from backend.services.context_vars import get_primary_vault_path


def _configured_vault_path() -> Path | None:
    """Resolve scheduled work to a Vault without constructing ``Path(None)``."""
    configured = get_primary_vault_path() or load_params(strict_env=False).paths.get("VAULT")
    return Path(configured).resolve() if configured else None


def queue_due_repository_syncs() -> dict[str, Any]:
    """Queue due OAI work or skip cleanly before the first Vault is selected."""
    vault_path = _configured_vault_path()
    if vault_path is None:
        return {
            "queued": 0,
            "skipped": True,
            "reason": "no_active_vault",
            "message": "Academic repository synchronization awaits an active Vault.",
        }
    from backend.services.literature_service import enqueue_due_syncs

    queued = enqueue_due_syncs(vault_path)
    return {
        "queued": queued,
        "message": f"Queued {queued} academic repository synchronizations.",
    }


def queue_due_review_updates() -> dict[str, Any]:
    """Queue due review work or skip cleanly before Vault configuration."""
    vault_path = _configured_vault_path()
    if vault_path is None:
        return {
            "queued": 0,
            "skipped": True,
            "reason": "no_active_vault",
            "message": "Literature review updates await an active Vault.",
        }
    from backend.services.literature_service import enqueue_due_review_updates

    queued = enqueue_due_review_updates(vault_path)
    return {
        "queued": queued,
        "message": f"Queued {queued} literature review updates.",
    }
