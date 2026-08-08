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
from typing import Any, Dict, Iterable, Optional, Tuple

import yaml

_HERE = Path(__file__).resolve()
_ROOT = _HERE.parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

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


def _parse_frontmatter(raw: str) -> Tuple[Dict[str, Any], str]:
    match = _FM_RE.match(raw)
    if not match:
        return {}, raw
    try:
        metadata = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return {}, raw
    return (metadata if isinstance(metadata, dict) else {}), raw[match.end() :]


def _render_frontmatter(metadata: Dict[str, Any], body: str) -> str:
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


def _table_roots(vault: Path, registry: Dict[str, Any]) -> Dict[str, Path]:
    databases = {
        str(db.get("id")): str(db.get("folder") or "")
        for db in registry.get("databases", []) or []
        if isinstance(db, dict) and db.get("id")
    }
    roots: Dict[str, Path] = {}
    for table in registry.get("tables", []) or []:
        if not isinstance(table, dict) or not table.get("id"):
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


def _table_id_for_page(path: Path, roots: Dict[str, Path], metadata: Dict[str, Any]) -> Optional[str]:
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


def _replace_view_field_refs(container: Any, replacements: Dict[str, str]) -> bool:
    """Rewrite field-name positions in a view without touching filter values."""

    if not isinstance(container, dict):
        return False
    changed = False
    def replace_value(value: Any) -> Any:
        if isinstance(value, str):
            return replacements.get(value, value)
        if isinstance(value, dict):
            for field_key in ("field", "fieldKey", "key"):
                field_value = value.get(field_key)
                if isinstance(field_value, str) and field_value in replacements:
                    value[field_key] = replacements[field_value]
                    return value
        return value

    list_keys = ("visibleProperties", "visible_properties", "columns")
    scalar_keys = ("groupBy", "dateField", "coverField", "groupSort")
    for key in list_keys:
        values = container.get(key)
        if isinstance(values, list):
            new_values = [replace_value(value) for value in values]
            if new_values != values:
                container[key] = new_values
                changed = True
    for key in scalar_keys:
        value = container.get(key)
        if isinstance(value, str) and value in replacements:
            container[key] = replacements[value]
            changed = True
    sort_value = container.get("sort")
    sort_items = sort_value if isinstance(sort_value, list) else [sort_value]
    for item in sort_items:
        if isinstance(item, dict) and item.get("field") in replacements:
            item["field"] = replacements[item["field"]]
            changed = True
    for key in ("sorts", "filters"):
        values = container.get(key)
        if isinstance(values, list):
            for item in values:
                if (
                    isinstance(item, dict)
                    and isinstance(item.get("field"), str)
                    and item.get("field") in replacements
                ):
                    item["field"] = replacements[item["field"]]
                    changed = True
    for key in ("columnWidths", "aggregations"):
        values = container.get(key)
        if isinstance(values, dict):
            for old, new in replacements.items():
                if old in values:
                    values[new] = values.pop(old)
                    changed = True
    for key in ("filterTree", "rules", "conditions", "children", "groups"):
        child = container.get(key)
        if isinstance(child, list):
            for item in child:
                changed = _replace_view_field_refs(item, replacements) or changed
        elif isinstance(child, dict):
            changed = _replace_view_field_refs(child, replacements) or changed
    return changed


def migrate_registry(registry: Dict[str, Any], locale: str) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """Return a migrated registry and a compact change report."""

    migrated = deepcopy(registry)
    report = {"tables": 0, "properties_removed": 0, "views_updated": 0}
    replacements_by_table: Dict[str, Dict[str, str]] = {}
    for table in migrated.get("tables", []) or []:
        if not isinstance(table, dict):
            continue
        before = deepcopy(table.get("properties") or [])
        details = ensure_system_date_properties(table, locale)
        replacements: Dict[str, str] = {}
        for role, detail in details.items():
            target = str(detail["name"])
            for old_name in detail.get("old_names", []):
                if old_name != target:
                    replacements[old_name] = target
            for prop in before:
                if prop.get("type") == ("created_time" if role == "created" else "last_edited_time"):
                    old_name = str(prop.get("name") or "").strip()
                    if old_name and old_name != target:
                        replacements[old_name] = target
            old_ids = set(detail.get("old_ids", []))
            report["properties_removed"] += sum(
                1 for prop in before if str(prop.get("id") or "") in old_ids
            )
        table_id = str(table.get("id"))
        replacements_by_table[table_id] = replacements
        if before != table.get("properties"):
            report["tables"] += 1

    for view in migrated.get("views", []) or []:
        if not isinstance(view, dict):
            continue
        table_id = str(view.get("table_id") or "")
        replacements = replacements_by_table.get(table_id, {})
        if replacements and _replace_view_field_refs(view, replacements):
            report["views_updated"] += 1
    return migrated, report


def _migrate_page(path: Path, table: Dict[str, Any], locale: str, dry_run: bool) -> str:
    try:
        raw = path.read_text(encoding="utf-8")
        metadata, body = _parse_frontmatter(raw)
    except (OSError, UnicodeDecodeError):
        return "error:read"
    if not metadata:
        return "skipped:no-frontmatter"

    old_by_role: Dict[str, list[str]] = {"created": [], "modified": []}
    for prop in table.get("properties", []) or []:
        role = prop.get("system_date_role")
        if role not in old_by_role:
            continue
        old_by_role[role].append(str(prop.get("name") or ""))
        old_by_role[role].extend(str(alias) for alias in prop.get("aliases", []) or [])
        if prop.get("id"):
            old_by_role[role].append(str(prop["id"]))

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
        return "clean"
    if not dry_run:
        safe_write_text(path, _render_frontmatter(metadata, body))
    return "migrated"


def run_migration(vault: Path, locale: str, dry_run: bool) -> Dict[str, int]:
    registry_path = vault / "BD" / "vault_db_registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    new_registry, report = migrate_registry(registry, locale)
    roots = _table_roots(vault, new_registry)
    report.update({"pages": 0, "page_errors": 0})
    for table in new_registry.get("tables", []) or []:
        table_id = str(table.get("id") or "")
        root = roots.get(table_id)
        if not root:
            continue
        for path in _iter_table_pages(root):
            result = _migrate_page(path, table, locale, dry_run)
            if result == "migrated":
                report["pages"] += 1
            elif result.startswith("error:"):
                report["page_errors"] += 1

    if not dry_run and new_registry != registry:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = registry_path.with_name(f"vault_db_registry.bak-system-dates-{stamp}.json")
        shutil.copy2(registry_path, backup)
        safe_write_text(
            registry_path,
            json.dumps(new_registry, ensure_ascii=False, indent=2) + "\n",
        )
        report["registry_backup"] = 1
    else:
        report["registry_backup"] = 0
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, default=None, help="Vault root; defaults to DIGITAL_BRAIN_VAULT_PATH")
    parser.add_argument("--locale", default="ca", help="Active locale (ca, en, es, fr)")
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing")
    args = parser.parse_args()
    vault_arg = args.vault or os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    if not vault_arg:
        parser.error("--vault or DIGITAL_BRAIN_VAULT_PATH is required")
    report = run_migration(Path(vault_arg).expanduser().resolve(), args.locale, args.dry_run)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report.get("page_errors", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
