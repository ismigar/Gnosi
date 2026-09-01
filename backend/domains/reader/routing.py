"""Shared runtime contract for Reader route modules."""

import inspect
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypeAlias

from fastapi import HTTPException

from backend.services.context_vars import get_active_vault_path


if TYPE_CHECKING:
    RouteReturn: TypeAlias = Any
else:
    # FastAPI must observe the pre-PR6 absence of a return annotation so its
    # generated response schema remains byte-for-byte stable. Mypy sees Any.
    RouteReturn = inspect.Signature.empty


def require_active_vault() -> Path:
    """Return the active Vault or preserve the Reader API's 503 response."""
    vault_path = get_active_vault_path()
    if vault_path is None:
        raise HTTPException(status_code=503, detail="No active Vault is available")
    return vault_path


__all__ = ["RouteReturn", "require_active_vault"]
