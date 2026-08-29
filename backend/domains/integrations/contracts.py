"""Public contracts for masked, provider-neutral integration settings."""

from __future__ import annotations

from pydantic import JsonValue, RootModel


class IntegrationsDocument(RootModel[dict[str, JsonValue]]):
    """Extensible integration configuration with all credentials masked."""


__all__ = ["IntegrationsDocument"]
