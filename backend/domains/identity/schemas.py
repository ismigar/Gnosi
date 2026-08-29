"""Public request and response contracts for the local identity profile."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class IdentityProfile(BaseModel):
    """Editable personal identity fields stored inside the active vault."""

    full_name: str | None = ""
    first_name: str | None = ""
    last_name: str | None = ""
    email: str | None = ""
    phone: str | None = ""
    address: str | None = ""
    city: str | None = ""
    zip_code: str | None = ""
    dni_nie: str | None = ""
    notes: str | None = ""


class IdentityReadResponse(IdentityProfile):
    """Stored profile, preserving additive fields written by older versions."""

    model_config = ConfigDict(extra="allow")


class IdentitySaveResponse(BaseModel):
    """Acknowledgement after atomically saving the profile."""

    status: str
