"""Bounded public and private contracts for table forms."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

FieldKind = Literal["title", "text", "number", "date", "select", "multi_select", "checkbox", "email", "url", "phone", "status"]


class FormFieldChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ref: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=200)
    help: str = Field(default="", max_length=1000)
    required: bool = False


class FormCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    table_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    fields: list[FormFieldChoice] = Field(min_length=1, max_length=40)
    expires_in_days: int = Field(default=30, ge=1, le=365)

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A title is required")
        return value.strip()


class PublicFormField(BaseModel):
    key: str
    label: str
    help: str = ""
    kind: FieldKind
    required: bool
    options: list[str] = Field(default_factory=list)


class StoredFormField(PublicFormField):
    ref: str


class FormFieldCandidate(BaseModel):
    ref: str
    label: str
    kind: FieldKind
    options: list[str] = Field(default_factory=list)


class FormCandidatesResponse(BaseModel):
    fields: list[FormFieldCandidate]


class PublicFormResponse(BaseModel):
    title: str
    description: str
    fields: list[PublicFormField]


class FormResponse(PublicFormResponse):
    id: str
    table_id: str
    url: str
    expires_at: datetime | None
    revoked: bool
    created_at: datetime


class FormListResponse(BaseModel):
    forms: list[FormResponse]


class FormRevokedResponse(BaseModel):
    status: Literal["revoked"] = "revoked"


class FormSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{16,100}$")
    values: dict[str, JsonValue]
    website: str = Field(default="", max_length=500)


class FormSubmissionResponse(BaseModel):
    status: Literal["accepted"] = "accepted"
