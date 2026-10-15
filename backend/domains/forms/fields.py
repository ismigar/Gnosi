"""Resolve current table fields, rejecting protected metadata and schema drift."""

from __future__ import annotations

import math
import re
from datetime import date
from typing import cast
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import JsonValue

from backend.domains.forms.schemas import (
    FieldKind, FormFieldCandidate, FormFieldChoice, StoredFormField,
)
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.catalogs.core import get_prop_options
from backend.domains.vault.schemas.pages import PageSaveRequest

SUPPORTED = {"text", "number", "date", "select", "multi_select", "checkbox", "email", "url", "phone", "status"}
PROTECTED = {
    "id", "title", "table_id", "database_id", "database_table_id", "parent_id", "source_id",
    "resolved_table_id", "created_at", "created_by", "created_time", "last_edited_by",
    "last_edited_at", "last_edited_time", "last_modified", "source_parent_id", "path", "folder",
    "filename", "is_template", "is_default_template", "is_dashboard", "is_database", "note_type",
    "content_format", "cover", "icon", "_citation_roles", "metadata", "content", "force",
}


def table_from_registry(registry: RegistryData, table_id: str) -> RegistryData:
    tables = registry.get("tables")
    for table in tables if isinstance(tables, list) else []:
        if is_record(table) and table.get("id") == table_id and table_id.lower() != "wiki":
            return table
    raise HTTPException(404, "The form's table is unavailable")


def _safe_property(prop: RegistryData) -> bool:
    name = str(prop.get("name") or "").strip()
    config = prop.get("config")
    property_type = prop.get("type")
    readonly = is_record(config) and (config.get("read_only") or config.get("readonly"))
    return bool(
        name and name.casefold() not in PROTECTED and not name.startswith("_")
        and not any(char in name for char in "\r\n\x00")
        and isinstance(property_type, str) and property_type in SUPPORTED and not prop.get("read_only") and not readonly
    )


def field_candidates(table: RegistryData, registry: RegistryData) -> list[FormFieldCandidate]:
    candidates = [FormFieldCandidate(ref="title", label="Title", kind="title")]
    properties = table.get("properties")
    for prop in properties if isinstance(properties, list) else []:
        if not is_record(prop) or not _safe_property(prop):
            continue
        options = [str(option["name"]) for option in get_prop_options(prop, registry.get("option_catalogs"))]
        candidates.append(FormFieldCandidate(
            ref=str(prop.get("id") or prop["name"]), label=str(prop["name"]),
            kind=cast(FieldKind, prop["type"]), options=options,
        ))
    return candidates


def build_fields(choices: list[FormFieldChoice], table: RegistryData, registry: RegistryData) -> list[StoredFormField]:
    candidates = {field.ref: field for field in field_candidates(table, registry)}
    if len({choice.ref for choice in choices}) != len(choices) or not any(choice.ref == "title" for choice in choices):
        raise HTTPException(422, "Choose the title field once and do not repeat fields")
    fields: list[StoredFormField] = []
    for index, choice in enumerate(choices):
        candidate = candidates.get(choice.ref)
        if candidate is None or not choice.label.strip():
            raise HTTPException(422, "Choose only writable fields from this table")
        fields.append(StoredFormField(
            key=f"field_{index}", ref=candidate.ref, label=choice.label.strip(), help=choice.help,
            kind=candidate.kind, required=choice.required or candidate.kind == "title", options=candidate.options,
        ))
    return fields


def current_fields(fields: list[StoredFormField], table: RegistryData, registry: RegistryData) -> dict[str, str]:
    candidates = {field.ref: field for field in field_candidates(table, registry)}
    names: dict[str, str] = {}
    for field in fields:
        current = candidates.get(field.ref)
        if current is None or current.kind != field.kind or current.options != field.options:
            raise HTTPException(409, "The table fields changed; the owner must publish a new form")
        names[field.key] = "title" if current.kind == "title" else current.label
    return names


def _text_value(value: JsonValue, kind: FieldKind) -> str:
    if not isinstance(value, str) or len(value) > (200 if kind == "title" else 4000) or "\x00" in value:
        raise ValueError("Invalid text value")
    value = value.strip()
    if not value:
        return value
    if kind == "date":
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Use a calendar date")
        date.fromisoformat(value)
    if kind == "email" and (len(value) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value)):
        raise ValueError("Invalid email")
    if kind == "url":
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Invalid URL")
    return value


def validate_value(field: StoredFormField, value: JsonValue) -> JsonValue:
    if field.kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1e15:
            raise ValueError("Invalid number")
        return value
    if field.kind == "checkbox":
        if not isinstance(value, bool):
            raise ValueError("Invalid checkbox")
        return value
    if field.kind == "multi_select":
        if not isinstance(value, list) or len(value) > 100 or any(not isinstance(item, str) or item not in field.options for item in value):
            raise ValueError("Invalid choices")
        return list(dict.fromkeys(cast(list[str], value)))
    text = _text_value(value, field.kind)
    if field.kind in {"select", "status"} and text not in field.options:
        raise ValueError("Invalid choice")
    return text


def submission_page(
    fields: list[StoredFormField], names: dict[str, str], values: dict[str, JsonValue], table_id: str,
) -> PageSaveRequest:
    if set(values) - {field.key for field in fields}:
        raise HTTPException(422, "Unknown form fields")
    metadata: dict[str, JsonValue] = {"table_id": table_id}
    title = ""
    for field in fields:
        value = values.get(field.key)
        empty = value is None or value == "" or value == []
        if empty:
            if field.required:
                raise HTTPException(422, f"Required field: {field.label}")
            continue
        try:
            validated = validate_value(field, value)
        except (ValueError, TypeError, OverflowError):
            raise HTTPException(422, f"Invalid field: {field.label}") from None
        if field.required and isinstance(validated, str) and not validated:
            raise HTTPException(422, f"Required field: {field.label}")
        if field.kind == "title":
            title = str(validated)
        else:
            metadata[names[field.key]] = validated
    if not title:
        raise HTTPException(422, "A record title is required")
    return PageSaveRequest(title=title, content="", metadata=metadata)
