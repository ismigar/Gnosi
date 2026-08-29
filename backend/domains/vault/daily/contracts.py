"""Public response contracts for Vault daily notes."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DailyNoteSummaryResponse(BaseModel):
    id: str
    date: str
    title: str


class DailyNoteDocumentResponse(BaseModel):
    """Existing or newly created page, with the shared stable identifier."""

    model_config = ConfigDict(extra="allow")

    id: str


__all__ = ["DailyNoteDocumentResponse", "DailyNoteSummaryResponse"]
