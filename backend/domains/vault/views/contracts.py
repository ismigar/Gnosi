"""Public HTTP contracts for saved Vault views."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, JsonValue


class VaultViewInput(BaseModel):
    """Flexible saved-view payload with its stable public fields typed."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    table_id: str | None = None
    name: str | None = None
    type: str | None = None
    is_main: bool | None = None
    hidden: bool | None = None
    embedded: bool | None = None
    order: float | None = None
    visibleProperties: list[JsonValue] | None = None
    cardSize: str | None = None
    galleryPreview: str | None = None


class VaultViewResponse(VaultViewInput):
    id: str


class ViewReorderRequest(BaseModel):
    table_id: str
    ordered_ids: list[str]


class ViewReorderResponse(BaseModel):
    ok: bool
    table_id: str
    count: int


class ViewUsagePageResponse(BaseModel):
    id: str
    title: str
    path: str


class ViewUsageResponse(BaseModel):
    view_id: str
    count: int
    pages: list[ViewUsagePageResponse]


class ViewMutationResponse(BaseModel):
    status: str


__all__ = [
    "VaultViewInput",
    "VaultViewResponse",
    "ViewMutationResponse",
    "ViewReorderRequest",
    "ViewReorderResponse",
    "ViewUsagePageResponse",
    "ViewUsageResponse",
]
