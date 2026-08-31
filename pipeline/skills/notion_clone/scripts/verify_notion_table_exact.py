#!/usr/bin/env python3
"""Verify one live Notion database against its Gnosi clone.

The script reads the Notion REST API with the configured integration token and
compares the mapped schema, deterministic clone row IDs, every structured
property value, and undeclared page metadata. It never prints credentials and
does not modify Notion or the vault.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Protocol

import yaml

GNOSI_ROOT = Path(__file__).resolve().parents[4]
if str(GNOSI_ROOT) not in sys.path:
    sys.path.insert(0, str(GNOSI_ROOT))

from backend.services.integration_manager import integration_manager  # noqa: E402
from backend.services.notion_clone import (  # noqa: E402
    clone_page_id,
    clone_table_id,
    clone_table_schema,
    clone_values,
)
from backend.services.notion_clone_verify import verify_exact_table  # noqa: E402
from backend.services.notion_importer import (  # noqa: E402
    NotionClient,
    page_to_values,
)


class VerificationClient(Protocol):
    def list_users(self) -> dict[str, str]: ...

    def query_database(self, database_id: str) -> Iterable[Mapping[str, object]]: ...


def _object(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{context} must be an object")
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ValueError(f"{context} keys must be strings")
        result[key] = item
    return result


def _objects(value: object, context: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{context} must be a list")
    return [_object(item, context) for item in value]


def _string(value: object, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context} must be a nonempty string")
    return value


def _properties(table: Mapping[str, object]) -> list[dict[str, object]]:
    value = table.get("properties")
    properties = _objects([] if value is None else value, "Table properties")
    for prop in properties:
        _string(prop.get("name"), "Property name")
    return properties


def _frontmatter(path: Path) -> dict[object, object]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    match = re.match(r"^---\n(.*?)\n---(?:\n|$)", text, re.DOTALL)
    if match is None:
        raise ValueError(f"Unterminated frontmatter: {path}")
    metadata: object = yaml.safe_load(match.group(1))
    if metadata is None:
        return {}
    if not isinstance(metadata, dict):
        raise ValueError(f"Frontmatter must be a mapping: {path}")
    return dict(metadata)


def _load_registry(vault: Path) -> dict[str, object]:
    path = vault / "BD" / "vault_db_registry.json"
    data = _object(json.loads(path.read_text(encoding="utf-8")), "Registry")
    for field in ("tables", "databases"):
        _objects(data.get(field, []), f"Registry {field}")
    return data


def _table_folder(
    vault: Path, table: Mapping[str, object], registry: Mapping[str, object]
) -> Path:
    database_id = table.get("database_id")
    database = next(
        (item for item in _objects(registry.get("databases", []), "Databases")
         if item.get("id") == database_id),
        None,
    )
    root = _string((database or {}).get("folder") or "BD", "Database folder").strip("/")
    folder_value = table.get("folder") or table.get("name") or ""
    if not isinstance(folder_value, str):
        raise ValueError("Table folder must be a string")
    folder = folder_value.strip("/")
    return vault / root / folder


def _expected_rows(
    client: VerificationClient,
    database_id: str,
    table: Mapping[str, object],
) -> dict[str, dict[str, object]]:
    users = client.list_users()
    rows = list(client.query_database(database_id))
    titles: dict[str, str] = {}
    raw_values: dict[str, dict[str, object]] = {}
    properties = _properties(table)
    title_field = next(
        (_string(prop.get("name"), "Title property")
         for prop in properties if prop.get("type") == "title"),
        "title",
    )
    for row in rows:
        row = _object(row, "Notion row")
        page_id = clone_page_id(_string(row.get("id"), "Notion row ID"))
        if page_id in raw_values:
            raise ValueError(f"Duplicate Notion row ID: {page_id}")
        row_properties = _object(row.get("properties"), "Notion row properties")
        for prop in row_properties.values():
            _object(prop, "Notion property")
        values = _object(clone_values(page_to_values(dict(row), users), properties), "Clone values")
        raw_values[page_id] = values
        titles[page_id] = str(values.get(title_field) or "Untitled")

    expected = {}
    for page_id, values in raw_values.items():
        expected[page_id] = {
            "id": page_id,
            "title": titles[page_id],
            "table_id": table.get("id"),
            **{key: value for key, value in values.items() if value is not None},
        }
    return expected


def _clone_rows(folder: Path, table_id: str) -> dict[str, dict[str, object]]:
    rows: dict[str, dict[str, object]] = {}
    for path in sorted(folder.glob("*.md")):
        metadata = _frontmatter(path)
        if str(metadata.get("table_id") or "") != table_id:
            continue
        page_id = _string(metadata.get("id"), "Clone row ID")
        if page_id in rows:
            raise ValueError(f"Duplicate clone row ID: {page_id}")
        rows[page_id] = _object(metadata, "Clone row metadata")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-id", required=True, help="Notion database UUID")
    parser.add_argument("--vault", required=True, type=Path, help="Gnosi vault root")
    parser.add_argument("--table-id", help="Gnosi clone table UUID; derived by default")
    parser.add_argument("--output", type=Path, help="Optional JSON report path")
    args = parser.parse_args()

    token = str((integration_manager.get_raw("notion") or {}).get("token") or "")
    if not token:
        raise RuntimeError("No Notion integration token is configured")

    client = NotionClient(token)
    notion_database = client.get_database(args.database_id)
    expected_table = _object(clone_table_schema(notion_database), "Expected table")
    _properties(expected_table)
    table_id = args.table_id or clone_table_id(args.database_id)
    if expected_table.get("id") != table_id:
        raise RuntimeError(
            f"Target table {table_id} is not the deterministic clone of {args.database_id}"
        )

    registry = _load_registry(args.vault)
    clone_table = next(
        (table for table in _objects(registry.get("tables", []), "Tables")
         if table.get("id") == table_id),
        None,
    )
    if clone_table is None:
        raise RuntimeError(f"Clone table not found in registry: {table_id}")
    _properties(clone_table)

    folder = _table_folder(args.vault, clone_table, registry)
    report = _object(verify_exact_table(
        expected_table,
        _expected_rows(client, args.database_id, expected_table),
        clone_table,
        _clone_rows(folder, table_id),
    ), "Verification report")
    report["source_database_id"] = args.database_id
    report["clone_table_id"] = table_id
    report["clone_folder"] = str(folder)

    exact = _object(report.get("summary"), "Report summary").get("exact")
    if not isinstance(exact, bool):
        raise ValueError("Report exact result must be a boolean")
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if exact else 1


if __name__ == "__main__":
    raise SystemExit(main())
