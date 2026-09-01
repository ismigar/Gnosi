"""Public request and response contracts for contacts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class ContactWriteRequest(BaseModel):
    """Backward-compatible fields accepted when creating or updating a contact."""

    model_config = ConfigDict(extra="allow")

    name: str | None = None
    email: str | None = None
    type: str | None = None
    phone: str | None = None
    company: str | None = None
    job_title: str | None = None
    address: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    emails: list[dict[str, Any]] | None = None
    phones: list[dict[str, Any]] | None = None
    addresses: list[dict[str, Any]] | None = None
    photo_url: str | None = None
    source: str | None = None
    google_resource_name: str | None = None
    apple_resource_id: str | None = None


class ContactResponse(BaseModel):
    """Serialized local contact, including provider synchronization metadata."""

    id: str
    workspace_id: str
    type: str
    name: str
    email: str
    phone: str | None
    company: str | None
    job_title: str | None
    address: str | None
    notes: str | None
    google_resource_name: str | None
    apple_resource_id: str | None
    last_synced_at: str | None
    source: str
    photo_url: str | None
    tags: JsonValue
    emails: JsonValue
    phones: JsonValue
    addresses: JsonValue
    created_at: str | None
    updated_at: str | None


class ContactDeleteResponse(BaseModel):
    """Acknowledgement returned after deleting one contact."""

    status: str
    message: str


class ContactSyncRequest(BaseModel):
    """Provider credentials and account selectors for a manual contact sync."""

    model_config = ConfigDict(extra="allow")

    provider: str | None = None
    email: str | None = None
    server_url: str | None = None
    username: str | None = None
    password: str | None = None


class ContactPushResultResponse(BaseModel):
    """Remote mutations produced by one outbound synchronization."""

    created: int
    updated: int
    deleted: int
    errors: list[str] = Field(default_factory=list)
    skipped: int


class ContactPullResultResponse(BaseModel):
    """Local mutations produced by one inbound synchronization."""

    imported: int
    updated: int
    errors: list[str] = Field(default_factory=list)


class ContactVaultExportResponse(BaseModel):
    """Vault files written while completing synchronization."""

    exported: int
    errors: list[str] = Field(default_factory=list)


class ContactSyncResultResponse(BaseModel):
    """Complete bidirectional synchronization report."""

    gnosi_to_remote: ContactPushResultResponse
    remote_to_gnosi: ContactPullResultResponse
    vault_export: ContactVaultExportResponse
    timestamp: str


class ContactSyncResponse(BaseModel):
    """Manual synchronization acknowledgement and report."""

    status: str
    result: ContactSyncResultResponse


class ContactSyncStatusResponse(BaseModel):
    """Current local synchronization counters."""

    contacts_count: int
    google_synced_count: int
    pending_sync_count: int
    last_sync_at: datetime | None = None
    last_sync: str | None = None
    last_error: str | None = None
