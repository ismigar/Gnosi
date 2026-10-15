"""Bounded contracts for public scheduling; no provider event details escape."""

from datetime import date, datetime, time
import re
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class BookingCalendar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["google", "caldav", "vault"]
    account: str = Field(default="", max_length=320)
    calendar_id: str = Field(min_length=1, max_length=2048)

    @model_validator(mode="after")
    def validate_identity(self) -> "BookingCalendar":
        if self.provider == "vault":
            if self.account or self.calendar_id != "gnosi":
                raise ValueError("The local calendar must be gnosi without an account")
        elif not self.account.strip():
            raise ValueError("An external calendar requires an account")
        return self


class BookingSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    calendars: list[BookingCalendar] = Field(min_length=1, max_length=20)
    timezone: str = Field(min_length=1, max_length=100)
    weekdays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4], min_length=1, max_length=7)
    working_start: str = "09:00"
    working_end: str = "18:00"
    duration_minutes: int = Field(default=30, ge=5, le=480)
    buffer_minutes: int = Field(default=0, ge=0, le=180)
    notice_minutes: int = Field(default=60, ge=0, le=20160)
    horizon_days: int = Field(default=30, ge=1, le=90)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ValueError("Unknown timezone") from exc
        return value

    @field_validator("working_start", "working_end")
    @classmethod
    def valid_time(cls, value: str) -> str:
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("Time must use HH:MM")
        return value

    @field_validator("weekdays")
    @classmethod
    def valid_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value) or len(set(value)) != len(value):
            raise ValueError("Weekdays must be unique values between 0 and 6")
        return sorted(value)

    @model_validator(mode="after")
    def valid_schedule(self) -> "BookingSchedule":
        start, end = time.fromisoformat(self.working_start), time.fromisoformat(self.working_end)
        if start >= end:
            raise ValueError("Working hours must end after they start on the same day")
        identities = {(item.provider, item.account, item.calendar_id) for item in self.calendars}
        if len(identities) != len(self.calendars):
            raise ValueError("Each calendar must be selected only once")
        return self


class BookingAvailabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    schedule: BookingSchedule


class BookingLinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=160)
    schedule: BookingSchedule
    destination: BookingCalendar
    expires_days: int = Field(default=30, ge=1, le=90)

    @model_validator(mode="after")
    def destination_selected(self) -> "BookingLinkCreate":
        if self.destination not in self.schedule.calendars:
            raise ValueError("The destination must be included in availability")
        if not self.title.strip():
            raise ValueError("Title cannot be blank")
        return self


class BookingSlot(BaseModel):
    start: datetime
    end: datetime


class BookingSlotsResponse(BaseModel):
    timezone: str
    date: date
    slots: list[BookingSlot]


class BookingLinkResponse(BaseModel):
    id: str
    token: str
    title: str
    schedule: BookingSchedule
    destination: BookingCalendar
    expires_at: datetime
    revoked: bool
    pending_reservations: int = 0


class BookingPublicInfo(BaseModel):
    title: str
    timezone: str
    duration_minutes: int
    first_date: date
    last_date: date


class BookingReservationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: AwareDatetime
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    idempotency_key: str = Field(min_length=16, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(character) < 32 for character in value):
            raise ValueError("Invalid name")
        return value

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", value):
            raise ValueError("Invalid email address")
        return value


class BookingReservationResponse(BaseModel):
    id: str
    status: Literal["confirmed", "pending", "failed"]
    start: datetime
    end: datetime


class BookingRevocationResponse(BaseModel):
    revoked: bool
