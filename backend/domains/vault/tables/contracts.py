"""Public HTTP contracts for vault registry collections."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, JsonValue, RootModel


class RegistryRecord(RootModel[dict[str, JsonValue]]):
    """One JSON-compatible database or table registry record."""


class TablePropertyPatchRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str | None = None
    type: str | None = None
    config: dict[str, JsonValue] | None = None


class TablePropertyPatchResponse(BaseModel):
    status: Literal["success"]
    table_id: str
    property: RegistryRecord


class OptionCatalogDeleteResponse(BaseModel):
    """Receipt returned after deleting an unused shared option catalog."""

    status: Literal["ok"]


__all__ = [
    "OptionCatalogDeleteResponse",
    "RegistryRecord",
    "TablePropertyPatchRequest",
    "TablePropertyPatchResponse",
]
