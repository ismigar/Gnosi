"""Frozen request schemas for vault asset routes."""

from __future__ import annotations

from pydantic import BaseModel


class CustomIconsRequest(BaseModel):
    icons: list[str] = []


class IconUrlImportRequest(BaseModel):
    url: str


class AssetUploadResponse(BaseModel):
    """Stored asset location returned to editors after a multipart upload."""

    url: str
    path: str
    is_image: bool


__all__ = ["AssetUploadResponse", "CustomIconsRequest", "IconUrlImportRequest"]
