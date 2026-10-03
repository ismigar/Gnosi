"""Resolve and persist a generated value against the current table schema."""

from backend.utils.metadata_io import MetadataUnavailable, read_metadata_bytes, read_metadata_text

from pathlib import Path
from collections.abc import Mapping, Sequence
from typing import Any, NotRequired, TypedDict

from fastapi import HTTPException

from backend.domains.agent.gnosi_support import _write_page, _parse
from backend.domains.vault.pages.index_service import get_available_page_entries
from backend.domains.vault.registry.runtime import load_registry_for_write as load_registry
from backend.domains.vault.tables.catalogs.core import get_prop_options
from backend.domains.vault.tables.options import find_table_and_property
from backend.services.button_action_contracts import field_value_schema
from backend.services.agent_execution_scope import current_scope, revalidate_scope
from backend.services.json_contracts import validate_json_value
from backend.services.relation_sync import to_ids
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData


class RelationCandidate(TypedDict):
    id: str
    title: str
    metadata: NotRequired[RegistryData]
    content: NotRequired[str]
    content_truncated: NotRequired[bool]
    source_revision: NotRequired[str]


def describe_field(prop: RegistryData, registry: RegistryData) -> dict[str, Any]:
    field = {"id": prop.get("id"), "name": prop.get("name"), "type": prop.get("type"),
             "options": get_prop_options(prop, registry.get("option_catalogs"))}
    if prop.get("read_only"):
        field["read_only"] = True
    if prop.get("type") == "relation":
        raw_config = prop.get("config")
        config = raw_config if is_record(raw_config) else {}
        for key in ("relation_database_id", "cardinality", "limit"):
            if key in prop or key in config:
                field[key] = prop.get(key, config.get(key))
    return field


def relation_title_candidates(field: dict[str, Any], *, include_context: bool = False) -> list[RelationCandidate]:
    """Read fresh titles from the selected table, never from another vault."""
    from backend.domains.vault.pages.foundation import _query_page_title
    from backend.domains.vault.tables.rows import build_table_folder_index, resolve_table_id_from_context
    target = field.get("relation_database_id")
    if not isinstance(target, str) or not target:
        raise HTTPException(422, "Relation titles require a destination table")
    root = Path(current_scope().vault_path).resolve()
    entries = get_available_page_entries(root)
    if entries is None:
        raise HTTPException(503, "The relation index is unavailable; refresh the vault before retrying")
    folders = build_table_folder_index(load_registry())
    result: list[RelationCandidate] = []
    for entry in entries:
        cached_metadata = entry.get("metadata") or {}
        if not is_record(cached_metadata):
            raise HTTPException(503, "A relation candidate has invalid indexed metadata")
        if resolve_table_id_from_context(cached_metadata, str(entry.get("folder") or ""), folders) != target:
            continue
        raw_path = entry.get("path")
        if not isinstance(raw_path, (str, Path)) or not raw_path:
            raise HTTPException(503, "A relation candidate has no available path")
        path = Path(raw_path).resolve()
        if not path.is_relative_to(root):
            raise HTTPException(403, "Relation candidate is outside the selected vault")
        try:
            original = read_metadata_bytes(path) if include_context else None
            metadata, body = _parse(path)
            if not is_record(metadata):
                raise HTTPException(503, "A relation candidate has invalid metadata")
            if include_context and read_metadata_bytes(path) != original:
                raise HTTPException(409, "A relation candidate changed while preparing context")
        except (OSError, ValueError) as exc:
            raise HTTPException(503, "A relation candidate is unavailable") from exc
        actual_table = metadata.get("table_id") or metadata.get("database_table_id")
        if actual_table != target or metadata.get("id") != entry.get("id"):
            raise HTTPException(409, "The relation index changed; refresh the vault before retrying")
        if metadata.get("is_template"):
            continue
        candidate: RelationCandidate = {"id": str(metadata["id"]), "title": str(_query_page_title(metadata, path))}
        if include_context and original is not None:
            import hashlib
            candidate["metadata"] = metadata
            candidate["content"] = body
            candidate["content_truncated"] = False
            candidate["source_revision"] = hashlib.sha256(original).hexdigest()
        result.append(candidate)
    return sorted(result, key=lambda row: (row["id"], row["title"]))


def resolve_relation_value(field: dict[str, Any], value: object) -> object:
    """Resolve unique exact titles; preserve explicit IDs and their wikilinks."""
    from backend.domains.vault.api.configuration_routes import _canonicalize_id, find_page_path
    candidates: list[RelationCandidate] | None = None
    def resolve(item: object) -> object:
        nonlocal candidates
        if not isinstance(item, str) or not item.strip():
            return item
        identifier = to_ids(item)[0]
        path = find_page_path(identifier, allow_full_scan=False)
        if path is not None:
            if not path.resolve().is_relative_to(Path(current_scope().vault_path).resolve()):
                raise HTTPException(403, "Relation target is outside the selected vault")
            metadata, _body = _parse(path)
            # The shared resolver also accepts titles. Its returned path is
            # proof of an ID lookup only when the page's actual ID matches.
            if _canonicalize_id(metadata.get("id")) == _canonicalize_id(identifier):
                return item
        if item.strip().startswith("[[") and "|" in item:
            raise HTTPException(422, "Relation target is unavailable")
        title = item.strip()
        if title.startswith("[[") and title.endswith("]]"):
            title = title[2:-2].strip()
        if candidates is None:
            candidates = relation_title_candidates(field)
        matches = {row["id"] for row in candidates if row["title"].strip().casefold() == title.casefold()}
        if not matches:
            raise HTTPException(422, "No relation target has that exact title")
        if len(matches) != 1:
            raise HTTPException(422, "The relation title is ambiguous; use a page identifier")
        return next(iter(matches))
    return [resolve(item) for item in value] if isinstance(value, list) else resolve(value)


