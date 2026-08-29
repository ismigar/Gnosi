"""Public contracts for masked, provider-neutral integration settings."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, JsonValue, RootModel


class IntegrationsDocument(RootModel[dict[str, JsonValue]]):
    """Extensible integration configuration with all credentials masked."""


class IntegrationsUpdateRequest(RootModel[dict[str, JsonValue]]):
    """Provider-neutral partial or bulk integration settings update."""


class CalendarSelectionRequest(RootModel[list[str] | dict[str, list[str]]]):
    """Legacy calendar selection accepted as a list or wrapped object."""


class DefaultCalendarRequest(BaseModel):
    source: str = ""


class DefaultAccountRequest(BaseModel):
    email: str = ""


class IntegrationUpdateResponse(BaseModel):
    status: Literal["success"]
    message: str | None = None


__all__ = [
    "CalendarSelectionRequest",
    "DefaultAccountRequest",
    "DefaultCalendarRequest",
    "IntegrationsDocument",
    "IntegrationUpdateResponse",
    "IntegrationsUpdateRequest",
]
