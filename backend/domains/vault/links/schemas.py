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
    "LinkMentionsRequest",
    "VaultBacklinkResponse",
    "VaultLinkedMentionChangeResponse",
    "VaultLinkMentionsResponse",
    "VaultOutlinksResponse",
    "VaultPageLinkResponse",
    "VaultUnlinkedMentionResponse",
    "VaultUnresolvedLinkResponse",
]
