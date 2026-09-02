"""Conservative local extraction of literal entities from mail content."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from urllib.parse import unquote

MAX_LOCAL_ENTITIES = 12

_EMAIL_PATTERN = r"[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,63}"
_NAMED_ADDRESS_RE = re.compile(
    rf"(?P<name>[^<>\r\n]{{2,100}}?)\s*<(?P<email>{_EMAIL_PATTERN})>",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(rf"^{_EMAIL_PATTERN}$", re.IGNORECASE)
_VEVENT_RE = re.compile(r"BEGIN:VEVENT\s*(.*?)\s*END:VEVENT", re.IGNORECASE | re.DOTALL)
_ICS_DATETIME_RE = re.compile(
    r"^(?P<date>\d{8})(?:T(?P<time>\d{4}(?:\d{2})?)(?P<utc>Z)?)?$"
)
_CONTACT_LABEL_RE = re.compile(
    r"^(?:contact|contacte|contacto|from|de|name|nom|nombre)\s*:\s*",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class LocalEntityAnalysis:
    events: list[dict[str, str]]
    contacts: list[dict[str, str]]

    @property
    def has_entities(self) -> bool:
        return bool(self.events or self.contacts)


class _MailTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.mailto_candidates: list[tuple[str, str]] = []
        self._mailto: str | None = None
        self._mailto_text: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag.casefold() in {"br", "div", "li", "p", "tr"}:
            self.text_parts.append("\n")
        if tag.casefold() != "a":
            return
        href = next((value for key, value in attrs if key.casefold() == "href"), None)
        if href and href.casefold().startswith("mailto:"):
            self._mailto = unquote(href[7:].split("?", 1)[0]).strip()
            self._mailto_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() == "a" and self._mailto is not None:
            self.mailto_candidates.append(
                ("".join(self._mailto_text).strip(), self._mailto)
            )
            self._mailto = None
            self._mailto_text = []
        if tag.casefold() in {"div", "li", "p", "tr"}:
            self.text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.text_parts.append(data)
        if self._mailto is not None:
            self._mailto_text.append(data)


def _bounded_text(value: str, max_chars: int) -> str:
    return " ".join(value.split())[:max_chars]


def _contact(name_value: str, email_value: str) -> dict[str, str] | None:
    address = email_value.strip().casefold()
    name = re.sub(r"<[^>]*>", " ", html.unescape(name_value))
    name = _CONTACT_LABEL_RE.sub("", _bounded_text(name, 100)).strip(" -–—:;,\"")
    if (
        not _EMAIL_RE.fullmatch(address)
        or not name
        or "@" in name
        or not any(character.isalpha() for character in name)
    ):
        return None
    return {
        "name": name[:80],
        "email": address,
        "phone": "",
        "company": "",
        "notes": "",
    }


def _extract_contacts(source: str, parser: _MailTextParser) -> list[dict[str, str]]:
    candidates = list(
        (match.group("name"), match.group("email"))
        for match in _NAMED_ADDRESS_RE.finditer(html.unescape(source))
    )
    candidates.extend(parser.mailto_candidates)
    contacts: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_name, raw_address in candidates:
        contact = _contact(raw_name, raw_address)
        if contact is None or contact["email"] in seen:
            continue
        contacts.append(contact)
        seen.add(contact["email"])
        if len(contacts) >= MAX_LOCAL_ENTITIES:
            break
    return contacts


def _unescape_ics(value: str, max_chars: int) -> str:
    return _bounded_text(
        value.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\"),
        max_chars,
    )


def _iso_ics_datetime(value: str) -> str:
    candidate = value.strip()
    match = _ICS_DATETIME_RE.fullmatch(candidate)
    if match is None:
        return ""
    raw_date = match.group("date")
    try:
        date_value = datetime.strptime(raw_date, "%Y%m%d").date().isoformat()
    except ValueError:
        return ""
    raw_time = match.group("time")
    if raw_time is None:
        return date_value
    time_format = "%H%M%S" if len(raw_time) == 6 else "%H%M"
    try:
        time_value = datetime.strptime(raw_time, time_format).time()
    except ValueError:
        return ""
    seconds = raw_time[4:6] if len(raw_time) == 6 else "00"
    suffix = "Z" if match.group("utc") else ""
    return f"{date_value}T{time_value.hour:02d}:{time_value.minute:02d}:{seconds}{suffix}"


def _event(block: str) -> dict[str, str] | None:
    unfolded = re.sub(r"\r?\n[ \t]", "", block)
    fields: dict[str, str] = {}
    for line in unfolded.splitlines():
        if ":" not in line:
            continue
        raw_key, raw_value = line.split(":", 1)
        key = raw_key.split(";", 1)[0].strip().upper()
        if key in {"SUMMARY", "DTSTART", "DTEND", "LOCATION", "DESCRIPTION"}:
            fields.setdefault(key, raw_value.strip())
    title = _unescape_ics(fields.get("SUMMARY", ""), 200)
    start = _iso_ics_datetime(fields.get("DTSTART", ""))
    if not title or not start:
        return None
    return {
        "title": title,
        "start": start,
        "end": _iso_ics_datetime(fields.get("DTEND", "")),
        "location": _unescape_ics(fields.get("LOCATION", ""), 200),
        "description": _unescape_ics(fields.get("DESCRIPTION", ""), 500),
    }


def _extract_events(text: str) -> list[dict[str, str]]:
    events: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for block in _VEVENT_RE.findall(text):
        event = _event(block)
        if event is None:
            continue
        identity = (event["title"].casefold(), event["start"])
        if identity in seen:
            continue
        events.append(event)
        seen.add(identity)
        if len(events) >= MAX_LOCAL_ENTITIES:
            break
    return events


def extract_local_entities(context: str) -> LocalEntityAnalysis:
    """Extract only explicitly named contacts and complete VEVENT records."""
    source = context[:100_000]
    parser = _MailTextParser()
    try:
        parser.feed(source)
        parser.close()
    except (AssertionError, ValueError):
        parser = _MailTextParser()
        parser.text_parts.append(source)
    visible_text = html.unescape("".join(parser.text_parts))
    return LocalEntityAnalysis(
        events=_extract_events(visible_text),
        contacts=_extract_contacts(source, parser),
    )
