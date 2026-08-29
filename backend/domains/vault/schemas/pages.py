"""Page API schemas owned by the vault domain."""

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


class PageSaveRequest(BaseModel):
    title: str
    content: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict[str, Any] = {}
    expected_etag: Optional[str] = None
    force: bool = False


class PageInfo(BaseModel):
    id: str
    title: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict[str, Any] = {}
    last_modified: str
    created_time: Optional[str] = None
    size: int
    folder: str = ""
    path: Optional[str] = None
    resolved_table_id: Optional[str] = None


class PageDetailResponse(BaseModel):
    """Full page document; metadata remains open for user-defined frontmatter."""

    id: str
    title: Any
    metadata: dict[str, Any]
    content: str
    folder: str
    resolved_table_id: Optional[str] = None
    etag: str


class PagePreviewResponse(BaseModel):
    """Compact page preview, optionally including full Markdown and images."""

    id: str
    title: Any
    excerpt: str
    icon: Any = None
    cover: Any = None
    body_md: Optional[str] = None
    images: Optional[list[str]] = None


class BulkPreviewWarmResponse(BaseModel):
    """Counters from a best-effort preview cache warmup."""

    requested: int
    cached: int
    warmed: int
    failed: int


class PageMutationResponse(BaseModel):
    """Canonical page document returned after create, save or patch."""

    status: str
    id: str
    title: Any
    metadata: dict[str, Any]
    content: str
    folder: str
    resolved_table_id: Optional[str] = None
    etag: Optional[str] = None
    message: str


class PageDeleteResponse(BaseModel):
    """Soft-delete receipt returned when a page enters the vault trash."""

    status: str
    id: str
    deleted_at: Optional[str] = None
    title: Optional[str] = None
    original_path: Optional[str] = None
    retention_days: int
    restorable_until: Optional[str] = None


class PagePatchRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    parent_id: Optional[str] = None
    is_database: Optional[bool] = None
    remove_metadata_keys: Optional[list[Any]] = None
    expected_etag: Optional[str] = None
    force: bool = False


class SidebarPageInfo(BaseModel):
    id: str
    title: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict[str, Any] = {}
    last_modified: str
    folder: str = ""
    resolved_table_id: Optional[str] = None


class TablePagesSnapshot(BaseModel):
    table_id: str
    raw_count: int
    visible_count: int
    pages: List[PageInfo]


class PageDuplicateResponse(BaseModel):
    status: Literal["created"]
    id: str
    message: str
    title: str


class BulkApplyTemplateRequest(BaseModel):
    page_ids: list[str]
    template_id: str
    expected_etags: dict[str, str] = Field(default_factory=dict)


class BulkMutationEtagResponse(BaseModel):
    page_id: str
    etag: str | None


class BulkMutationConflictResponse(BaseModel):
    page_id: str
    expected_etag: str | None = None
    current_etag: str | None = None


class BulkMutationErrorResponse(BaseModel):
    page_id: str
    error: str | None = None


class BulkPageMutationResponse(BaseModel):
    updated: int
    updated_ids: list[str]
    updated_with_etags: list[BulkMutationEtagResponse]
    skipped: list[str]
    conflicts: list[BulkMutationConflictResponse]
    errors: list[BulkMutationErrorResponse]


class _BulkWarmPayload(BaseModel):
    ids: List[str]


__all__ = [
    "BulkApplyTemplateRequest",
    "BulkMutationConflictResponse",
    "BulkMutationErrorResponse",
    "BulkMutationEtagResponse",
    "BulkPageMutationResponse",
    "PageInfo",
    "PageDuplicateResponse",
    "PageDetailResponse",
    "PagePreviewResponse",
    "BulkPreviewWarmResponse",
    "PageDeleteResponse",
    "PageMutationResponse",
    "PagePatchRequest",
    "PageSaveRequest",
    "SidebarPageInfo",
    "TablePagesSnapshot",
    "_BulkWarmPayload",
]
