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
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Dict, Iterable, List, Set

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


def _read_embed_ids(vault_dir: Path) -> Set[str]:
    ids: Set[str] = set()
    for path in _iter_markdown(vault_dir):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        ids.update(match.group("id") for match in EMBED_RE.finditer(text))
    return ids


def _expand_tab_references(views: List[Dict], referenced: Set[str]) -> Set[str]:
    """Keep anchors and all of their tabs, including nested legacy tabs."""
    by_id = {str(view.get("id")): view for view in views if view.get("id")}
    expanded = set(referenced)
    pending = list(referenced)
    while pending:
        current = pending.pop()
        for tab_id in by_id.get(current, {}).get("tabs") or []:
            tab_id = str(tab_id)
            if tab_id not in expanded:
                expanded.add(tab_id)
                pending.append(tab_id)
    return expanded


def _rewrite_markdown(vault_dir: Path, aliases: Dict[str, str], apply: bool) -> int:
    changed = 0
    if not aliases:
        return changed

    def replace(match: re.Match[str]) -> str:
        return f'{match.group("prefix")}{aliases.get(match.group("id"), match.group("id"))}{match.group("suffix")}'

    for path in _iter_markdown(vault_dir):
        try:
            original = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        updated = EMBED_RE.sub(replace, original)
        if updated == original:
            continue
        changed += 1
        if apply:
            _atomic_write_text(path, updated)
    return changed


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(text)
        temp_path = Path(handle.name)
    temp_path.replace(path)


def _load_registry(path: Path) -> Dict:
    with path.open(encoding="utf-8") as handle:
        registry = json.load(handle)
    if not isinstance(registry, dict) or not isinstance(registry.get("views"), list):
        raise ValueError("The registry does not contain a valid views list")
    return registry


def _write_registry(path: Path, registry: Dict) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = path.with_name(f"{path.stem}.bak-view-cleanup-{stamp}{path.suffix}")
    path.replace(backup)
    _atomic_write_text(path, json.dumps(registry, ensure_ascii=False, indent=2) + "\n")
    return backup


def compact_registry(registry: Dict, table_id: str | None, prune_orphans: bool,
                     referenced_ids: Set[str]) -> tuple[Dict, Dict[str, str], List[str]]:
    """Return compacted registry, aliases, and safe orphan IDs."""
    views = registry.get("views") or []
    selected = [view for view in views if not table_id or view.get("table_id") == table_id]
    untouched = [view for view in views if table_id and view.get("table_id") != table_id]
    compacted_selected, aliases = deduplicate_view_definitions(selected)

    if aliases:
        referenced_ids = {aliases.get(view_id, view_id) for view_id in referenced_ids}
    all_compacted = untouched + compacted_selected
    referenced_with_tabs = _expand_tab_references(all_compacted, referenced_ids)
    orphan_ids: List[str] = []
    if prune_orphans:
        retained: List[Dict] = []
        for view in compacted_selected:
            view_id = str(view.get("id") or "")
            is_orphan = (
                bool(view_id)
                and view.get("embedded") is True
                and view_id not in referenced_with_tabs
            )
            if is_orphan:
                orphan_ids.append(view_id)
            else:
                retained.append(view)
        compacted_selected = retained

    return {**registry, "views": untouched + compacted_selected}, aliases, orphan_ids


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
    before = len(registry.get("views") or [])
    after = len(compacted.get("views") or [])
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
