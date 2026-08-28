"""Public request and response contracts for the System domain."""

from __future__ import annotations

from pydantic import BaseModel, Field

from backend.models.notification import NotificationResponse


class NotificationCreate(BaseModel):
    """Payload accepted by the durable system notification log."""

    title: str
    message: str = ""
    level: str = "INFO"
    workspace_id: str = "default"


class NotificationPageResponse(BaseModel):
    """One stable page of system notifications."""

    items: list[NotificationResponse]
    total: int
    limit: int
    offset: int
    has_more: bool


class ClearNotificationsResponse(BaseModel):
    """Acknowledgement after clearing the notification log."""

    success: bool
    message: str


class BrowseRequest(BaseModel):
    """Directory requested by the in-app filesystem picker."""

    path: str = "/"


class SearchRequest(BaseModel):
    """Bounded whole-computer filename search."""

    query: str
    limit: int = 100


class NativePickRequest(BaseModel):
    """Options for the host-native file and folder panel."""

    mode: str = "any"
    prompt: str = ""
    multiple: bool = False


class SystemStatsResponse(BaseModel):
    """Current host resource and graph-index statistics."""

    cpu: float
    ram_percent: float
    memory_items: int
    status: str
    error: str | None = None


class SystemGraphVisualizationResponse(BaseModel):
    """Minimal graph visualization payload retained for compatibility."""

    nodes: list[dict[str, object]] = Field(default_factory=list)
    edges: list[dict[str, object]] = Field(default_factory=list)


class FilesystemRootsResponse(BaseModel):
    """Resolved filesystem shortcuts visible to an admin picker."""

    vault: str | None = None
    home: str | None = None
    root: str | None = "/"


class FilesystemBrowseResponse(BaseModel):
    """Directory listing or recoverable picker error."""

    current_path: str | None = None
    display_path: str | None = None
    directories: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    roots: FilesystemRootsResponse
    error: str | None = None
    error_code: str | None = None


class NativePickAvailabilityResponse(BaseModel):
    """Whether this caller can use the native host picker."""

    available: bool
    reason: str | None = None


class NativePickEntryResponse(BaseModel):
    """One path returned by the native picker."""

    path: str
    is_dir: bool


class NativePickResponse(BaseModel):
    """Native picker result, including the normal cancelled variant."""

    status: str
    path: str | None = None
    paths: list[str] = Field(default_factory=list)
    entries: list[NativePickEntryResponse] = Field(default_factory=list)
    is_dir: bool | None = None


class FilesystemSearchEntryResponse(BaseModel):
    """One file or directory matched by System search."""

    name: str
    path: str
    is_dir: bool


class FilesystemSearchResponse(BaseModel):
    """Bounded filename-search result from index, Spotlight, or fallback walk."""

    results: list[FilesystemSearchEntryResponse]
    truncated: bool
    engine: str | None = None
    error: str | None = None
