"""Public request contracts for vault comments."""

from __future__ import annotations

from typing import Literal

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


class PageComment(BaseModel):
    id: str
    body: str
    author: str
    author_id: str | None = None
    created_at: str
    updated_at: str | None = None
    resolved: bool = False


class PageCommentThread(BaseModel):
    comments: list[PageComment]


class InlineComment(BaseModel):
    id: str
    quote: str
    comment: str
    block_id: str
    author_id: str | None = None
    created_at: str
    resolved: bool = False


class CommentDeleteResponse(BaseModel):
    status: Literal["deleted"]
    id: str


__all__ = [
    "CommentDeleteResponse",
    "CommentCreateRequest",
    "CommentUpdateRequest",
    "InlineComment",
    "InlineCommentPatch",
    "InlineCommentRequest",
    "PageComment",
    "PageCommentThread",
]
