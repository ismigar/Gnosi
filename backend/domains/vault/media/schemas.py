"""Typed JSON contracts for the Vault media browser."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, JsonValue


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


class MediaViewScope(BaseModel):
    model_config = ConfigDict(extra="allow")

    root: str = "images"
    album: str = ""


class MediaViewFilters(BaseModel):
    model_config = ConfigDict(extra="allow")

    kinds: list[JsonValue] = Field(default_factory=list)
    q: str = ""
    tagsAny: list[JsonValue] = Field(default_factory=list)
    datePreset: str = "all"
    mtimeFrom: str = ""
    mtimeTo: str = ""
    sizePreset: str = "all"


class MediaViewSort(BaseModel):
    model_config = ConfigDict(extra="allow")

    field: str = "mtime"
    dir: str = "desc"


class MediaViewInput(BaseModel):
    """Mutable saved-view fields accepted by create and update routes."""

    model_config = ConfigDict(extra="allow")

    label: str = ""
    scope: MediaViewScope = Field(default_factory=MediaViewScope)
    filters: MediaViewFilters = Field(default_factory=MediaViewFilters)
    sort: MediaViewSort = Field(default_factory=MediaViewSort)


class MediaViewResponse(MediaViewInput):
    id: str
    created_at: str
    updated_at: str


class MediaMutationResponse(BaseModel):
    status: str


__all__ = [
    "MediaCoordinatesResponse",
    "MediaItemResponse",
    "MediaMutationResponse",
    "MediaPageResponse",
    "MediaRootResponse",
    "MediaTreeNodeResponse",
    "MediaViewFilters",
    "MediaViewInput",
    "MediaViewResponse",
    "MediaViewScope",
    "MediaViewSort",
]
