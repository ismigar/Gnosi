"""Public request contracts for vault comments."""

from __future__ import annotations

from pydantic import BaseModel


class CommentCreateRequest(BaseModel):
    body: str
    author: str | None = None


class CommentUpdateRequest(BaseModel):
    body: str | None = None
    resolved: bool | None = None


class InlineCommentRequest(BaseModel):
    quote: str = ""
    comment: str
    block_id: str | None = None


class InlineCommentPatch(BaseModel):
    comment: str | None = None
    resolved: bool | None = None


__all__ = [
    "CommentCreateRequest",
    "CommentUpdateRequest",
    "InlineCommentPatch",
    "InlineCommentRequest",
]
