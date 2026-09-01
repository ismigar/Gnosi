"""Public JSON response contracts for Vault file insertion workflows."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class PropertyFileUploadResponse(BaseModel):
    """Location returned after uploading one configured property file."""

    model_config = ConfigDict(extra="forbid")

    path: str
    url: str | None
    storage: Literal["assets", "absolute"]


class LinkedExistingFileResponse(PropertyFileUploadResponse):
    """Location and rename metadata for one linked local file."""

    name: str
    size: int
    renamed: bool


class LocalFileRegistrationResponse(BaseModel):
    """Stable serving token and metadata for one registered local file."""

    model_config = ConfigDict(extra="forbid")

    token: str
    url: str
    name: str
    size: int
    kind: str
    extension: str
    path: str


__all__ = [
    "LinkedExistingFileResponse",
    "LocalFileRegistrationResponse",
    "PropertyFileUploadResponse",
]
