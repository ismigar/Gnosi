#!/usr/bin/env python3
"""Inventory SQLite schemas without reading application row values."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any, Iterable


SQLITE_HEADER = b"SQLite format 3\x00"
SIDECAR_SUFFIXES = ("-journal", "-shm", "-wal")
WHITESPACE_RE = re.compile(r"\s+")


def _is_sqlite(path: Path) -> bool:
    if not path.is_file() or path.name.endswith(SIDECAR_SUFFIXES):
        return False
    try:
        with path.open("rb") as handle:
            return handle.read(len(SQLITE_HEADER)) == SQLITE_HEADER
    except OSError:
        return False


def discover_databases(root: Path) -> list[Path]:
    """Return SQLite files below *root*, identified by their file header."""
    return sorted(
        (path for path in root.rglob("*") if _is_sqlite(path)),
        key=lambda path: path.relative_to(root).as_posix(),
    )


def _normalize_sql(value: str | None) -> str | None:
    if value is None:
        return None
    return WHITESPACE_RE.sub(" ", value.strip())


def _rows(connection: sqlite3.Connection, statement: str) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(statement).fetchall()]


def _quoted_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _table_details(connection: sqlite3.Connection, table: str) -> dict[str, Any]:
    quoted = _quoted_identifier(table)
    columns = _rows(connection, f"PRAGMA table_xinfo({quoted})")
    foreign_keys = _rows(connection, f"PRAGMA foreign_key_list({quoted})")
    indexes: list[dict[str, Any]] = []
    for index in _rows(connection, f"PRAGMA index_list({quoted})"):
        name = str(index["name"])
        indexes.append(
            {
                "name": None if name.startswith("sqlite_autoindex_") else name,
                "unique": int(index["unique"]),
                "origin": str(index["origin"]),
                "partial": int(index["partial"]),
                "columns": _rows(
                    connection,
                    f"PRAGMA index_xinfo({_quoted_identifier(name)})",
                ),
            }
        )
    return {
        "columns": columns,
        "foreign_keys": foreign_keys,
        "indexes": sorted(indexes, key=lambda item: str(item["name"] or "")),
    }


def schema_document(
    connection: sqlite3.Connection,
    *,
    excluded_tables: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """Build the normalized, data-free document used for fingerprinting."""
    schema_rows = []
    tables: dict[str, Any] = {}
    query = """
        SELECT type, name, tbl_name, sql
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_autoindex_%'
        ORDER BY type, name, tbl_name
    """
    for row in connection.execute(query):
        object_type = str(row["type"])
        object_name = str(row["name"])
        table_name = str(row["tbl_name"])
        if object_name in excluded_tables or table_name in excluded_tables:
            continue
        item = {
            "type": object_type,
            "name": object_name,
            "table": table_name,
            "sql": _normalize_sql(row["sql"]),
        }
        schema_rows.append(item)
        if object_type == "table":
            tables[object_name] = _table_details(connection, object_name)
    return {"schema": schema_rows, "tables": tables}


def _fingerprint(document: dict[str, Any]) -> str:
    signature = _schema_signature(document)
    encoded = json.dumps(
        signature,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _normalized_default(value: Any) -> str | None:
    if value is None:
        return None
    normalized = WHITESPACE_RE.sub(" ", str(value).strip())
    while normalized.startswith("(") and normalized.endswith(")"):
        normalized = normalized[1:-1].strip()
    return normalized


def _schema_signature(document: dict[str, Any]) -> dict[str, Any]:
    """Return the semantic structure used for compatibility decisions."""
    schema = document.get("schema", [])
    virtual_tables = {
        str(item["name"])
        for item in schema
        if item.get("type") == "table"
        and str(item.get("sql") or "").upper().startswith("CREATE VIRTUAL TABLE")
    }
    derived_tables = {"sqlite_sequence"}
    for table in virtual_tables:
        derived_tables.update(
            f"{table}_{suffix}"
            for suffix in ("config", "content", "data", "docsize", "idx")
        )
    index_sql = {
        str(item["name"]): item.get("sql")
        for item in schema
        if item.get("type") == "index"
    }
    table_sql = {
        str(item["name"]): item.get("sql")
        for item in schema
        if item.get("type") == "table"
    }
    tables: dict[str, Any] = {}
    raw_tables = document.get("tables", {})
    if not isinstance(raw_tables, dict):
        raw_tables = {}
    for table_name, raw_details in raw_tables.items():
        if table_name in derived_tables or not isinstance(raw_details, dict):
            continue
        columns = [
            {
                "name": str(column.get("name")),
                "type": str(column.get("type") or "").upper(),
                "notnull": int(column.get("notnull") or 0),
                "default": _normalized_default(column.get("dflt_value")),
                "pk": int(column.get("pk") or 0),
                "hidden": int(column.get("hidden") or 0),
            }
            for column in raw_details.get("columns", [])
        ]
        foreign_keys = [
            {
                "seq": int(foreign_key.get("seq") or 0),
                "table": str(foreign_key.get("table") or ""),
                "from": str(foreign_key.get("from") or ""),
                "to": str(foreign_key.get("to") or ""),
                "on_update": str(foreign_key.get("on_update") or "").upper(),
                "on_delete": str(foreign_key.get("on_delete") or "").upper(),
                "match": str(foreign_key.get("match") or "").upper(),
            }
            for foreign_key in raw_details.get("foreign_keys", [])
        ]
        indexes = []
        for index in raw_details.get("indexes", []):
            key_columns = [
                {
                    "name": column.get("name"),
                    "expression": int(column.get("cid") or 0) == -2,
                    "desc": int(column.get("desc") or 0),
                    "collation": str(column.get("coll") or "").upper(),
                }
                for column in index.get("columns", [])
                if int(column.get("key") or 0) == 1
            ]
            name = index.get("name")
            partial = int(index.get("partial") or 0)
            has_expression = any(column["expression"] for column in key_columns)
            indexes.append(
                {
                    "name": name,
                    "unique": int(index.get("unique") or 0),
                    "origin": str(index.get("origin") or ""),
                    "partial": partial,
                    "columns": key_columns,
                    "sql": (
                        _normalize_sql(index_sql.get(str(name)))
                        if name and (partial or has_expression)
                        else None
                    ),
                }
            )
        tables[str(table_name)] = {
            "columns": sorted(columns, key=lambda item: item["name"]),
            "foreign_keys": sorted(
                foreign_keys,
                key=lambda item: (item["from"], item["table"], item["to"], item["seq"]),
            ),
            "indexes": sorted(
                indexes,
                key=lambda item: json.dumps(item, sort_keys=True),
            ),
            "virtual_sql": (
                _normalize_sql(table_sql.get(str(table_name)))
                if table_name in virtual_tables
                else None
            ),
        }
    other_objects = [
        {
            "type": str(item.get("type")),
            "name": str(item.get("name")),
            "table": str(item.get("table")),
            "sql": _normalize_sql(item.get("sql")),
        }
        for item in schema
        if item.get("type") in {"trigger", "view"}
    ]
    return {
        "tables": tables,
        "other_objects": sorted(
            other_objects,
            key=lambda item: (item["type"], item["name"]),
        ),
    }


def schema_fingerprint(
    connection: sqlite3.Connection,
    *,
    excluded_tables: frozenset[str] = frozenset({"alembic_version"}),
) -> str:
    """Return the deterministic fingerprint of one open database."""
    return _fingerprint(schema_document(connection, excluded_tables=excluded_tables))


def database_fingerprint(path: Path) -> str:
    """Fingerprint one SQLite file while ignoring Alembic's version table."""
    uri = f"{path.expanduser().resolve().as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=30)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        return schema_fingerprint(connection)
    finally:
        connection.close()


