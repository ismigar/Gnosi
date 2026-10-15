"""Preserve calendar user addresses and scheduling parameters on editor saves."""

from __future__ import annotations

import re
from typing import Any

from icalendar import vCalAddress, vText

from backend.domains.calendar.provider_errors import CalendarProviderError

_SCHEME = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*):(.*)$", re.DOTALL)


def display_address(value: object) -> str:
    address = str(value)
    return address[7:] if address[:7].lower() == "mailto:" else address


def _identity(value: str) -> str:
    match = _SCHEME.match(value)
    if match and match[1].lower() != "mailto":
        # URI paths/opaque identifiers can be case sensitive. Only the scheme
        # is universally case insensitive (RFC 3986 3.1).
        return match[1].lower() + ":" + match[2]
    mailbox = display_address(value)
    local, separator, domain = mailbox.rpartition("@")
    return "mailto:" + (local + separator + domain.lower() if separator else mailbox)


def patch_attendees(event: Any, value: object) -> None:
    if not isinstance(value, list):
        raise CalendarProviderError(422, "Invalid calendar attendees")
    existing = event.get("ATTENDEE", [])
    existing = existing if isinstance(existing, list) else [existing]
    previous: dict[str, list[Any]] = {}
    for attendee in existing:
        previous.setdefault(_identity(str(attendee)), []).append(attendee)
    updated = []
    for person in value:
        if not isinstance(person, dict) or not isinstance(person.get("email"), str):
            raise CalendarProviderError(422, "Invalid calendar attendee")
        address = person["email"]
        matches = previous.get(_identity(address), [])
        if matches:
            attendee = matches.pop(0)
        else:
            email = display_address(address)
            if (
                any(char.isspace() or ord(char) < 32 for char in email)
                or "@" not in email
                or ":" in email
            ):
                raise CalendarProviderError(422, "Only email attendees can be added in the editor")
            attendee = vCalAddress("mailto:" + email)
        name = person.get("displayName", person.get("name"))
        if name and str(attendee.params.get("CN", "")) != str(name):
            attendee.params["CN"] = vText(str(name))
        updated.append(attendee)
    event.pop("ATTENDEE", None)
    for attendee in updated:
        event.add("ATTENDEE", attendee)
