"""Public contracts for selecting the Vault Brain table."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


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


class LlmWikiBrainCreateRequest(BaseModel):
    """Loose 2.x-compatible body for the namespaced Brain creator."""

    name: object | None = None
    ui_locale: object | None = None
    language: object | None = None


class LlmWikiConfigUpdateRequest(BaseModel):
    """Known persisted settings without pre-empting legacy normalization."""

    version: object | None = None
    ui_locale: object | None = None
    brain_table_id: object | None = None
    target_table: object | None = None
    source_tables: object | None = None
    index_field_ids: object | None = None
    brain_roles: object | None = None
    source_contract_revision: object | None = None
    configured: object | None = None


class BrainTableCreateResponse(BaseModel):
    table_id: str
    configured: Literal[True]
    name: str | None
    created: Literal[True]


class BrainTableClearResponse(BaseModel):
    table_id: None
    configured: Literal[False]


class LlmWikiBrainResponse(BaseModel):
    table_id: str | None
    name: str | None
    configured: bool


class LlmWikiSettingsDocument(BaseModel):
    """Persisted configuration with forward-compatible feature fields."""

    model_config = ConfigDict(extra="allow")

    version: int | None = None
    brain_table_id: str = ""
    target_table: str = ""
    source_tables: list[dict[str, JsonValue]] = Field(default_factory=list)
    index_field_ids: list[str] = Field(default_factory=list)
    brain_roles: dict[str, JsonValue] = Field(default_factory=dict)
    configured: bool = False
    ui_locale: str | None = None


class LlmWikiSettingsOptionResponse(BaseModel):
    label: str
    value: str


class LlmWikiCapabilitiesResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    modules: dict[str, bool]
    binaries: dict[str, bool]
    supported_extensions: list[str]
    streaming: bool
    ocr: bool
    ocr_languages: list[str]
    ocr_missing_languages: list[str]
    transcription: bool


class LlmWikiValidationResponse(BaseModel):
    valid: bool
    missing: list[dict[str, JsonValue]]


class LlmWikiConfigResponse(BaseModel):
    """Migrated configuration plus runtime status used by settings and pages."""

    model_config = ConfigDict(extra="allow")

    config: LlmWikiSettingsDocument
    brain: LlmWikiBrainResponse
    eligible_index_properties: list[dict[str, JsonValue]]
    index_options: dict[str, list[LlmWikiSettingsOptionResponse]]
    capabilities: LlmWikiCapabilitiesResponse
    validation: LlmWikiValidationResponse
    processed_resources: JsonValue
    resource_statuses: JsonValue
    enabled: bool


class LlmWikiCreatedSettingsResponse(LlmWikiConfigResponse):
    """Settings response returned after creating the standard Brain table."""

    table_id: str
    configured: bool
    name: str | None
    created: bool


# Compatibility name used by the Settings-specific contract tests and clients.
LlmWikiSettingsResponse = LlmWikiConfigResponse


__all__ = [
    "BrainTableClearResponse",
    "BrainTableCreateRequest",
    "BrainTableCreateResponse",
    "BrainTableSelectionRequest",
    "BrainTableSelectionResponse",
    "BrainTableStatusResponse",
    "LlmWikiBrainResponse",
    "LlmWikiBrainCreateRequest",
    "LlmWikiCapabilitiesResponse",
    "LlmWikiConfigResponse",
    "LlmWikiConfigUpdateRequest",
    "LlmWikiCreatedSettingsResponse",
    "LlmWikiSettingsDocument",
    "LlmWikiSettingsOptionResponse",
    "LlmWikiSettingsResponse",
    "LlmWikiValidationResponse",
]