def audit_database(path: Path, root: Path) -> dict[str, Any]:
    """Audit one SQLite database through a read-only connection."""
    uri = f"{path.resolve().as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=30)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        document = schema_document(connection)
        metadata = {
            "application_id": int(connection.execute("PRAGMA application_id").fetchone()[0]),
            "page_size": int(connection.execute("PRAGMA page_size").fetchone()[0]),
            "schema_version": int(connection.execute("PRAGMA schema_version").fetchone()[0]),
            "user_version": int(connection.execute("PRAGMA user_version").fetchone()[0]),
        }
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
    finally:
        connection.close()
    return {
        "path": path.relative_to(root).as_posix(),
        "bytes": path.stat().st_size,
        "metadata": metadata,
        "integrity_check": integrity,
        "fingerprint": _fingerprint(document),
        "document": document,
    }


def audit(root: Path, databases: Iterable[Path] | None = None) -> dict[str, Any]:
    resolved_root = root.expanduser().resolve()
    targets = list(databases) if databases is not None else discover_databases(resolved_root)
    audited = [audit_database(path.expanduser().resolve(), resolved_root) for path in targets]
    return {
        "format": "gnosi-sqlite-schema-audit-v1",
        "root_label": resolved_root.name,
        "database_count": len(audited),
        "databases": audited,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Root containing SQLite databases")
    parser.add_argument(
        "--output",
        type=Path,
        help="Write JSON to this path instead of standard output",
    )
    parser.add_argument(
        "--database",
        action="append",
        type=Path,
        help="Audit only this root-relative database path; may be repeated",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.expanduser().resolve()
    databases = None
    if args.database:
        databases = []
        for relative in args.database:
            candidate = (root / relative).resolve()
            try:
                candidate.relative_to(root)
            except ValueError as exc:
                raise SystemExit(f"Database must be below the audit root: {relative}") from exc
            if not _is_sqlite(candidate):
                raise SystemExit(f"Not a SQLite database: {relative}")
            databases.append(candidate)
    report = audit(root, databases)
    payload = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
