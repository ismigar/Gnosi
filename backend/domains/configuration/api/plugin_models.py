"""Pydantic contracts for the plugin configuration API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PluginsUpdateRequest(BaseModel):
    # List of plugin ids the user has turned OFF. Everything else is on.
    disabled: list[Any] = []
    # Per-plugin configuration, keyed by plugin id. Free-form so each plugin
    # owns its own schema (e.g. daily-notes → {"source_table_id", "date_property"}).
    settings: dict[str, Any] = {}


class PluginLifecycleRequest(BaseModel):
    """Explicit lifecycle request for a built-in or installed plugin."""

    enabled: bool
    confirm_dependencies: bool = False
    confirm_disable: bool = False


class LlmWikiLifecycleRequest(PluginLifecycleRequest):
    """Backward-compatible lifecycle request for LLM Wiki."""


class PluginPermissionsRequest(BaseModel):
    # List of permissions the user GRANTS to the plugin (subset of the
    # catalog). Empty = revoke all of them.
    permissions: list[Any] = []


class PluginSettingsRequest(BaseModel):
    # Patch to merge with the plugin's own configuration (key `settings`).
    settings: dict[str, Any] = {}


class PluginNetworkFetchRequest(BaseModel):
    """Permission-gated network request from a UI plugin frame."""

    url: str
    opts: dict[str, Any] = Field(default_factory=dict)


class VaultSummaryRequest(BaseModel):
    """Payload accepted by the built-in vault summary plugin."""

    content: str
    language: str = "en"


class PluginSettingsResponse(BaseModel):
    """Dynamic settings document owned by one plugin."""

    model_config = ConfigDict(extra="allow")

    settings: dict[str, Any]


class VaultPluginSummaryResponse(BaseModel):
    """Generated summary and the governed model that produced it."""

    summary: str
    model: str


class CatalogInstallRequest(BaseModel):
    # Installs a `bundled` plugin from the catalog by its id, OR from a remote .zip.
    id: str | None = None
    url: str | None = None
    # Optional SHA-256 checksum to verify the integrity of a remote .zip.
    sha256: str | None = None
    # Optional Ed25519 (base64) signature; if given, it must verify against a
    # key from the trust store or the installation is rejected.
    signature: str | None = None


class TrustedKeyRequest(BaseModel):
    name: str
    public_key: str


class RegistryUrlRequest(BaseModel):
    url: str | None = None
