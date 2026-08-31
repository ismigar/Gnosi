#!/usr/bin/env python3
"""Compact imported Notion views without deleting live page embeds.

The command is dry-run by default. ``--apply`` writes an atomic registry update
and rewrites Markdown embed IDs through the generated alias map. Orphan removal
is opt-in with ``--prune-orphans`` because an interrupted clone must not be
mistaken for a complete clone.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Iterable, Mapping
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

GNOSI_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(GNOSI_ROOT))

from backend.services.notion_view_recreator import (  # noqa: E402
    deduplicate_view_definitions,
)

EMBED_RE = re.compile(
    r'(?P<prefix><!--\s*gnosi-view:def\s+\{"view_id":")'
    r'(?P<id>[0-9a-f-]{36})(?P<suffix>"\}\s*-->)',
    re.IGNORECASE,
)
SKIP_DIRS = {".git", ".history", ".trash", ".gnosi", "Assets"}


def _iter_markdown(vault_dir: Path) -> Iterable[Path]:
    for root, directories, filenames in os.walk(vault_dir):
        directories[:] = [name for name in directories if name not in SKIP_DIRS]
        for filename in filenames:
            if Path(filename).suffix.lower() not in {".md", ".markdown"}:
                continue
            yield Path(root) / filename


def _read_embed_ids(vault_dir: Path) -> set[str]:
    ids: set[str] = set()
    for path in _iter_markdown(vault_dir):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise ValueError(f"Cannot safely inspect embeds: {path}") from exc
        ids.update(match.group("id") for match in EMBED_RE.finditer(text))
    return ids


def _object(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{context} must be an object")
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ValueError(f"{context} keys must be strings")
        result[key] = item
    return result


def _tabs(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("View tabs must be a list of IDs")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError("View tabs must contain nonempty string IDs")
        result.append(item)
    return result


def _views(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError("The registry does not contain a valid views list")
    result: list[dict[str, object]] = []
    seen: set[str] = set()
    for item in value:
        view = _object(item, "View")
        view_id = view.get("id")
        if not isinstance(view_id, str) or not view_id.strip():
            raise ValueError("View id must be a nonempty string")
        if view_id in seen:
            raise ValueError(f"Duplicate registry view ID: {view_id}")
        seen.add(view_id)
        _tabs(view.get("tabs"))
        if view.get("embedded") is True:
            filters = view.get("filters")
            if filters is not None and not isinstance(filters, list):
                raise ValueError("Embedded view filters must be a list")
        result.append(view)
    return result


def _expand_tab_references(
    views: list[dict[str, object]], referenced: set[str]
) -> set[str]:
    """Keep anchors and all of their tabs, including nested legacy tabs."""
    by_id = {str(view.get("id")): view for view in views if view.get("id")}
    expanded = set(referenced)
    pending = list(referenced)
    while pending:
        current = pending.pop()
        for tab_id in _tabs(by_id.get(current, {}).get("tabs")):
            if tab_id not in expanded:
                expanded.add(tab_id)
                pending.append(tab_id)
    return expanded


def _rewrite_markdown(vault_dir: Path, aliases: dict[str, str], apply: bool) -> int:
    changes: list[tuple[Path, str]] = []
    if not aliases:
        return 0

    def replace(match: re.Match[str]) -> str:
        return f'{match.group("prefix")}{aliases.get(match.group("id"), match.group("id"))}{match.group("suffix")}'

    for path in _iter_markdown(vault_dir):
        try:
            original = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise ValueError(f"Cannot safely rewrite embeds: {path}") from exc
        updated = EMBED_RE.sub(replace, original)
        if updated == original:
            continue
        changes.append((path, updated))
    if apply:
        for path, updated in changes:
            _atomic_write_text(path, updated)
    return len(changes)


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(text)
        temp_path = Path(handle.name)
    temp_path.replace(path)


def _load_registry(path: Path) -> dict[str, object]:
    with path.open(encoding="utf-8") as handle:
        registry = _object(json.load(handle), "Registry")
    _views(registry.get("views"))
    return registry


def _write_registry(path: Path, registry: dict[str, object]) -> Path:
    _views(registry.get("views"))
    rendered = json.dumps(registry, ensure_ascii=False, indent=2) + "\n"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = path.with_name(f"{path.stem}.bak-view-cleanup-{stamp}{path.suffix}")
    path.replace(backup)
    _atomic_write_text(path, rendered)
    return backup


def compact_registry(
    registry: Mapping[str, object], table_id: str | None, prune_orphans: bool,
    referenced_ids: set[str],
) -> tuple[dict[str, object], dict[str, str], list[str]]:
    """Return compacted registry, aliases, and safe orphan IDs."""
    views = _views(deepcopy(registry.get("views")))
    selected = [view for view in views if not table_id or view.get("table_id") == table_id]
    _, aliases = deduplicate_view_definitions(deepcopy(selected))
    by_id = {str(view["id"]): view for view in views}
    # A shared source ID alone does not establish equal user-edited payloads.
    # Refuse conflicting metadata instead of silently losing a duplicate's data.
    for old_id, new_id in aliases.items():
        old, new = by_id[old_id], by_id[new_id]
        ignored = {"id", "tabs", "order", "is_main", "hidden"}
        if ({k: v for k, v in old.items() if k not in ignored}
                != {k: v for k, v in new.items() if k not in ignored}):
            raise ValueError(f"Conflicting duplicate view payloads: {old_id}, {new_id}")
        if "tabs" in old:
            new["tabs"] = _tabs(new.get("tabs")) + _tabs(old.get("tabs"))

    all_compacted = [view for view in views if view["id"] not in aliases]
    if aliases:
        for view in all_compacted:
            if "tabs" not in view:
                continue
            resolved: list[str] = []
            for tab_id in _tabs(view.get("tabs")):
                target = aliases.get(tab_id, tab_id)
                if target != view["id"] and target not in resolved:
                    resolved.append(target)
            view["tabs"] = resolved

    if aliases:
        referenced_ids = {aliases.get(view_id, view_id) for view_id in referenced_ids}
    referenced_with_tabs = _expand_tab_references(all_compacted, referenced_ids)
    orphan_ids: list[str] = []
    if prune_orphans:
        retained: list[dict[str, object]] = []
        for view in all_compacted:
            view_id = str(view.get("id") or "")
            is_orphan = (
                bool(view_id)
                and (not table_id or view.get("table_id") == table_id)
                and view.get("embedded") is True
                and view_id not in referenced_with_tabs
            )
            if is_orphan:
                orphan_ids.append(view_id)
            else:
                retained.append(view)
        all_compacted = retained

    return {**registry, "views": all_compacted}, aliases, orphan_ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault-dir", required=True)
    parser.add_argument("--table-id", default=None)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--prune-orphans", action="store_true",
        help="remove embedded views not referenced by Markdown or tabs",
    )
    args = parser.parse_args()

    vault_dir = Path(args.vault_dir).expanduser().resolve()
    registry_path = vault_dir / "BD" / "vault_db_registry.json"
    registry = _load_registry(registry_path)
    referenced_ids = _read_embed_ids(vault_dir)
    compacted, aliases, orphan_ids = compact_registry(
        registry, args.table_id, args.prune_orphans, referenced_ids
    )
    before = len(_views(registry.get("views")))
    after = len(_views(compacted.get("views")))
    changed_files = _rewrite_markdown(vault_dir, aliases, args.apply)

    summary = {
        "mode": "apply" if args.apply else "dry-run",
        "registry": str(registry_path),
        "views_before": before,
        "views_after": after,
        "deduplicated": len(aliases),
        "orphans": len(orphan_ids),
        "markdown_files_rewritten": changed_files,
        "orphan_ids": orphan_ids[:20],
    }
    if args.apply and compacted != registry:
        backup = _write_registry(registry_path, compacted)
        summary["backup"] = str(backup)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
