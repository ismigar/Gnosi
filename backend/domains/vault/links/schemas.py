"""Public request contracts for vault links."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, RootModel


class LinkMentionsRequest(BaseModel):
    target_id: str
    source_id: str | None = None


class GlobalIndexResponse(RootModel[dict[str, str]]):
    """Global page identifier to title lookup."""


class AliasIndexResponse(RootModel[dict[str, list[str]]]):
    """Global page identifier to declared aliases lookup."""


class VaultBacklinkResponse(BaseModel):
    id: str
    title: str
    kind: Literal["link", "relation"]


class VaultPageLinkResponse(BaseModel):
    id: str
    title: str


class VaultUnresolvedLinkResponse(BaseModel):
    title: str


class VaultOutlinksResponse(BaseModel):
    links: list[VaultPageLinkResponse]
    relations: list[VaultPageLinkResponse]
    unresolved: list[VaultUnresolvedLinkResponse]


class LinkIndexDiskCacheResponse(BaseModel):
    """Persistent reverse-link index cache metadata."""

    path: str | None
    exists: bool
    size_bytes: int


class LinkIndexStatsResponse(BaseModel):
    """Observable state of the reverse-link index."""

    built: bool
    built_ts: float
    built_age_seconds: float | None
    schema_version: int
    sources_indexed: int
    targets_with_backlinks: int
    unresolved_title_buckets: int
    total_outlinks: int
    total_tokens: int
    disk_cache: LinkIndexDiskCacheResponse


class LinkIndexRebuildResponse(BaseModel):
    """Acknowledgement that a reverse-link rebuild was scheduled."""

    status: Literal["rebuild_scheduled"]


class VaultUnlinkedMentionResponse(BaseModel):
    id: str
    title: str
    count: int
    snippet: str


class VaultLinkedMentionChangeResponse(BaseModel):
    id: str
    title: str
    replacements: int


class VaultLinkMentionsResponse(BaseModel):
    status: Literal["success"]
    target_id: str
    target_title: str
    notes_changed: int
    total_replacements: int
    changed_notes: list[VaultLinkedMentionChangeResponse]


__all__ = [
    "AliasIndexResponse",
    "GlobalIndexResponse",
    "LinkIndexDiskCacheResponse",
    "LinkIndexRebuildResponse",
    "LinkIndexStatsResponse",
    "LinkMentionsRequest",
    "VaultBacklinkResponse",
    "VaultLinkedMentionChangeResponse",
    "VaultLinkMentionsResponse",
    "VaultOutlinksResponse",
    "VaultPageLinkResponse",
    "VaultUnlinkedMentionResponse",
    "VaultUnresolvedLinkResponse",
]
