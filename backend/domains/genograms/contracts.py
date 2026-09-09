"""Versioned genogram HTTP and saved-view contracts."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


class GenogramPosition(BaseModel):
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)


class GenogramConfig(BaseModel):
    version: Literal[1] = 1
    root_id: str = ""
    ancestors: int = Field(default=2, ge=0, le=20)
    descendants: int = Field(default=1, ge=0, le=20)
    include_ids: list[str] = Field(default_factory=list)
    exclude_ids: list[str] = Field(default_factory=list)
    emotional: bool = True
    legend: bool = True
    age: bool = True
    dates: bool = False
    labels: Literal["name", "initials", "alias"] = "name"
    positions: dict[str, GenogramPosition] = Field(default_factory=dict)


class GenogramPerson(BaseModel):
    id: str
    title: str
    alias: str = ""
    kind: str = "person"
    symbol: str = "neutral"
    gender: str = ""
    birth_date: str = ""
    death_date: str = ""
    birth_approximate: bool = False
    death_approximate: bool = False
    vital_status: str = "unknown"
    pregnancy_status: str = "ongoing"
    pregnancy_date: str = ""
    pregnancy_weeks: float | None = None
    multiple_group: str = ""
    multiple_type: str = "unknown"
    birth_order: float | None = None
    notes: str = ""
    tags: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    etag: str = ""


class GenogramRelation(BaseModel):
    id: str
    title: str = ""
    kind: str = "union"
    source: str = ""
    target: str = ""
    union_type: str = "partnership"
    union_status: str = "unknown"
    parentage: str = "unknown"
    emotion: str = "close"
    union_id: str = ""
    start_date: str = ""
    separation_date: str = ""
    divorce_date: str = ""
    end_date: str = ""
    observed_date: str = ""
    informant: str = ""
    notes: str = ""
    sources: list[str] = Field(default_factory=list)
    etag: str = ""


class GenogramIssue(BaseModel):
    code: str
    record_id: str
    field: str = ""
    severity: Literal["error", "warning"] = "error"


class GenogramSetupRequest(BaseModel):
    locale: Literal["ca", "en", "es", "fr"] = "en"


class GenogramSetupResponse(BaseModel):
    database_id: str
    people_table_id: str
    relations_table_id: str
    view_id: str


class GenogramSetupStatus(BaseModel):
    ready: bool


class GenogramGraphRequest(BaseModel):
    table_id: str
    view_id: str | None = None
    config: GenogramConfig | None = None
    eligible_ids: list[str] | None = None


class GenogramGraphResponse(GenogramSetupResponse):
    people: list[GenogramPerson]
    relations: list[GenogramRelation]
    visible_ids: list[str]
    hidden_connections: int
    issues: list[GenogramIssue]
    config: GenogramConfig
    people_fields: dict[str, str]
    relations_fields: dict[str, str]
