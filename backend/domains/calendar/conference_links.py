"""Normalize provider conference links without exposing executable URL schemes."""

from typing import Any
from urllib.parse import urlsplit


def safe_join_url(value: object) -> str:
    if not isinstance(value, str) or "\\" in value or any(ord(char) < 32 for char in value):
        return ""
    try:
        parsed = urlsplit(value.strip())
        if (
            parsed.scheme.lower() in {"https", "http"}
            and parsed.hostname
            and not parsed.username
            and not parsed.password
        ):
            return value.strip()
    except ValueError:
        pass
    return ""


def google_join_url(event: dict[str, Any]) -> str:
    conference = event.get("conferenceData")
    if isinstance(conference, dict):
        entries = conference.get("entryPoints")
        for entry in entries if isinstance(entries, list) else []:
            if isinstance(entry, dict) and entry.get("entryPointType") == "video":
                link = safe_join_url(entry.get("uri"))
                if link:
                    return link
    return safe_join_url(event.get("hangoutLink"))


def caldav_join_url(component: Any) -> str:
    conferences = component.get("CONFERENCE", [])
    if not isinstance(conferences, list):
        conferences = [conferences]
    for value in [*conferences, component.get("URL")]:
        link = safe_join_url(str(value)) if value is not None else ""
        if link:
            return link
    return ""
