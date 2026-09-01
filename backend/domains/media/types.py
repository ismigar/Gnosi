"""Shared typed contracts for the media-center domain."""

from __future__ import annotations

from _thread import LockType
from pathlib import Path
from typing import TypedDict

MediaEntry = tuple[Path, float]
ScanCache = dict[str, tuple[float, list[MediaEntry]]]
ScanLocks = dict[str, LockType]


class MediaRootDefinition(TypedDict):
    """Static label and URL prefix for one selectable media root."""

    label: str
    url_prefix: str


MediaRoots = dict[str, MediaRootDefinition]


class MediaRootItem(TypedDict):
    """Runtime availability information for one media root."""

    key: str
    label: str
    url_prefix: str
    available: bool


class UserMetadataItem(TypedDict, total=False):
    """Tags and description associated with one media path."""

    tags: list[str]
    description: str
    updated_at: str


class HydratedUserMetadata(TypedDict):
    """Metadata shape guaranteed to file-serialization callers."""

    tags: list[str]
    description: str


class UserMetadataStore(TypedDict):
    """Versioned media metadata sidecar payload."""

    version: int
    items: dict[str, UserMetadataItem]


class ViewScope(TypedDict):
    """Saved media-root and album selection."""

    root: str
    album: str


class ViewFilters(TypedDict):
    """Saved filters understood by the media-center frontend."""

    kinds: list[object]
    q: str
    tagsAny: list[object]
    datePreset: str
    mtimeFrom: str
    mtimeTo: str
    sizePreset: str


class ViewSort(TypedDict):
    """Saved media sort field and direction."""

    field: str
    dir: str


class ViewPayload(TypedDict):
    """Normalized mutable fields of a saved view."""

    label: str
    scope: ViewScope
    filters: ViewFilters
    sort: ViewSort


class SavedView(ViewPayload):
    """Persisted view with stable identity and timestamps."""

    id: str
    created_at: str
    updated_at: str


class ViewStore(TypedDict):
    """Versioned saved-view sidecar payload."""

    version: int
    items: list[SavedView]


class ExifData(TypedDict):
    """Subset of EXIF fields exposed by the media API."""

    date_taken: str | None
    lat: float | None
    lng: float | None


class Coordinates(TypedDict):
    """Geographic coordinates extracted from EXIF."""

    lat: float | None
    lng: float | None


class MediaInfo(TypedDict):
    """Stable JSON representation of one media file."""

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
    location: Coordinates | None
    tags: list[str]
    description: str


class MediaPage(TypedDict):
    """Paginated media response."""

    items: list[MediaInfo]
    total: int
    limit: int
    offset: int
    root: str


class TreeNode(TypedDict):
    """One lazily discovered media folder."""

    name: str
    path: str
    has_children: bool
