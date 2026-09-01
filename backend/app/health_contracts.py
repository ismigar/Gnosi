"""Typed response contracts for liveness and Google OAuth diagnostics."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Public liveness and deployment-mode payload."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    mode: Literal["FastAPI"]
    gnosi_mode: str
    require_auth: bool
    vault_configured: bool


class GoogleOAuthStatusResponse(BaseModel):
    """Minimal Google OAuth configuration status exposed to the UI."""

    model_config = ConfigDict(extra="forbid")

    configured: bool
    client_id: str | None


GoogleOAuthAppStatus = Literal["testing-likely", "healthy", "unknown"]
GoogleOAuthScope = Literal[
    "https://www.googleapis.com/auth/calendar",
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/contacts",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]


class GoogleOAuthHealthResponse(BaseModel):
    """Google OAuth configuration and connected-account diagnostics."""

    model_config = ConfigDict(extra="forbid")

    configured: bool
    client_id_present: bool
    scopes: list[GoogleOAuthScope]
    google_accounts_total: int = Field(ge=0)
    google_accounts_with_refresh_token: int = Field(ge=0)
    google_accounts_recently_failed: int = Field(ge=0)
    app_status: GoogleOAuthAppStatus
    hint: str
    publish_guide: Literal["/docs/dev_memory/directives/publish_google_app.md"]
