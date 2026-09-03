"""Pydantic contracts for the plugin configuration API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class PluginsUpdateRequest(BaseModel):
    # List of plugin ids the user has turned OFF. Everything else is on.
    disabled: list[JsonValue] = []
    # Per-plugin configuration, keyed by plugin id. Free-form so each plugin
    # owns its own schema (e.g. daily-notes → {"source_table_id", "date_property"}).
    settings: dict[str, JsonValue] = {}


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
    permissions: list[JsonValue] = []


class PluginSettingsRequest(BaseModel):
    # Patch to merge with the plugin's own configuration (key `settings`).
    settings: dict[str, JsonValue] = {}


class PluginNetworkFetchRequest(BaseModel):
    """Permission-gated network request from a UI plugin frame."""

    url: str
    opts: dict[str, JsonValue] = Field(default_factory=dict)


class VaultSummaryRequest(BaseModel):
    """Payload accepted by the built-in vault summary plugin."""

    content: str
    language: str = "en"


class PluginSettingsResponse(BaseModel):
    """Dynamic settings document owned by one plugin."""

    model_config = ConfigDict(extra="allow")

    settings: dict[str, JsonValue]


class ConfigurationPluginStateResponse(BaseModel):
    """Versioned plugin activation state exposed to the frontend host."""

    model_config = ConfigDict(extra="allow")

    schema_version: int | None = None
    enabled_builtin: list[str] = Field(default_factory=list)
    enabled_third_party: list[str] = Field(default_factory=list)
    disabled: list[str] = Field(default_factory=list)
    settings: dict[str, JsonValue] = Field(default_factory=dict)
    granted: dict[str, JsonValue] = Field(default_factory=dict)
    builtins: list[dict[str, JsonValue]] | None = None
    registry_url: str | None = None


class ConfigurationPluginPermissionsCatalogResponse(BaseModel):
    """Capability descriptions supported by the plugin host."""

    permissions: dict[str, str]
    apiVersion: int


class ConfigurationPluginManifestResponse(BaseModel):
    """Validated third-party plugin manifest displayed by Settings."""

    model_config = ConfigDict(extra="allow")

    id: str
    version: str | None = None
    name: str | None = None
    description: str | None = None
    main: str | None = None
    permissions: list[str] = Field(default_factory=list)
    author: str | None = None
    homepage: str | None = None


class ConfigurationInstalledPluginResponse(BaseModel):
    """One installed plugin or one discoverable broken installation."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    error: str | None = None
    manifest: ConfigurationPluginManifestResponse | None = None
    enabled: bool | None = None
    granted: list[str] = Field(default_factory=list)
    provenance: dict[str, JsonValue] | None = None


class ConfigurationInstalledPluginsResponse(BaseModel):
    """Installed third-party plugin inventory."""

    plugins: list[ConfigurationInstalledPluginResponse]


class ConfigurationPluginCatalogEntryResponse(BaseModel):
    """One local or remote plugin catalog entry."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str | None = None
    version: str | None = None
    description: str | None = None
    author: str | None = None
    source: str | None = None
    installed: bool
    signed: bool


class ConfigurationPluginCatalogResponse(BaseModel):
    """Plugin marketplace entries with installation state."""

    catalog: list[ConfigurationPluginCatalogEntryResponse]


class ConfigurationPluginTrustedKeyResponse(BaseModel):
    """Safe public summary of one trusted signing key."""

    name: str
    fingerprint: str


class ConfigurationPluginTrustedKeysResponse(BaseModel):
    """Trusted signing-key summaries."""

    keys: list[ConfigurationPluginTrustedKeyResponse]


class ConfigurationPluginRegistryUrlResponse(BaseModel):
    """Effective remote plugin registry URL."""

    url: str


class ConfigurationPluginNetworkFetchResponse(BaseModel):
    """Bounded network response returned to a sandboxed UI plugin."""

    status: int
    body: str
    contentType: str


class VaultPluginSummaryResponse(BaseModel):
    """Generated summary and the governed model that produced it."""

    summary: str
    model: str


class PluginPermissionsMutationResponse(BaseModel):
    """Permissions retained after one plugin grant mutation."""

    id: str
    granted: list[str]


class PluginInstallationResponse(BaseModel):
    """Validated manifest of a newly installed quarantined plugin."""

    installed: ConfigurationPluginManifestResponse


class PluginUninstallResponse(BaseModel):
    """Identifier of the plugin removed from the current vault."""

    uninstalled: str


class PluginSubmissionResponse(BaseModel):
    """Forward-compatible response from the configured moderation broker."""

    model_config = ConfigDict(extra="allow")

    status: str | None = None


class PluginTrustedKeyAdditionResponse(BaseModel):
    """Name of the public signing key added to the trust store."""

    added: str


class PluginTrustedKeyRemovalResponse(BaseModel):
    """Name of the public signing key removed from the trust store."""

    removed: str


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
