"""Public request contracts for vault links."""

from __future__ import annotations

from pydantic import BaseModel


class LinkMentionsRequest(BaseModel):
    target_id: str
    source_id: str | None = None


__all__ = ["LinkMentionsRequest"]
