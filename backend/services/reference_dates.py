"""Bibliographic dates preserve precision and unparsed literals without guessing."""
from __future__ import annotations

import calendar
import re
from typing import Any, Mapping

from backend.services.reference_catalog import REFERENCE_DATE_SOURCES


def csl_date(value: object) -> dict[str, Any] | None:
    if isinstance(value, dict):
        value = value.get("start") or value.get("date") or ""
    raw = str(value or "").strip()
    if not raw:
        return None
    months = "january february march april may june july august september october november december".split()
    year_first = re.fullmatch(r"(\d{4})\s+([A-Za-z]+)(?:\s+(\d{1,2}))?", raw)
    if year_first:
        year, month_name, day = year_first.groups()
        raw = f"{month_name} {day or ''} {year}".replace("  ", " ")
    named = re.fullmatch(r"(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})", raw)
    if named:
        day_before, month_name, day_after, year = named.groups()
        month = next((i for i, name in enumerate(months, 1) if month_name.lower() in (name, name[:3])), None)
        if month and not (day_before and day_after):
            raw = f"{year}-{month:02}" + (f"-{int(day_before or day_after):02}" if day_before or day_after else "")
    match = re.fullmatch(r"(-?\d{1,4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?(?:[T ][0-9:Z.+-]+)?/?", raw)
    if not match:
        return {"literal": raw}
    parts = [int(part) for part in match.groups() if part is not None]
    if len(parts) > 1 and not 1 <= parts[1] <= 12:
        return {"literal": raw}
    if len(parts) > 2 and not 1 <= parts[2] <= calendar.monthrange(parts[0], parts[1])[1]:
        return {"literal": raw}
    return {"date-parts": [parts]}


def import_date(value: object) -> dict[str, Any]:
    parsed = csl_date(value)
    if not parsed:
        return {}
    parts = parsed.get("date-parts", [[]])[0]
    if parts:
        return dict(zip(("Any", "Mes", "Dia"), parts))
    return {}


def issued_date(metadata: Mapping[str, Any]) -> dict[str, Any] | None:
    extras = metadata.get("Zotero Extras")
    raw = next((extras[field] for field in REFERENCE_DATE_SOURCES["issued"] if extras.get(field)), None) if isinstance(extras, dict) else None
    if metadata.get("Data de publicació"):
        return csl_date(metadata["Data de publicació"])
    year = metadata.get("Any")
    if year in (None, ""):
        return csl_date(raw)
    parsed = csl_date(year)
    if not parsed or "date-parts" not in parsed:
        return parsed
    parts = parsed["date-parts"][0]
    for index, field in enumerate(("Mes", "Dia"), 1):
        val = metadata.get(field)
        if val in (None, ""):
            break
        if not re.fullmatch(r"\d{1,2}", str(val)):
            break
        if len(parts) > index:
            parts[index] = int(val)
        else:
            parts.append(int(val))
    candidate = "-".join(str(p) if index == 0 else f"{p:02}" for index, p in enumerate(parts))
    return csl_date(candidate)


def date_text(value: dict[str, Any] | None) -> str:
    if not value:
        return ""
    if value.get("literal"):
        return str(value["literal"])
    return "-".join(str(p) if i == 0 else f"{p:02}" for i, p in enumerate(value["date-parts"][0]))
