"""Explicit request contracts for the public Calendar API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class CalendarRequest(BaseModel):
    """Forward-compatible calendar request with explicitly modelled stable fields."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class MeetingReminderSettingsRequest(CalendarRequest):
    """Partial meeting-reminder settings update."""

    enabled: JsonValue | None = None
    lead_minutes: JsonValue | None = None


class CalendarEventCreateRequest(CalendarRequest):
    """Google Calendar event resource accepted by the create endpoint."""

    summary: JsonValue | None = None
    description: JsonValue | None = None
    location: JsonValue | None = None
    start: JsonValue | None = None
    end: JsonValue | None = None
    attendees: JsonValue | None = None
    recurrence: JsonValue | None = None
    reminders: JsonValue | None = None
    color_id: JsonValue | None = Field(None, alias="colorId")
    conference_data: JsonValue | None = Field(None, alias="conferenceData")


class CalendarEventPatchRequest(CalendarRequest):
    """Provider-neutral partial event update, including local Vault fields."""

    provider: JsonValue | None = None
    vault_path: JsonValue | None = None
    date: JsonValue | None = None
    end_date: JsonValue | None = None
    title: JsonValue | None = None
    location: JsonValue | None = None
    description: JsonValue | None = None
    all_day: JsonValue | None = None
    calendar_id: JsonValue | None = None
    summary: JsonValue | None = None
    start: JsonValue | None = None
    end: JsonValue | None = None
    attendees: JsonValue | None = None


class FreeBusyRequest(BaseModel):
    """Time interval and calendars queried through Google Free/Busy."""

    time_min: str
    time_max: str
    calendar_ids: list[str] | None = None
