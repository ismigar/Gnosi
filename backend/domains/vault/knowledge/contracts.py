"""Public contracts for selecting the Vault Brain table."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class BrainTableStatusResponse(BaseModel):
    table_id: str | None
    configured: bool
    name: str | None
    source_table_ids: list[str]
    index_field_ids: list[str]


class BrainTableSelectionRequest(BaseModel):
    table_id: str
    ui_locale: str | None = None
    language: str | None = None


class BrainTableSelectionResponse(BaseModel):
    table_id: str
    configured: Literal[True]
    name: str | None
    columns_added: int


class BrainTableCreateRequest(BaseModel):
    name: str | None = None
    ui_locale: str | None = None
    language: str | None = None


class BrainTableCreateResponse(BaseModel):
    table_id: str
    configured: Literal[True]
    name: str | None
    created: Literal[True]


class BrainTableClearResponse(BaseModel):
    table_id: None
    configured: Literal[False]


__all__ = [
    "BrainTableClearResponse",
    "BrainTableCreateRequest",
    "BrainTableCreateResponse",
    "BrainTableSelectionRequest",
    "BrainTableSelectionResponse",
    "BrainTableStatusResponse",
]
