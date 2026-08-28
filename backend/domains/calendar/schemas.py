"""Pydantic contracts for the public Calendar API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class CalendarProviderPayload(BaseModel):
    """Provider payload with typed stable fields and retained provider extensions."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class CalendarListItemResponse(CalendarProviderPayload):
    """One Google Calendar or CalDAV calendar available to an account."""

    id: str
    name: str
    color: str | None = None
    account: str
    provider: str
    access_role: str | None = None
    primary: bool | None = None
    url: str | None = None


class CalendarAttendeeResponse(CalendarProviderPayload):
    """Normalized attendee attached to a calendar event or reminder."""

    email: str = ""
    name: str = ""
    rsvp: str = "needsAction"
    self: bool = False
    organizer: bool = False


class CalendarEventResponse(CalendarProviderPayload):
    """Provider-neutral event returned by event queries."""

    id: str
    calendar_id: str
    calendar_name: str = ""
    title: str
    start: str
    end: str = ""
    all_day: bool = False
    location: str = ""
    description: str = ""
    source: str = ""
    account: str = ""
    provider: str
    color: str | None = None
    status: str = "confirmed"
    link: str = ""
    recurrence: JsonValue | None = None
    recurring_event_id: str | None = None
    is_read_only: bool = False
    event_type: str | None = None
    birthday_properties: JsonValue | None = None
    attendees: list[CalendarAttendeeResponse] | None = None
    organizer: str | None = None
    vault_path: str | None = None


class GoogleEventTimeResponse(CalendarProviderPayload):
    """Google event date or date-time envelope."""

    date: str | None = None
    date_time: str | None = Field(None, alias="dateTime")
    time_zone: str | None = Field(None, alias="timeZone")


class GoogleEventPersonResponse(CalendarProviderPayload):
    """Google event creator or organizer."""

    email: str | None = None
    display_name: str | None = Field(None, alias="displayName")
    self: bool | None = None


class GoogleEventAttendeeResponse(GoogleEventPersonResponse):
    """Google event attendee with invitation state."""

    response_status: str | None = Field(None, alias="responseStatus")
    organizer: bool | None = None
    optional: bool | None = None
    resource: bool | None = None
    comment: str | None = None
    additional_guests: int | None = Field(None, alias="additionalGuests")


class GoogleEventResourceResponse(CalendarProviderPayload):
    """Google event resource returned after creation.

    Google can add feature-specific objects over time. Stable fields remain
    typed while ``extra="allow"`` preserves such provider additions verbatim.
    """

    kind: str | None = None
    etag: str | None = None
    id: str | None = None
    status: str | None = None
    html_link: str | None = Field(None, alias="htmlLink")
    created: str | None = None
    updated: str | None = None
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    color_id: str | None = Field(None, alias="colorId")
    creator: GoogleEventPersonResponse | None = None
    organizer: GoogleEventPersonResponse | None = None
    start: GoogleEventTimeResponse | None = None
    end: GoogleEventTimeResponse | None = None
    end_time_unspecified: bool | None = Field(None, alias="endTimeUnspecified")
    recurrence: list[str] | None = None
    recurring_event_id: str | None = Field(None, alias="recurringEventId")
    original_start_time: GoogleEventTimeResponse | None = Field(
        None, alias="originalStartTime"
    )
    transparency: str | None = None
    visibility: str | None = None
    i_cal_uid: str | None = Field(None, alias="iCalUID")
    sequence: int | None = None
    attendees: list[GoogleEventAttendeeResponse] | None = None
    attendees_omitted: bool | None = Field(None, alias="attendeesOmitted")
    extended_properties: JsonValue | None = Field(None, alias="extendedProperties")
    hangout_link: str | None = Field(None, alias="hangoutLink")
    conference_data: JsonValue | None = Field(None, alias="conferenceData")
    event_type: str | None = Field(None, alias="eventType")


class MeetingReminderResponse(CalendarProviderPayload):
    """Persisted reminder; every field is optional for legacy state files."""

    id: str | None = None
    key: str | None = None
    title: str | None = None
    start: str | None = None
    end: str | None = None
    location: str | None = None
    attendees: list[CalendarAttendeeResponse] | None = None
    agenda: str | None = None
    provider: str | None = None
    vault_path: str | None = None
    minutes_until: int | None = None
    dismissed: bool | None = None
    created_at: str | None = None


class MeetingRemindersResponse(BaseModel):
    reminders: list[MeetingReminderResponse]


class MeetingReminderSettingsResponse(CalendarProviderPayload):
    enabled: bool
    lead_minutes: int


class CalendarStatusResponse(BaseModel):
    status: Literal["success", "not_found"]


class CalendarStatusMessageResponse(BaseModel):
    status: Literal["success"]
    message: str


class CalendarSyncResponse(BaseModel):
    status: Literal["success"]
    synced_count: int
    message: str


class FreeBusyPeriodResponse(CalendarProviderPayload):
    start: str
    end: str


class GoogleApiErrorResponse(CalendarProviderPayload):
    domain: str | None = None
    reason: str | None = None


class FreeBusyCalendarResponse(CalendarProviderPayload):
    errors: list[GoogleApiErrorResponse] | None = None
    busy: list[FreeBusyPeriodResponse] | None = None


class FreeBusyGroupResponse(CalendarProviderPayload):
    errors: list[GoogleApiErrorResponse] | None = None
    calendars: list[str] | None = None


class FreeBusyResponse(CalendarProviderPayload):
    """Google free/busy response, including the legacy empty-object variant."""

    kind: str | None = None
    time_min: str | None = Field(None, alias="timeMin")
    time_max: str | None = Field(None, alias="timeMax")
    groups: dict[str, FreeBusyGroupResponse] | None = None
    calendars: dict[str, FreeBusyCalendarResponse] | None = None


class CalendarAttendeeSearchResponse(BaseModel):
    email: str
    name: str


class CalendarGeocodeResponse(BaseModel):
    label: str
    lat: int | float
    lon: int | float


class CalendarRsvpRequest(CalendarProviderPayload):
    """RSVP body with optional fields so legacy validation remains HTTP 400."""

    email: str | None = None
    calendar_id: str = "primary"
    rsvp: str | None = None


class CalendarRsvpResponse(BaseModel):
    ok: Literal[True]
    rsvp: str


class CalendarInviteAttendeeRequest(CalendarProviderPayload):
    email: str = ""
    name: str = ""


class CalendarInviteEventDataRequest(CalendarProviderPayload):
    title: str = "Cita"
    date: str = ""
    location: str = ""
    description: str = ""


class CalendarInviteRequest(CalendarProviderPayload):
    """Invitation body shared by Google and local Vault events."""

    email: str | None = None
    attendees: list[CalendarInviteAttendeeRequest] = Field(default_factory=list)
    calendar_id: str = "primary"
    is_vault: bool = False
    event_data: CalendarInviteEventDataRequest = Field(
        default_factory=CalendarInviteEventDataRequest
    )


class CalendarInviteResponse(BaseModel):
    """Invitation result; Google keeps the short ``{"ok": true}`` variant."""

    ok: bool
    failed: list[str] | None = None
    sent: int | None = None
