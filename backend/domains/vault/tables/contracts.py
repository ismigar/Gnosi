"""Public HTTP contracts for vault registry collections."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, RootModel

from backend.domains.vault.registry.state import RegistryData


class RegistryRecord(RootModel[dict[str, JsonValue]]):
    """One JSON-compatible database or table registry record."""


class _RegistryUpsertRequest(BaseModel):
    """Extensible registry record persisted verbatim since Gnosi 2.x."""

    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)

    id: JsonValue | None = None
    name: JsonValue | None = None
    folder: JsonValue | None = None

    def registry_data(self) -> RegistryData:
        """Restore the historical dictionary boundary, including extensions."""
        result: RegistryData = {
            key: value for key, value in self.model_dump(exclude_unset=True).items()
        }
        return result


class DatabaseUpsertRequest(_RegistryUpsertRequest):
    """Create or replace a database registry record."""


class TableUpsertRequest(_RegistryUpsertRequest):
    """Create or replace a complete, extension-capable table record."""

    database_id: JsonValue | None = None
    properties: JsonValue | None = None
    headers: JsonValue | None = None
    rows: JsonValue | None = None
    locale: JsonValue | None = None
    language: JsonValue | None = None
    translation_enabled: JsonValue | None = None
    drupal_sync_enabled: JsonValue | None = None
    drupal_bundle: JsonValue | None = None
    drupal_field_mapping: JsonValue | None = None
    action_rules: JsonValue | None = None
    automations: JsonValue | None = None
    schema_revision: JsonValue | None = None
    schema_source: JsonValue | None = None


class _CommandRequest(BaseModel):
    """Command body whose unknown keys were ignored by the 2.x handlers."""

    model_config = ConfigDict(extra="ignore")

    def registry_data(self) -> RegistryData:
        result: RegistryData = {
            key: value for key, value in self.model_dump(exclude_unset=True).items()
        }
        return result


class TableRenameRequest(_CommandRequest):
    name: JsonValue | None = None
    folder: JsonValue | None = None


class TableOptionRenameRequest(_CommandRequest):
    field_id: JsonValue | None = None
    field: JsonValue | None = None
    old: JsonValue | None = None
    new: JsonValue | None = None


class TableOptionRemoveRequest(_CommandRequest):
    field_id: JsonValue | None = None
    field: JsonValue | None = None
    value: JsonValue | None = None
    reassign_to: JsonValue | None = None


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


class OptionCatalogUpsertRequest(_CommandRequest):
    """Shared catalog command; 2.x consumed only the options member."""

    options: JsonValue | None = None


class FolderSchemaRequest(RootModel[dict[str, JsonValue]]):
    """Extensible folder schema document persisted verbatim."""

    def registry_data(self) -> RegistryData:
        """Expose the JSON object under the open-key internal registry contract."""
        result: RegistryData = {key: value for key, value in self.root.items()}
        return result


__all__ = [
    "DatabaseUpsertRequest",
    "FolderSchemaRequest",
    "OptionCatalogDeleteResponse",
    "OptionCatalogUpsertRequest",
    "RegistryRecord",
    "TableOptionRemoveRequest",
    "TableOptionRenameRequest",
    "TablePropertyPatchRequest",
    "TablePropertyPatchResponse",
    "TableRenameRequest",
    "TableUpsertRequest",
]
