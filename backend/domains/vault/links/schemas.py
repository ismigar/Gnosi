"""Public request contracts for vault links."""

from __future__ import annotations

from pydantic import BaseModel, RootModel


class LinkMentionsRequest(BaseModel):
    target_id: str
    source_id: str | None = None


class GlobalIndexResponse(RootModel[dict[str, str]]):
    """Global page identifier to title lookup."""


class AliasIndexResponse(RootModel[dict[str, list[str]]]):
    """Global page identifier to declared aliases lookup."""


__all__ = ["AliasIndexResponse", "GlobalIndexResponse", "LinkMentionsRequest"]
