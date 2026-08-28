"""Narrow typed access to the workspace authorization composition boundary."""

from __future__ import annotations

import importlib
from collections.abc import Callable
from typing import Protocol, cast


class WorkspaceSecurityModule(Protocol):
    get_workspace_context: Callable[..., object]

    def require_role(self, role: str) -> Callable[..., object]: ...


_workspace_security = cast(
    WorkspaceSecurityModule,
    importlib.import_module("backend.services.workspace_service"),
)

get_workspace_context = _workspace_security.get_workspace_context


def require_role(role: str) -> Callable[..., object]:
    """Return the canonical workspace role dependency without broad imports."""
    return _workspace_security.require_role(role)


__all__ = ["get_workspace_context", "require_role"]
