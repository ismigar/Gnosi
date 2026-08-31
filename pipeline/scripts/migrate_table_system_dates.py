"""Add canonical system date fields to every Vault table and record.

Usage:

    python -m pipeline.scripts.migrate_table_system_dates --vault /path/to/vault --dry-run
    python -m pipeline.scripts.migrate_table_system_dates --vault /path/to/vault --locale ca

The migration is idempotent. It changes only registered table folders and
never removes internal authorship keys such as ``created_at``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Iterable, Mapping
from typing import Protocol, TypeGuard

import yaml

_HERE = Path(__file__).resolve()
_ROOT = _HERE.parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.services.notion_clone import clone_page_id, clone_table_id  # noqa: E402
from backend.config.data_dir import resolve_data_dir  # noqa: E402
from backend.domains.vault.registry.records import is_record  # noqa: E402
from backend.services.table_system_dates import (  # noqa: E402
    ensure_system_date_properties,
    property_role,
    system_date_labels,
)
from backend.utils.safe_io import safe_write_text  # noqa: E402


_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_SKIP_DIRS = {".git", ".gnosi", ".history", ".obsidian", ".trash", "local_data"}
_PROTECTED_METADATA = {
    "created_at",
    "created_by",
    "last_edited_at",
    "last_edited_by",
}

Record = dict[str, object]
NotionTimestampIndex = dict[str, dict[str, dict[str, str]]]


class NotionTimestampClient(Protocol):
    def query_database(self, database_id: str, /) -> Iterable[Mapping[str, object]]: ...


def _is_record(value: object) -> TypeGuard[Record]:
    return isinstance(value, dict) and all(isinstance(key, str) for key in value)


def _record(value: object, context: str) -> Record:
    if not _is_record(value):
        raise ValueError(f"{context} must be an object with text keys")
    return value


def _items(value: object, context: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{context} must be a list")
    return list(value)


def _records(value: object, context: str) -> list[Record]:
    return [_record(item, context) for item in _items(value, context)]


def _strings(value: object, context: str) -> list[str]:
    result: list[str] = []
    for item in _items(value, context):
        if not isinstance(item, str):
            raise ValueError(f"{context} must contain text values")
        result.append(item)
    return result


def _validate_registry(registry: Record) -> None:
    """Validate traversed collections before any backup or migration writes.

    Records retain their identity and every opaque field, including nested
    extension payloads. Malformed collections are rejected, never filtered.
    """
    _records(registry.get("databases") or [], "Registry databases")
    _records(registry.get("views") or [], "Registry views")
    for table in _records(registry.get("tables") or [], "Registry tables"):
        for prop in _records(table.get("properties") or [], "Table properties"):
            if property_role(prop):
                _items(prop.get("aliases") or [], "Property aliases")


def build_notion_timestamp_index(
    client: NotionTimestampClient,
    config: Record,
) -> tuple[NotionTimestampIndex, dict[str, int]]:
    """Enumerate configured Notion databases and index row audit timestamps.

    Local table and page IDs are the deterministic clone UUIDs. Building the
    complete index before the Vault write phase prevents a transient Notion
    error from leaving a partially authoritative migration on disk.
    """

    index: NotionTimestampIndex = {}
    report = {
        "notion_databases": 0,
        "notion_source_rows": 0,
        "notion_rows_without_dates": 0,
    }
    databases = config.get("databases") or []
    if not isinstance(databases, list) or not databases:
        raise RuntimeError("The Notion import configuration has no databases")

    for source in _items(databases, "Notion databases"):
        if not _is_record(source):
            continue
        source_database_id = str(source.get("id") or "").strip()
        if not source_database_id:
            continue
        table_id = clone_table_id(source_database_id)
        rows: dict[str, dict[str, str]] = {}
        for page in client.query_database(source_database_id):
            source_page_id = str(page.get("id") or "").strip()
            if not source_page_id:
                continue
            created = str(page.get("created_time") or "").strip()
            modified = str(page.get("last_edited_time") or "").strip()
            report["notion_source_rows"] += 1
            if not created or not modified:
                report["notion_rows_without_dates"] += 1
            rows[clone_page_id(source_page_id)] = {
                "created": created,
                "modified": modified,
            }
        index[table_id] = rows
        report["notion_databases"] += 1
    return index, report


def _parse_frontmatter(raw: str) -> tuple[dict[object, object], str]:
    match = _FM_RE.match(raw)
    if not match:
        return {}, raw
    try:
        metadata: object = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return {}, raw
    return (dict(metadata) if isinstance(metadata, dict) else {}), raw[match.end() :]


def _render_frontmatter(metadata: dict[object, object], body: str) -> str:
    yaml_text = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    ).strip()
    return f"---\n{yaml_text}\n---\n{body}"


def _iso_from_stat(path: Path, *, creation: bool) -> str:
    stat_result = path.stat()
    timestamp = (
        getattr(stat_result, "st_birthtime", 0) or stat_result.st_ctime
        if creation
        else stat_result.st_mtime
    )
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def _table_roots(vault: Path, registry: Record) -> dict[str, Path]:
    databases = {
        str(db.get("id")): str(db.get("folder") or "")
        for db in _records(registry.get("databases", []) or [], "Registry databases")
        if db.get("id")
    }
    roots: dict[str, Path] = {}
    for table in _records(registry.get("tables", []) or [], "Registry tables"):
        if not table.get("id"):
            continue
        database_folder = databases.get(str(table.get("database_id")), "")
        folder = str(table.get("folder") or table.get("name") or "").strip()
        root = vault / database_folder / folder if database_folder else vault / folder
        roots[str(table["id"])] = root
    return roots


def _iter_table_pages(root: Path) -> Iterable[Path]:
    if not root.is_dir():
        return
    for path in root.rglob("*.md"):
        relative = path.relative_to(root)
        if any(part in _SKIP_DIRS or part.startswith(".") for part in relative.parts[:-1]):
            continue
        yield path


def _table_id_for_page(
    path: Path, roots: dict[str, Path], metadata: dict[object, object]
) -> str | None:
    metadata_id = metadata.get("database_table_id") or metadata.get("table_id")
    if metadata_id and str(metadata_id) in roots:
        return str(metadata_id)
    candidates = [
        (table_id, root)
        for table_id, root in roots.items()
        if path == root or root in path.parents
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: len(item[1].parts))[0]


def _replace_view_list_refs(container: Record, replacements: dict[str, str]) -> bool:
    """Retain list equality checks and in-place updates to field descriptors."""

    changed = False

    def replace_value(value: object) -> object:
        if isinstance(value, str):
            return replacements.get(value, value)
        if _is_record(value):
            for field_key in ("field", "fieldKey", "key"):
                field_value = value.get(field_key)
                if isinstance(field_value, str) and field_value in replacements:
                    value[field_key] = replacements[field_value]
                    return value
        return value

    list_keys = ("visibleProperties", "visible_properties", "columns")
    for key in list_keys:
        values = container.get(key)
        if isinstance(values, list):
            new_values = [replace_value(value) for value in _items(values, key)]
            if new_values != values:
                container[key] = new_values
                changed = True
    return changed


def _replace_view_sort_refs(container: Record, replacements: dict[str, str]) -> bool:
    """Update sort and filter fields in their existing traversal order."""

    changed = False
    sort_value = container.get("sort")
    sort_items = _items(sort_value, "sort") if isinstance(sort_value, list) else [sort_value]
    for item in sort_items:
        if _is_record(item):
            field = item.get("field")
            if isinstance(field, str) and field in replacements:
                item["field"] = replacements[field]
                changed = True
    for key in ("sorts", "filters"):
        values = container.get(key)
        if isinstance(values, list):
            for item in _items(values, key):
                if _is_record(item):
                    field = item.get("field")
                    if isinstance(field, str) and field in replacements:
                        item["field"] = replacements[field]
                        changed = True
    return changed


def _replace_view_field_refs(container: object, replacements: dict[str, str]) -> bool:
    """Rewrite field-name positions in a view without touching filter values."""

    if not _is_record(container):
        return False
    changed = _replace_view_list_refs(container, replacements)
    for key in ("groupBy", "dateField", "coverField", "groupSort"):
        value = container.get(key)
        if isinstance(value, str) and value in replacements:
            container[key] = replacements[value]
            changed = True
    changed = _replace_view_sort_refs(container, replacements) or changed
    for key in ("columnWidths", "aggregations"):
        values = container.get(key)
        if _is_record(values):
            for old, new in replacements.items():
                if old in values:
                    values[new] = values.pop(old)
                    changed = True
    for key in ("filterTree", "rules", "conditions", "children", "groups"):
        child = container.get(key)
        if isinstance(child, list):
            for item in _items(child, key):
                changed = _replace_view_field_refs(item, replacements) or changed
        elif _is_record(child):
            changed = _replace_view_field_refs(child, replacements) or changed
    return changed


def migrate_registry(registry: Record, locale: str) -> tuple[Record, dict[str, int]]:
    """Return a migrated registry and a compact change report."""

    _validate_registry(registry)
    migrated = deepcopy(registry)
    report = {"tables": 0, "properties_removed": 0, "views_updated": 0}
    replacements_by_table: dict[str, dict[str, str]] = {}
    for table in _records(migrated.get("tables", []) or [], "Registry tables"):
        before = deepcopy(_records(table.get("properties") or [], "Table properties"))
        # _records has already validated this dictionary's text keys.
        assert is_record(table)
        details = _record(ensure_system_date_properties(table, locale), "System date changes")
        replacements: dict[str, str] = {}
        for role, raw_detail in details.items():
            detail = _record(raw_detail, "System date change")
            target = str(detail["name"])
            for old_name in _strings(detail.get("old_names", []), "Old date names"):
                if old_name != target:
                    replacements[old_name] = target
            for prop in before:
                if prop.get("type") == ("created_time" if role == "created" else "last_edited_time"):
                    old_name = str(prop.get("name") or "").strip()
                    if old_name and old_name != target:
                        replacements[old_name] = target
            old_ids = set(_strings(detail.get("old_ids", []), "Old date IDs"))
            report["properties_removed"] += sum(
                1 for prop in before if str(prop.get("id") or "") in old_ids
            )
        table_id = str(table.get("id"))
        replacements_by_table[table_id] = replacements
        if before != table.get("properties"):
            report["tables"] += 1

    for view in _records(migrated.get("views", []) or [], "Registry views"):
        table_id = str(view.get("table_id") or "")
        replacements = replacements_by_table.get(table_id, {})
        if replacements and _replace_view_field_refs(view, replacements):
            report["views_updated"] += 1
    return migrated, report


def _page_date_source_keys(table: Record) -> dict[str, list[object]]:
    """Collect property names, aliases and IDs without normalizing their order."""

    old_by_role: dict[str, list[object]] = {"created": [], "modified": []}
    for prop in _records(table.get("properties", []) or [], "Table properties"):
        role = prop.get("system_date_role")
        if not isinstance(role, str) or role not in old_by_role:
            continue
        old_by_role[role].append(str(prop.get("name") or ""))
        old_by_role[role].extend(
            str(alias) for alias in _items(prop.get("aliases", []) or [], "Property aliases")
        )
        if prop.get("id"):
            old_by_role[role].append(str(prop["id"]))
    return old_by_role


def _migrate_page(
    path: Path,
    table: Record,
    locale: str,
    dry_run: bool,
    *,
    notion_dates_by_page: dict[str, dict[str, str]] | None = None,
    vault: Path | None = None,
    backup_root: Path | None = None,
) -> tuple[str, bool, str]:
    try:
        raw = path.read_text(encoding="utf-8")
        metadata, body = _parse_frontmatter(raw)
    except (OSError, UnicodeDecodeError):
        return "error:read", False, ""
    if not metadata:
        return "skipped:no-frontmatter", False, ""

    page_id = str(metadata.get("id") or "").strip()
    notion_dates = (notion_dates_by_page or {}).get(page_id)

    old_by_role = _page_date_source_keys(table)
    labels = system_date_labels(locale)
    for key in metadata:
        if key in _PROTECTED_METADATA:
            continue
        role = property_role({"name": key})
        if role and key not in old_by_role[role]:
            old_by_role[role].append(key)
    changed = False
    for role, target in labels.items():
        source_keys = [key for key in old_by_role[role] if key and key not in _PROTECTED_METADATA]
        legacy_keys = [key for key in source_keys if key != target]
        authoritative = (notion_dates or {}).get(role)
        value: object
        if authoritative:
            value = authoritative
        else:
            value = next(
                (metadata[key] for key in legacy_keys if metadata.get(key) not in (None, "", [])),
                metadata.get(target),
            )
        if value in (None, "", []):
            value = _iso_from_stat(path, creation=role == "created")
        if metadata.get(target) != value:
            metadata[target] = value
            changed = True
        for key in source_keys:
            if key != target and key in metadata:
                del metadata[key]
                changed = True

    if not changed:
        return "clean", notion_dates is not None, page_id
    if not dry_run:
        if backup_root is not None and vault is not None:
            backup_path = backup_root / path.relative_to(vault)
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup_path)
        safe_write_text(path, _render_frontmatter(metadata, body))
    return "migrated", notion_dates is not None, page_id


def run_migration(
    vault: Path,
    locale: str,
    dry_run: bool,
    *,
    notion_index: NotionTimestampIndex | None = None,
    notion_report: dict[str, int] | None = None,
    backup_root: Path | None = None,
) -> dict[str, int | str]:
    registry_path = vault / "BD" / "vault_db_registry.json"
    raw_registry: object = json.loads(registry_path.read_text(encoding="utf-8"))
    registry = _record(raw_registry, "Registry")
    new_registry, report = migrate_registry(registry, locale)
    roots = _table_roots(vault, new_registry)
    report.update(notion_report or {})
    report.update({
        "pages": 0,
        "page_errors": 0,
        "backup_files": 0,
        "notion_local_matches": 0,
        "notion_local_unmatched": 0,
        "notion_source_unmatched": 0,
    })
    matched_source_rows: set[tuple[str, str]] = set()

    registry_changed = new_registry != registry
    sibling_backup: Path | None = None
    if not dry_run and registry_changed:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        sibling_backup = registry_path.with_name(
            f"vault_db_registry.bak-system-dates-{stamp}.json"
        )
        shutil.copy2(registry_path, sibling_backup)
    if not dry_run and backup_root is not None:
        registry_backup = backup_root / registry_path.relative_to(vault)
        registry_backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(registry_path, registry_backup)
        report["backup_files"] += 1

    for table in _records(new_registry.get("tables", []) or [], "Registry tables"):
        table_id = str(table.get("id") or "")
        root = roots.get(table_id)
        if not root:
            continue
        notion_dates_by_page = (
            (notion_index or {}).get(table_id) if notion_index is not None else None
        )
        for path in _iter_table_pages(root):
            result, matched_notion, page_id = _migrate_page(
                path,
                table,
                locale,
                dry_run,
                notion_dates_by_page=notion_dates_by_page,
                vault=vault,
                backup_root=backup_root,
            )
            if result == "migrated":
                report["pages"] += 1
                if not dry_run and backup_root is not None:
                    report["backup_files"] += 1
            elif result.startswith("error:"):
                report["page_errors"] += 1
            if notion_index is not None and page_id:
                if matched_notion:
                    report["notion_local_matches"] += 1
                    matched_source_rows.add((table_id, page_id))
                else:
                    report["notion_local_unmatched"] += 1

    if notion_index is not None:
        indexed_rows = sum(len(rows) for rows in notion_index.values())
        report["notion_source_unmatched"] = max(
            0, indexed_rows - len(matched_source_rows)
        )

    if not dry_run and registry_changed:
        safe_write_text(
            registry_path,
            json.dumps(new_registry, ensure_ascii=False, indent=2) + "\n",
        )
        report["registry_backup"] = 1
    else:
        report["registry_backup"] = 0
    # Counters stay numeric; the CLI report also includes optional backup paths.
    result_report: dict[str, int | str] = dict(report)
    if backup_root is not None and not dry_run:
        result_report["backup_root"] = str(backup_root)
    if sibling_backup is not None:
        result_report["registry_backup_path"] = str(sibling_backup)
    return result_report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, default=None, help="Vault root; defaults to DIGITAL_BRAIN_VAULT_PATH")
    parser.add_argument("--locale", default="ca", help="Active locale (ca, en, es, fr)")
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing")
    parser.add_argument(
        "--notion",
        action="store_true",
        help="Use authoritative Notion creation and modification timestamps",
    )
    parser.add_argument(
        "--notion-config",
        type=Path,
        help="Notion import configuration; defaults to GNOSI_DATA_DIR/system/notion_import_config.json",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Parent directory for recoverable backups; defaults to GNOSI_DATA_DIR/backups",
    )
    args = parser.parse_args()
    vault_arg = args.vault or os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    if not vault_arg:
        parser.error("--vault or DIGITAL_BRAIN_VAULT_PATH is required")

    local_data = resolve_data_dir()
    notion_index: NotionTimestampIndex | None = None
    notion_report: dict[str, int] = {}
    if args.notion:
        config_path = (
            args.notion_config or local_data / "system" / "notion_import_config.json"
        ).expanduser().resolve()
        try:
            raw_config: object = json.loads(config_path.read_text(encoding="utf-8"))
            config = _record(raw_config, "Notion import configuration")
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                f"Cannot read Notion import configuration: {config_path}"
            ) from exc
        from backend.services.integration_manager import integration_manager
        from backend.services.notion_importer import NotionClient

        token = str((integration_manager.get_raw("notion") or {}).get("token") or "")
        if not token:
            raise RuntimeError("No Notion REST integration token is configured")
        notion_index, notion_report = build_notion_timestamp_index(
            NotionClient(token), config
        )
        missing_dates = notion_report.get("notion_rows_without_dates", 0)
        if missing_dates:
            raise RuntimeError(
                f"Notion returned {missing_dates} rows without complete audit timestamps"
            )

    backup_root = None
    if not args.dry_run:
        backup_parent = (
            args.backup_dir or local_data / "backups"
        ).expanduser().resolve()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_root = backup_parent / f"table-system-dates-{stamp}"

    try:
        report = run_migration(
            Path(vault_arg).expanduser().resolve(),
            args.locale,
            args.dry_run,
            notion_index=notion_index,
            notion_report=notion_report,
            backup_root=backup_root,
        )
    except (ValueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if (
        report.get("page_errors", 0) == 0
        and report.get("notion_rows_without_dates", 0) == 0
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
