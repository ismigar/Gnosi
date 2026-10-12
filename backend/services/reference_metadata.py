"""Shared canonical bibliographic fields, including previously imported Zotero extras."""
from __future__ import annotations

from typing import Any, Mapping

from backend.services.reference_catalog import (
    REFERENCE_CREATOR_ROLES, REFERENCE_DATE_FIELDS, REFERENCE_TEXT_FIELDS,
    REFERENCE_ZOTERO_FIELDS, ZOTERO_CREATOR_COLUMNS,
)
from backend.services.reference_dates import csl_date, issued_date
from backend.services.reference_names import role_fields, to_csl_names, zotero_name
from backend.services.csl_type_resolver import resolve_zotero_item_type


def bibliographic_values(metadata: Mapping[str, Any]) -> dict[str, Any]:
    """Declared values win over old imported extras, including explicit empty values."""
    values = dict(metadata)
    extras = metadata.get("Zotero Extras")
    if not isinstance(extras, dict):
        return values
    for column, sources in REFERENCE_ZOTERO_FIELDS.items():
        if column in values:
            continue
        for source in sources:
            if extras.get(source) not in (None, ""):
                values[column] = extras[source]
                break
    creators = extras.get("creators")
    if isinstance(creators, list):
        columns = ZOTERO_CREATOR_COLUMNS.get(resolve_zotero_item_type(str(metadata.get("Item Type") or "")), {})
        grouped: dict[str, list[dict[str, str]]] = {}
        for person in creators:
            if not isinstance(person, dict):
                continue
            creator_column = columns.get(person.get("creatorType") or "author")
            if creator_column:
                grouped.setdefault(creator_column, []).append(zotero_name(person))
        for column, people in grouped.items():
            values.setdefault(column, people)
    return values


def csl_details(metadata: Mapping[str, Any]) -> dict[str, Any]:
    values = bibliographic_values(metadata)
    result: dict[str, Any] = {}
    for column, variable in REFERENCE_TEXT_FIELDS.items():
        value = values.get(column)
        if isinstance(value, (str, int, float)) and str(value).strip():
            result[variable] = str(value)
    issued = issued_date(values)
    if issued:
        result["issued"] = issued
    for column, variable in REFERENCE_DATE_FIELDS.items():
        date = csl_date(values.get(column))
        if date:
            result[variable] = date
    for column, role in role_fields(values).items():
        if role == "author":
            continue
        people = to_csl_names(values.get(column))
        if people:
            result[role] = people
    return result


def reference_schema() -> list[tuple[str, str]]:
    """Additional editable fields; creators always use the existing autoria editor."""
    return [
        *((column, "autoria") for column in REFERENCE_CREATOR_ROLES),
        ("Mes", "number"), ("Dia", "number"), ("Data de publicació", "text"),
        *((column, "text") for column in REFERENCE_TEXT_FIELDS),
        *((column, "text") for column in REFERENCE_DATE_FIELDS),
    ]
