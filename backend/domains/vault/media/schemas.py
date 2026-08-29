"""Typed JSON contracts for the Vault media browser."""

from __future__ import annotations

from pydantic import BaseModel


class MediaRootResponse(BaseModel):
    key: str
    label: str
    url_prefix: str
    available: bool


class MediaTreeNodeResponse(BaseModel):
    name: str
    path: str
    has_children: bool


class MediaCoordinatesResponse(BaseModel):
    lat: float | None
    lng: float | None


class MediaItemResponse(BaseModel):
    id: str
    filename: str
    url: str
    path: str
    path_in_root: str
    album: str
    root: str
    kind: str
    size: int
    last_modified: str
    extension: str
    date_taken: str | None
    location: MediaCoordinatesResponse | None
    tags: list[str]
    description: str


class MediaPageResponse(BaseModel):
    items: list[MediaItemResponse]
    total: int
    limit: int
    offset: int
    root: str


__all__ = [
    "MediaCoordinatesResponse",
    "MediaItemResponse",
    "MediaPageResponse",
    "MediaRootResponse",
    "MediaTreeNodeResponse",
]
