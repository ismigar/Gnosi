"""Public contracts for the application configuration document."""

from __future__ import annotations

from pydantic import BaseModel, JsonValue, RootModel


class ConfigurationDocument(RootModel[dict[str, JsonValue]]):
    """Sanitized, JSON-compatible settings returned to the frontend."""


class InterfaceSettings(BaseModel):
    """Display preferences needed before rendering, without credential checks."""

    language: str = "en"
    currency: str = "EUR"
    date_format: str = "locale"
    decimal_symbol: str = ","


class ConfigurationUpdateRequest(RootModel[JsonValue]):
    """Partial settings payload with legacy runtime validation semantics."""


class ConfigurationUpdateResponse(BaseModel):
    """Acknowledgement after atomically persisting configuration."""

    status: str
    message: str
