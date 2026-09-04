"""Compatibility-preserving request contracts for Vault file routes."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, SkipValidation


class VaultFileRequest(BaseModel):
    """Named object boundary that preserves every accepted 2.x JSON value."""

    model_config = ConfigDict(extra="allow")

    def as_payload(self) -> dict[str, object]:
        """Return known and extension fields without serializing raw values."""
        return {name: value for name, value in self}


class LocalFileRegistrationRequest(VaultFileRequest):
    """Absolute local path selected for stable token registration."""

    file_path: SkipValidation[object] = ""


class LinkedExistingFileRequest(VaultFileRequest):
    """Existing local path and optional in-place target name."""

    file_path: SkipValidation[object] = ""
    target_name: SkipValidation[object] = ""


class PhysicalFileDeletionRequest(VaultFileRequest):
    """Stored file target selected for contained physical deletion."""

    target: SkipValidation[object] = ""


__all__ = [
    "LinkedExistingFileRequest",
    "LocalFileRegistrationRequest",
    "PhysicalFileDeletionRequest",
    "VaultFileRequest",
]
