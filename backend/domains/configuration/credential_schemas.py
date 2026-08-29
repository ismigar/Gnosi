"""Public schemas for secret-safe credential management."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class CredentialSet(BaseModel):
    key: str
    value: str


class CredentialStatus(BaseModel):
    key: str
    name: str
    description: str
    has_value: bool


class CredentialMutationResponse(BaseModel):
    status: Literal["success"]
    key: str
    message: str


class CredentialMigrationResponse(BaseModel):
    status: Literal["success"]
    migrated: list[str]
    failed: list[str]
    total: int
    source_modified: Literal[False]


__all__ = [
    "CredentialMigrationResponse",
    "CredentialMutationResponse",
    "CredentialSet",
    "CredentialStatus",
]
