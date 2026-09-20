"""Authenticated scope and bounded results for optional feature adapters."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from backend.agent.action_confirmations import current_confirmation_scope
from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import ROLE_WEIGHTS, WorkspaceContext


def feature_enabled(plugin_id: str) -> bool:
    from backend.domains.vault.api.configuration_routes import _load_plugins_state
    from backend.services.builtin_plugins import is_enabled

    return bool(is_enabled(_load_plugins_state(), plugin_id))


def feature_context(plugin_id: str, minimum_role: str = "viewer") -> WorkspaceContext:
    """Use server-bound identity only, rejecting stale/missing Vault context."""
    scope = current_confirmation_scope()
    vault = active_vault_path.get()
    if vault is None:
        raise PermissionError("An active authenticated Vault is required.")
    vault = vault.resolve()
    digest = hashlib.sha256(str(vault).encode("utf-8")).hexdigest()[:20]
    if digest != scope["vault_scope"]:
        raise PermissionError("The active Vault does not match this agent turn.")
    if ROLE_WEIGHTS.get(scope["role"], -1) < ROLE_WEIGHTS[minimum_role]:
        raise PermissionError("Your role cannot perform this operation.")
    if not feature_enabled(plugin_id):
        raise PermissionError(f"The required plugin is disabled: {plugin_id}")
    return WorkspaceContext(scope["workspace_id"], scope["user_id"], scope["role"], vault)


def result_json(value: Any) -> str:
    """Bound source text and lists while preserving valid JSON and truncation."""
    from backend.agent.gnosi_tools import _bounded_json_value

    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    bounded = _bounded_json_value(value)
    if isinstance(bounded, dict) and bounded != value:
        bounded["truncated"] = True
    return json.dumps(bounded, ensure_ascii=False, default=str)


def require_primary_workspace(context: WorkspaceContext) -> None:
    """Guard legacy Resources operations that redirect to the primary Vault."""
    from backend.services.context_vars import get_primary_vault_path

    primary = get_primary_vault_path()
    if context.workspace_id != "personal" or (primary and primary.resolve() != context.vault_path):
        raise PermissionError("This Resources operation requires the personal primary Vault.")
