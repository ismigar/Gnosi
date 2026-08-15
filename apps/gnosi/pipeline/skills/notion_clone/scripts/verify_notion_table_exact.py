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
import sys
from pathlib import Path
from typing import Any

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


def _frontmatter(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
        if not text.startswith("---"):
            return {}
        parts = text.split("---", 2)
        if len(parts) < 3:
            return {}
        metadata = yaml.safe_load(parts[1]) or {}
        return metadata if isinstance(metadata, dict) else {}
    except (OSError, UnicodeError, yaml.YAMLError):
        return {}


def _load_registry(vault: Path) -> dict[str, Any]:
    path = vault / "BD" / "vault_db_registry.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"Invalid registry: {path}")
    return data


def _table_folder(vault: Path, table: dict[str, Any], registry: dict[str, Any]) -> Path:
    database_id = table.get("database_id")
    database = next(
        (item for item in registry.get("databases", []) if item.get("id") == database_id),
        None,
    )
    root = str((database or {}).get("folder") or "BD").strip("/")
    folder = str(table.get("folder") or table.get("name") or "").strip("/")
    return vault / root / folder


def _expected_rows(
    client: NotionClient,
    database_id: str,
    table: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    users = client.list_users()
    rows = list(client.query_database(database_id))
    titles: dict[str, str] = {}
    raw_values: dict[str, dict[str, Any]] = {}
    title_field = next(
        (prop.get("name") for prop in table.get("properties", []) if prop.get("type") == "title"),
        "title",
    )
    for row in rows:
        page_id = clone_page_id(row.get("id"))
        values = clone_values(page_to_values(row, users), table.get("properties", []))
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


def _clone_rows(folder: Path, table_id: str) -> dict[str, dict[str, Any]]:
    rows = {}
    for path in sorted(folder.glob("*.md")):
        metadata = _frontmatter(path)
        if str(metadata.get("table_id") or "") != table_id:
            continue
        page_id = str(metadata.get("id") or "")
        if page_id:
            rows[page_id] = metadata
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
    expected_table = clone_table_schema(notion_database)
    table_id = args.table_id or clone_table_id(args.database_id)
    if expected_table.get("id") != table_id:
        raise RuntimeError(
            f"Target table {table_id} is not the deterministic clone of {args.database_id}"
        )

    registry = _load_registry(args.vault)
    clone_table = next(
        (table for table in registry.get("tables", []) if table.get("id") == table_id),
        None,
    )
    if clone_table is None:
        raise RuntimeError(f"Clone table not found in registry: {table_id}")

    folder = _table_folder(args.vault, clone_table, registry)
    report = verify_exact_table(
        expected_table,
        _expected_rows(client, args.database_id, expected_table),
        clone_table,
        _clone_rows(folder, table_id),
    )
    report["source_database_id"] = args.database_id
    report["clone_table_id"] = table_id
    report["clone_folder"] = str(folder)

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if report["summary"]["exact"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
