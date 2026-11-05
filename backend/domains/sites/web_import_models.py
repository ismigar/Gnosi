"""Validated private snapshots and the public URL import preview projection."""
from __future__ import annotations

from typing import TypedDict

from pydantic import Field

from .models import Contract, NavigationLink, SitePage


class ImportedPage(SitePage):
    url: str
    navigation: list[NavigationLink] = Field(default_factory=list)


class ImportedAsset(Contract):
    file: str = Field(pattern=r"^[a-f0-9]{64}\.(png|jpg|webp|gif)$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ImportSnapshot(Contract):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    url: str
    name: str
    pages: list[ImportedPage] = Field(min_length=1, max_length=100)
    assets: dict[str, ImportedAsset]
    owner: str
    expires: float = Field(allow_inf_nan=False)
    warnings: list[str]


class SnapshotEnvelope(Contract):
    snapshot: ImportSnapshot
    digest: str


class CreationReceipt(Contract):
    request: str
    site_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class PreviewPage(TypedDict):
    id: str
    title: str
    path: str
    language: str


class PreviewPayload(TypedDict):
    id: str
    url: str
    name: str
    pages: list[PreviewPage]
    warnings: list[str]
    expires_at: str
    assets_count: int
