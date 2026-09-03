"""Conservative local extraction of literal entities from mail content."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime
from email.utils import getaddresses
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
_KNOWN_HTML_TAG_RE = re.compile(
    r"</?(?:a|blockquote|body|br|div|head|html|img|li|ol|p|script|span|style|table|td|tr|ul)\b",
    re.IGNORECASE,
)
_EXPLICIT_TASK_RE = re.compile(
    r"^\s*(?:[-*]\s*\[\s\]|TODO|TO\s+DO|PENDENT|PENDIENTE|TASK|TASCA)"
    r"\s*[:\-–—]?\s*(?P<task>.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class LocalEvidence:
    kind: str
    label: str
    value: str
    origin: str
    confidence: float = 1.0

    def as_dict(self) -> dict[str, str | float]:
        return {
            "kind": self.kind,
            "label": self.label,
            "value": self.value,
            "origin": self.origin,
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class LocalAnalysisReport:
    summary: LocalEvidence | None
    participants: list[LocalEvidence]
    attachments: list[LocalEvidence]
    indicators: list[LocalEvidence]
    tasks: list[LocalEvidence]
    dates: list[LocalEvidence]

    @property
    def has_evidence(self) -> bool:
        return self.summary is not None or any(
            (self.participants, self.attachments, self.indicators, self.tasks, self.dates)
        )

    def as_dict(self) -> dict[str, object]:
        return {
            "summary": self.summary.as_dict() if self.summary else None,
            "participants": [item.as_dict() for item in self.participants],
            "attachments": [item.as_dict() for item in self.attachments],
            "indicators": [item.as_dict() for item in self.indicators],
            "tasks": [item.as_dict() for item in self.tasks],
            "dates": [item.as_dict() for item in self.dates],
        }


@dataclass(frozen=True)
class LocalEntityAnalysis:
    events: list[dict[str, str]]
    contacts: list[dict[str, str]]
    report: LocalAnalysisReport

    @property
    def has_entities(self) -> bool:
        return bool(self.events or self.contacts)

    @property
    def has_evidence(self) -> bool:
        return self.has_entities or self.report.has_evidence


class _MailTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.mailto_candidates: list[tuple[str, str]] = []
        self._mailto: str | None = None
        self._mailto_text: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        normalized_tag = tag.casefold()
        if normalized_tag in {"head", "noscript", "script", "style", "template"}:
            self._ignored_depth += 1
            return
        if self._ignored_depth:
            return
        if normalized_tag in {"br", "div", "li", "p", "tr"}:
            self.text_parts.append("\n")
        if normalized_tag != "a":
            return
        href = next((value for key, value in attrs if key.casefold() == "href"), None)
        if href and href.casefold().startswith("mailto:"):
            self._mailto = unquote(href[7:].split("?", 1)[0]).strip()
            self._mailto_text = []

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.casefold()
        if normalized_tag in {"head", "noscript", "script", "style", "template"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)
            return
        if self._ignored_depth:
            return
        if normalized_tag == "a" and self._mailto is not None:
            self.mailto_candidates.append(
                ("".join(self._mailto_text).strip(), self._mailto)
            )
            self._mailto = None
            self._mailto_text = []
        if normalized_tag in {"div", "li", "p", "tr"}:
            self.text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._ignored_depth:
            return
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


def _visible_text(source: str, parser: _MailTextParser) -> str:
    if _KNOWN_HTML_TAG_RE.search(source):
        return html.unescape("".join(parser.text_parts))
    return html.unescape(source)


def _summary(text: str) -> LocalEvidence | None:
    value = _bounded_text(_VEVENT_RE.sub(" ", text), 2_000)
    if not value:
        return None
    if len(value) > 320:
        boundary = value[:320].rsplit(" ", 1)[0].rstrip(" ,;:-")
        value = f"{boundary or value[:320]}…"
    return LocalEvidence("summary", "extractive_summary", value, "message_body")


def _participants(sender: str, recipients: tuple[str, ...]) -> list[LocalEvidence]:
    evidence: list[LocalEvidence] = []
    seen: set[tuple[str, str]] = set()
    for role, values in (("sender", (sender,)), ("recipient", recipients)):
        for name, address in getaddresses(values):
            normalized_address = address.strip().casefold()
            if not _EMAIL_RE.fullmatch(normalized_address):
                continue
            normalized_name = _bounded_text(name, 100)
            display = (
                f"{normalized_name} <{normalized_address}>"
                if normalized_name
                else normalized_address
            )
            identity = (role, normalized_address)
            if identity in seen:
                continue
            evidence.append(
                LocalEvidence("participant", role, display, "message_header")
            )
            seen.add(identity)
            if len(evidence) >= MAX_LOCAL_ENTITIES:
                return evidence
    return evidence


def _attachments(filenames: tuple[str, ...]) -> list[LocalEvidence]:
    evidence: list[LocalEvidence] = []
    seen: set[str] = set()
    for raw_name in filenames:
        filename = _bounded_text(raw_name.replace("\\", "/").rsplit("/", 1)[-1], 180)
        if not filename or filename.casefold() in seen:
            continue
        evidence.append(
            LocalEvidence("attachment", "attachment", filename, "attachment_metadata")
        )
        seen.add(filename.casefold())
        if len(evidence) >= MAX_LOCAL_ENTITIES:
            break
    return evidence


def _tasks(text: str) -> list[LocalEvidence]:
    evidence: list[LocalEvidence] = []
    seen: set[str] = set()
    for match in _EXPLICIT_TASK_RE.finditer(_VEVENT_RE.sub("", text)):
        task = _bounded_text(match.group("task"), 240)
        if not task or task.casefold() in seen:
            continue
        evidence.append(LocalEvidence("task", "explicit_task", task, "message_body"))
        seen.add(task.casefold())
        if len(evidence) >= MAX_LOCAL_ENTITIES:
            break
    return evidence


def _event_dates(events: list[dict[str, str]]) -> list[LocalEvidence]:
    return [
        LocalEvidence("date", event["title"], event["start"], "vevent")
        for event in events
    ]


def _indicators(
    attachment_items: list[LocalEvidence],
    task_items: list[LocalEvidence],
    events: list[dict[str, str]],
) -> list[LocalEvidence]:
    return [
        LocalEvidence("indicator", label, str(count), "message_metadata")
        for label, count in (
            ("attachment_count", len(attachment_items)),
            ("explicit_task_count", len(task_items)),
            ("explicit_event_count", len(events)),
        )
        if count
    ]


def extract_local_entities(
    context: str,
    *,
    sender: str = "",
    recipients: tuple[str, ...] = (),
    attachments: tuple[str, ...] = (),
) -> LocalEntityAnalysis:
    """Extract only bounded literal evidence; never interpret implicit prose."""
    source = context[:100_000]
    parser = _MailTextParser()
    try:
        parser.feed(source)
        parser.close()
    except (AssertionError, ValueError):
        parser = _MailTextParser()
        parser.text_parts.append(source)
    visible_text = _visible_text(source, parser)
    events = _extract_events(visible_text)
    attachment_items = _attachments(attachments)
    task_items = _tasks(visible_text)
    return LocalEntityAnalysis(
        events=events,
        contacts=_extract_contacts(source, parser),
        report=LocalAnalysisReport(
            summary=_summary(visible_text),
            participants=_participants(sender, recipients),
            attachments=attachment_items,
            indicators=_indicators(attachment_items, task_items, events),
            tasks=task_items,
            dates=_event_dates(events),
        ),
    )
