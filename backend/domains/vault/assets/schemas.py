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


class ImageAssetResponse(BaseModel):
    """Stored image location returned by a cover upload."""

    url: str
    path: str


class IconAssetResponse(BaseModel):
    """Stored icon location returned by upload and URL import routes."""

    url: str
    path: str
    thumbnail_url: str | None
    thumbnail_path: str | None


class CustomIconsResponse(BaseModel):
    """Shared custom-icon library persisted for the active Vault."""

    icons: list[str]


__all__ = [
    "AssetUploadResponse",
    "CustomIconsRequest",
    "CustomIconsResponse",
    "ImageAssetResponse",
    "IconAssetResponse",
    "IconUrlImportRequest",
]
