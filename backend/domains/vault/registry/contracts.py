"""Public contracts for opening local Vault resources through the host OS."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from backend.domains.vault.tables.contracts import RegistryRecord


class LocalPathOpenRequest(BaseModel):
    """A local path or file URL accepted by the compatibility endpoint."""

    path: str | None = None
    url: str | None = None


class LocalPathOpenResponse(BaseModel):
    """Resolved host path passed to the default application."""

    status: Literal["ok"]
    target: str
    kind: Literal["dir", "file"]


class ResourceOpenResponse(BaseModel):
    """Zotero URI or attachment path opened by the host."""

    status: Literal["ok"]
    opened_with: Literal["zotero_uri", "file_path"]
    target: str


class VaultRegistryResponse(BaseModel):
    """Full public registry while preserving extension-owned top-level keys."""

    model_config = ConfigDict(extra="allow")

    databases: list[RegistryRecord]
    tables: list[RegistryRecord]
    views: list[RegistryRecord]


class VaultRegistryUpdateRequest(VaultRegistryResponse):
    """Administrator-only full-registry replacement payload."""


class RegistryMutationResponse(BaseModel):
    status: Literal["success"]


__all__ = [
    "LocalPathOpenRequest",
    "LocalPathOpenResponse",
    "RegistryMutationResponse",
    "ResourceOpenResponse",
    "VaultRegistryResponse",
    "VaultRegistryUpdateRequest",
]
