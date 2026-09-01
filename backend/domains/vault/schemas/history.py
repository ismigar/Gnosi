"""Public contracts for immutable vault page history."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class PageHistoryVersion(BaseModel):
    id: str
    timestamp: str
    size: int
    author: str | None = None


class PageHistoryContent(BaseModel):
    id: str
    version_id: str
    metadata: dict[str, Any]
    content: str


class PageHistoryMutationResponse(BaseModel):
    status: Literal["success"]
    message: str


__all__ = [
    "PageHistoryContent",
    "PageHistoryMutationResponse",
    "PageHistoryVersion",
]
