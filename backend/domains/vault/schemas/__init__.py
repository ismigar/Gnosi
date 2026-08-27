"""Typed request and response schemas for the vault domain."""

from backend.domains.vault.schemas.pages import (
    PageInfo,
    PagePatchRequest,
    PageSaveRequest,
    SidebarPageInfo,
    TablePagesSnapshot,
)

__all__ = [
    "PageInfo",
    "PagePatchRequest",
    "PageSaveRequest",
    "SidebarPageInfo",
    "TablePagesSnapshot",
]
