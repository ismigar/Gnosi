"""Lossless bibliographic Zotero → Resources conversion with explicit creator roles."""
from __future__ import annotations

from typing import Any
import re

from backend.services.reference_catalog import REFERENCE_DATE_SOURCES, REFERENCE_ZOTERO_FIELDS, ZOTERO_CREATOR_COLUMNS
from backend.services.reference_dates import import_date
from backend.services.reference_names import text_names, zotero_name

# Library bookkeeping is not bibliographic metadata. accessDate is bibliographic.
_TECHNICAL_FIELDS = {"key", "version", "tags", "relations", "notes", "attachments", "dateAdded", "dateModified", "collections"}


def _copy_creators(item: dict[str, Any], output: dict[str, Any], consumed: set[str]) -> list[Any]:
    creators = item.get("creators")
    unknown = []
    columns = ZOTERO_CREATOR_COLUMNS.get(str(item.get("itemType") or ""), {"author": "Autoría", "editor": "Editors", "translator": "Traductors"})
    if isinstance(creators, list):
        for person in creators:
            if not isinstance(person, dict):
                unknown.append(person)
                continue
            creator_column = columns.get(person.get("creatorType") or "author")
            if not creator_column:
                unknown.append(person)
                continue
            name = zotero_name(person)
            if any(name.values()):
                output.setdefault(creator_column, []).append(name)
        consumed.add("creators")
    return unknown


def zotero_item_to_recursos(item: object) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {}
    output: dict[str, Any] = {}
    consumed: set[str] = set()
    if item.get("itemType"):
        output["Item Type"] = item["itemType"]
        consumed.add("itemType")
    for column, fields in REFERENCE_ZOTERO_FIELDS.items():
        for field in fields:
            value = item.get(field)
            if value not in (None, "", [], {}):
                output[column] = str(value) if column in {"Volum", "Número", "Pàgines", "Edició"} else value
                consumed.add(field)
                break
    date_field = next((field for field in REFERENCE_DATE_SOURCES["issued"] if item.get(field)), "date")
    dates = import_date(item.get(date_field))
    if dates:
        output.update(dates)
        consumed.add(date_field)
    elif item.get(date_field):
        output["Data de publicació"] = str(item[date_field])
        year = re.search(r"\d{4}", str(item[date_field]))
        if year:
            output["Any"] = int(year.group())
        consumed.add(date_field)
    if item.get("citationKey"):
        output["Citation Key"] = item["citationKey"]
        consumed.add("citationKey")
    unknown = _copy_creators(item, output, consumed)
    if output.get("Autoría"):
        # Compatibility for lookup/key-generation clients; the write boundary
        # consumes this legacy alias into the designated structured author field.
        output["Authors"] = "; ".join(text_names(output["Autoría"]))
    extras = {key: value for key, value in item.items() if key not in consumed | _TECHNICAL_FIELDS and value not in (None, "", [], {})}
    if unknown:
        extras["creators"] = unknown
    if extras:
        output["Zotero Extras"] = extras
    return output
