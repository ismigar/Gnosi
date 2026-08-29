"""Public request and response contracts for local environment settings."""

from __future__ import annotations

from pydantic import BaseModel, JsonValue, RootModel


class EnvironmentResponse(RootModel[dict[str, str]]):
    """Masked repository-local environment values."""


class EnvironmentUpdateRequest(RootModel[JsonValue]):
    """JSON update retained as a root value for legacy 400 validation semantics."""


class EnvironmentUpdateResponse(BaseModel):
    """Acknowledgement after routing settings and credentials to storage."""

    status: str
    message: str
    secure_updates: int