def validate_relation_targets(field: dict[str, Any], value: object) -> None:
    from backend.domains.vault.api.configuration_routes import _canonicalize_id, find_page_path
    scope = current_scope()
    ids = to_ids(value)
    canonical = [_canonicalize_id(identifier) for identifier in ids]
    if len(set(canonical)) != len(canonical):
        raise HTTPException(422, "Repeated relation identifiers are not allowed")
    expected_table = field.get("relation_database_id")
    for identifier in ids:
        path = find_page_path(identifier, allow_full_scan=False)
        if path is None:
            raise HTTPException(422, "Relation target is unavailable")
        if not path.resolve().is_relative_to(Path(scope.vault_path).resolve()):
            raise HTTPException(403, "Relation target is outside the selected vault")
        metadata, _body = _parse(path)
        if _canonicalize_id(metadata.get("id")) != _canonicalize_id(identifier):
            raise HTTPException(409, "Relation target identity changed")
        target_table = metadata.get("table_id") or metadata.get("database_table_id")
        if expected_table and _canonicalize_id(target_table) != _canonicalize_id(expected_table):
            raise HTTPException(422, "Relation target belongs to a different table")


def resolve_button_field(metadata: RegistryData, reference: str) -> tuple[dict[str, Any], dict[str, Any]]:
    registry = load_registry()
    table_id = str(metadata.get("table_id") or metadata.get("database_table_id") or "")
    if not table_id:
        raise HTTPException(status_code=422, detail="AI field buttons require a table row")
    _table, prop = find_table_and_property(registry, table_id, reference)
    field = describe_field(prop, registry)
    schema = field_value_schema(field)
    if not isinstance(schema, dict):
        raise HTTPException(status_code=422, detail="This field requires a different action contract")
    return field, schema


def commit_button_value(path: Path, original: str, metadata: RegistryData, body: str,
                        field: dict[str, Any], value: object) -> RegistryData:
    return commit_button_assignments(path, original, [field], [{"field": field["name"], "value": value}])


def resolve_button_fields(metadata: RegistryData) -> list[dict[str, Any]]:
    registry = load_registry()
    table_id = str(metadata.get("table_id") or metadata.get("database_table_id") or "")
    tables = registry.get("tables", [])
    if not isinstance(tables, list):
        raise HTTPException(422, "The table schema is invalid")
    table = next((item for item in tables if is_record(item) and item.get("id") == table_id), None)
    if not table_id or table is None:
        raise HTTPException(422, "Skill buttons require an existing table row")
    fields = []
    properties = table.get("properties", [])
    if not isinstance(properties, list):
        raise HTTPException(422, "The table fields are invalid")
    for prop in properties:
        if not is_record(prop):
            continue
        field = describe_field(prop, registry)
        if field_value_schema(field) is not False:
            fields.append(field)
    if not fields:
        raise HTTPException(422, "The table has no editable fields for this skill")
    return fields


def commit_button_assignments(path: Path, original: str, fields: list[dict[str, Any]],
                              assignments: Sequence[Mapping[str, object]]) -> RegistryData:
    updated, latest_body = prepare_button_assignments(path, original, fields, assignments)
    _write_page(path, updated, latest_body)
    return updated


def prepare_button_assignments(path: Path, original: str, fields: list[dict[str, Any]],
                              assignments: Sequence[Mapping[str, object]]) -> tuple[RegistryData, str]:
    revalidate_scope(current_scope())
    if read_metadata_text(path, encoding="utf-8") != original:
        raise HTTPException(status_code=409, detail="The row changed while the AI was generating a value")
    latest_metadata, latest_body = _parse(path)
    if not is_record(latest_metadata):
        raise HTTPException(422, "The page metadata is invalid")
    updated = dict(latest_metadata)
    if not assignments:
        raise HTTPException(422, "Skill returned no field assignments")
    seen = set()
    for assignment in assignments:
        field = next((field for field in fields if field["name"] == assignment.get("field")), None)
        if field is None or field["name"] in seen:
            raise HTTPException(422, "Skill returned an unknown or repeated field")
        seen.add(field["name"])
        current_field, schema = resolve_button_field(latest_metadata, str(field.get("id") or field["name"]))
        if current_field != field:
            raise HTTPException(status_code=409, detail="The field schema changed while the AI was generating a value")
        value = assignment["value"]
        validate_json_value(value, schema)
        if field["type"] == "relation":
            value = resolve_relation_value(field, value)
            validate_relation_targets(field, value)
        updated[str(field["name"])] = value
        updated[str(field["name"]) + "_manual"] = True
    return updated, latest_body
