"""Public response contracts for the aggregated vault tag index."""

from __future__ import annotations

from pydantic import BaseModel


class VaultTagPage(BaseModel):
    id: str
    title: str


class VaultTagSummary(BaseModel):
    name: str
    count: int
    pages: list[VaultTagPage]


class VaultTagsResponse(BaseModel):
    tags: list[VaultTagSummary]


__all__ = ["VaultTagPage", "VaultTagSummary", "VaultTagsResponse"]
