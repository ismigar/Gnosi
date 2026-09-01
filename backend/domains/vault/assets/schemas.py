"""Frozen request schemas for vault asset routes."""

from __future__ import annotations

from pydantic import BaseModel


class CustomIconsRequest(BaseModel):
    icons: list[str] = []


class IconUrlImportRequest(BaseModel):
    url: str


__all__ = ["CustomIconsRequest", "IconUrlImportRequest"]
