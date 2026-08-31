"""Narrow typed access to the workspace authorization composition boundary."""

from __future__ import annotations

from collections.abc import Callable

from backend.services import workspace_service as _workspace_security
from backend.services.workspace_service import WorkspaceContext

get_workspace_context = _workspace_security.get_workspace_context


def require_role(role: str) -> Callable[[WorkspaceContext], WorkspaceContext]:
    """Return the canonical workspace role dependency without broad imports."""
    return _workspace_security.require_role(role)


__all__ = ["get_workspace_context", "require_role"]
