"""Page API schemas owned by the vault domain."""

from typing import Any, List, Optional

from pydantic import BaseModel


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


class _BulkWarmPayload(BaseModel):
    ids: List[str]


__all__ = [
    "PageInfo",
    "PagePatchRequest",
    "PageSaveRequest",
    "SidebarPageInfo",
    "TablePagesSnapshot",
    "_BulkWarmPayload",
]
