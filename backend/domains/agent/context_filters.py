"""Exact field predicates over authorized inventory records."""

from typing import Any

from backend.domains.agent.context_matching import _normalized_phrase
from backend.domains.agent.context_storage import _authorized_inventory_tables, _searchable_page_records
from backend.domains.vault.links.parsing import RELATION_WIKILINK_RE, TITLE_ONLY_WIKILINK_RE
from backend.utils.open_values import get_value


def _text(value: Any) -> str:
    return " ".join(str(value).split()).casefold()


def _relation_id(value: Any, titles: dict[str, set[str]]) -> set[str]:
    raw = str(value).strip()
    link = RELATION_WIKILINK_RE.match(raw)
    if link:
        return {link.group("rid").strip()}
    title = TITLE_ONLY_WIKILINK_RE.match(raw)
    return titles.get(_text(title.group("title")), set()) if title else {raw}


def _matches_predicate(
    record: dict[str, Any], field: dict[str, Any], expected: Any,
    titles: dict[str, set[str]],
) -> bool:
    metadata = record["metadata"]
    value = get_value(metadata, str(field["id"]))
    if value is None:
        value = get_value(metadata, str(field.get("name") or field["id"]))
    if field.get("type") == "title":
        value = record["title"]
    values = value if isinstance(value, list) else [value]
    if field.get("type") == "relation":
        return any(_relation_id(item, titles) & expected for item in values if item is not None)
    return any(
        (_text(item) == _text(expected) if isinstance(item, str) and isinstance(expected, str)
         else type(item) is type(expected) and item == expected)
        for item in values
    )


def filter_inventory_records(
    refs: list[dict[str, Any]], records: list[dict[str, Any]],
    filters: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Resolve relation titles to IDs, never to substring or token matches."""
    if not filters:
        return records
    if len(filters) > 12:
        raise ValueError("inventory_too_many_field_filters")
    authorized = _authorized_inventory_tables(refs)
    tables = {str(item["table_id"]): item["table"] for item in authorized}
    selected_tables = {record["table"]["id"] for record in records}
    compiled: dict[str, list[tuple[dict[str, Any], Any, dict[str, set[str]]]]] = {}
    for table_id in selected_tables:
        table = tables[table_id]
        predicates = []
        for name, expected in filters.items():
            fields = [field for field in table.get("properties", []) if any(
                _normalized_phrase(field.get(key)) == _normalized_phrase(name)
                for key in ("id", "name")
            )]
            if len(fields) != 1:
                raise ValueError(f"inventory_field_not_resolved:{name}")
            field = fields[0]
            titles: dict[str, set[str]] = {}
            if field.get("type") == "relation":
                target = str(field.get("relation_database_id") or "")
                if target not in tables:
                    raise PermissionError("inventory_relation_target_not_attached")
                related = _searchable_page_records(refs, requested_types=[target])
                ids = {row["id"] for row in related}
                for row in related:
                    titles.setdefault(_text(row["title"]), set()).add(row["id"])
                target_ids = {str(expected)} if str(expected) in ids else titles.get(_text(expected), set())
                if len(target_ids) > 1:
                    raise ValueError(f"inventory_relation_title_ambiguous:{name}")
                expected = target_ids
            predicates.append((field, expected, titles))
        compiled[table_id] = predicates
    result = []
    for record in records:
        matches = True
        for field, expected, titles in compiled[record["table"]["id"]]:
            matches = _matches_predicate(record, field, expected, titles)
            if not matches:
                break
        if matches:
            result.append({**record, "_filter_match_kind": (
                "relation" if any(field.get("type") == "relation" for field, _, _ in compiled[record["table"]["id"]]) else "direct"
            )})
    return result
