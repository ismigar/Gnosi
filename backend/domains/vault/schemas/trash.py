"""Public contracts for vault title resolution and recoverable trash."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class ResolveByTitleResponse(BaseModel):
    id: str | None = None
    title: str | None = None
    folder: str | None = None
    matched_alias: str | None = None


class TrashEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str | None = None
    deleted_at: str | None = None
    original_path: str | None = None
    original_parent_id: str | None = None
    table_id: str | None = None
    size_bytes: int = 0
    extension: str | None = None
    days_remaining: int | None = None


class TrashListResponse(BaseModel):
    items: list[TrashEntry]
    retention_days: int


class PageRestoreResponse(BaseModel):
    status: Literal["restored"]
    id: str
    restored_path: str | None = None
    title: str | None = None


class TrashPurgeResponse(BaseModel):
    status: Literal["purged"]
    id: str
    freed_bytes: int


class TrashEmptyResponse(BaseModel):
    status: Literal["emptied"]
    purged_count: int
    failed_count: int
    failed_ids: list[str]
    freed_bytes: int


__all__ = [
    "PageRestoreResponse",
    "ResolveByTitleResponse",
    "TrashEmptyResponse",
    "TrashEntry",
    "TrashListResponse",
    "TrashPurgeResponse",
]
