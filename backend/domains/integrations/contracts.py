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


class EmailConnectionTestRequest(BaseModel):
    imap_server: str | None = None
    imap_host: str | None = None
    imap_port: int | str | None = None
    imap_encryption: str = "ssl"
    smtp_server: str | None = None
    smtp_host: str | None = None
    smtp_port: int | str | None = None
    smtp_encryption: str = "ssl"
    username: str | None = None
    password: str | None = None


class DavConnectionTestRequest(BaseModel):
    url: str | None = None
    username: str | None = None
    password: str | None = None


class IntegrationConnectionTestResponse(BaseModel):
    success: bool
    error: str | None = None
    imap: bool | None = None
    smtp: bool | None = None


__all__ = [
    "CalendarSelectionRequest",
    "DavConnectionTestRequest",
    "DefaultAccountRequest",
    "DefaultCalendarRequest",
    "EmailConnectionTestRequest",
    "IntegrationConnectionTestResponse",
    "IntegrationsDocument",
    "IntegrationUpdateResponse",
    "IntegrationsUpdateRequest",
]
