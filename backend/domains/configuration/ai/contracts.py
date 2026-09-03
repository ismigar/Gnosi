"""Public request and response contracts for AI registry and usage APIs."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, RootModel


class AiConfigurationDocument(RootModel[dict[str, JsonValue]]):
    """Sanitized AI configuration with provider-specific JSON extensions."""


class AiProviderCatalogEntry(BaseModel):
    """One provider offered by the AI connection catalog."""

    id: str
    name: str
    icon: str
    models: list[str]
    models_count: int
    is_local: bool
    live: bool
    env: list[str]
    doc: str
    base_url: str | None
    base_url_hint: str
    model_name: str
    credential_ref: str | None
    has_api_key: bool
    connected: bool
    configured: bool
    enabled: bool


class AiProviderCatalog(BaseModel):
    """Provider list used by the connection settings UI."""

    providers: list[AiProviderCatalogEntry]


class AiCatalogResponse(BaseModel):
    """Live provider catalog paired with sanitized persisted configuration."""

    catalog: AiProviderCatalog
    config: AiConfigurationDocument


class ProviderValidationResponse(BaseModel):
    """Result of the live credential/provider probe."""

    success: bool
    response: JsonValue | None = None
    error: str | None = None


class ProviderCredentialsResponse(BaseModel):
    """Acknowledgement after securely storing provider credentials."""

    status: Literal["success"]
    provider: str
    credential_ref: str
    has_api_key: Literal[True]


class ProviderDeletionResponse(BaseModel):
    """Complete result of disconnecting one provider and its model rows."""

    status: Literal["success", "skipped"]
    message: str
    removed_models: int
    credential_deleted: bool
    env_keys_deleted: list[str]


class ProviderStatusResponse(BaseModel):
    """Persisted enabled state for one provider."""

    status: Literal["success"]
    provider: str
    enabled: bool


class CurrencyInfoResponse(BaseModel):
    """Currency conversion metadata shared by registry and usage views."""

    code: str
    symbol: str
    usd_rate: float
    source: str
    fetched_at: str


class ModelRegistryEntry(BaseModel):
    """One configured router model, preserving provider-specific JSON metadata."""

    model_config = ConfigDict(extra="allow")

    provider: str
    model_id: str
    is_local: bool | None = None
    enabled: bool | None = None
    priority: int | None = None
    cost_in: float | None = None
    cost_out: float | None = None
    context_window: int | None = None
    quality: int | None = None
    tags: list[str] | None = None
    monthly_quota: int | None = None
    endpoint: str | None = None
    price_from_catalog: bool | None = None
    price_unknown: bool | None = None


class ModelsPayload(BaseModel):
    """Registry update retaining the legacy manual 400 validation boundary.

    Individual rows remain JSON values so malformed rows reach the existing
    route validation and keep its status code and localized error detail.
    """

    models: list[JsonValue]
    budget: dict[str, JsonValue] | None = None


class ModelRegistryResponse(BaseModel):
    """Effective and explicitly configured model registries."""

    models: list[ModelRegistryEntry]
    configured_models: list[ModelRegistryEntry]
    budget: dict[str, JsonValue]
    default: list[ModelRegistryEntry]
    currency: CurrencyInfoResponse


class ModelRegistryUpdateResponse(BaseModel):
    """Acknowledgement after atomically replacing the model registry."""

    status: Literal["success"]
    count: int


class ModelCatalogModel(BaseModel):
    """Normalized model metadata from models.dev or the local Ollama overlay."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    cost_in: float
    cost_out: float
    context_window: int
    modes: list[str] | None = None
    tags: list[str]
    quality: int
    release_date: str


class ModelCatalogProvider(BaseModel):
    """One catalog provider annotated with the current connection state."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    is_local: bool
    env: list[str]
    api: str
    npm: str
    doc: str
    models: list[ModelCatalogModel]
    live: bool | None = None
    connected: bool
    configured: bool
    enabled: bool
    has_api_key: bool
    base_url: str | None


class ModelCatalogResponse(BaseModel):
    """Normalized provider and model catalog used by the registry editor."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    schema_version: int = Field(alias="schema")
    source: str
    generated_at: str | None = None
    fetched_at: str | None = None
    providers: list[ModelCatalogProvider]


class ModelComparisonRoute(BaseModel):
    """One usable Gnosi route for an externally benchmarked model."""

    provider: str
    provider_name: str
    model_id: str
    model_name: str
    is_local: bool
    cost_in: float
    cost_out: float
    context_window: int
    quality: int
    tags: list[str]


class ModelComparisonEntry(BaseModel):
    """Normalized Artificial Analysis row enriched with Gnosi routes."""

    model_config = ConfigDict(extra="allow")

    id: str
    slug: str
    name: str
    creator: str
    release_date: str
    input_price: float | None
    output_price: float | None
    context_window: int | None
    speed: float | None
    latency: float | None
    intelligence: float | None
    coding: float | None
    agentic: float | None
    tags: list[str]
    modes: list[str]
    routes: list[ModelComparisonRoute]
    metric_sources: dict[str, str] | None = None
    profile: str


class ModelComparisonResponse(BaseModel):
    """Normalized external comparison feed with documented open version data.

    ``intelligence_index_version`` is intentionally ``JsonValue`` because the
    external provider owns that version marker and has emitted more than one
    JSON scalar representation. All model rows consumed by Gnosi stay typed.
    """

    model_config = ConfigDict(extra="allow")

    source: str
    source_url: str
    fetched_at: str
    intelligence_index_version: JsonValue
    count: int
    models: list[ModelComparisonEntry]
    currency: CurrencyInfoResponse
    fallback: bool | None = None
    fallback_reason: str | None = None
    stale: bool | None = None
    retry_at: str | None = None


class AiUsageModelResponse(BaseModel):
    """Token and spend totals for one provider/model pair."""

    provider: str
    model_id: str
    in_: int = Field(alias="in")
    out: int
    cost_usd: float
    cost_ccy: float

    model_config = ConfigDict(populate_by_name=True)


class AiUsageResponse(BaseModel):
    """Current-period AI spend and budget status."""

    period: str
    currency: CurrencyInfoResponse
    spent_usd: float
    spent_ccy: float
    cap_ccy: float | None
    cap_usd: float | None
    ratio: float | None
    over_cap: bool
    budget: dict[str, JsonValue]
    per_model: list[AiUsageModelResponse]


class AiUsageHistoryPeriodResponse(BaseModel):
    """Aggregated model usage for one historical billing period."""

    period: str
    total_usd: float
    total_ccy: float
    models: list[AiUsageModelResponse]


class AiUsageHistoryResponse(BaseModel):
    """All persisted AI usage periods in the configured currency."""

    currency: CurrencyInfoResponse
    periods: dict[str, AiUsageHistoryPeriodResponse]
