"""Serialized recomputation of formulas that depend on other table rows."""

from __future__ import annotations

import logging
from _thread import LockType
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict


Metadata = dict[str, Any]


class RecalculationState(TypedDict):
    running: bool
    pending: bool
    last_run: float


@dataclass(frozen=True)
class FormulaRecalculationDependencies:
    """Ports and shared state needed by cross-record formula recomputation."""

    lock: LockType
    states: dict[str, RecalculationState]
    monotonic: Callable[[], float]
    cooldown_seconds: float
    vault_root: Callable[[], Path]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    table_has_cross_record_formulas: Callable[[str], bool]
    process_updates: Callable[[str, Metadata, Metadata], Metadata]
    save_page: Callable[[Path, Metadata, str], None]
    refresh_page_index: Callable[[Path, Metadata, str], None]
    invalidate_pages_cache: Callable[[], None]
    logger: logging.Logger


def _default_state(*, running: bool = False) -> RecalculationState:
    return {"running": running, "pending": False, "last_run": 0.0}


def _request_run(
    table_id: str,
    dependencies: FormulaRecalculationDependencies,
) -> bool:
    with dependencies.lock:
        state = dependencies.states.setdefault(table_id, _default_state())
        now = dependencies.monotonic()
        if state["running"]:
            state["pending"] = True
            return False
        if now - state["last_run"] < dependencies.cooldown_seconds:
            state["pending"] = True
            return False
        state["running"] = True
        return True


def _reset_pending(
    table_id: str,
    dependencies: FormulaRecalculationDependencies,
) -> None:
    with dependencies.lock:
        state = dependencies.states.setdefault(table_id, _default_state(running=True))
        state["pending"] = False


def _has_cross_record_formulas(
    table_id: str,
    dependencies: FormulaRecalculationDependencies,
) -> bool:
    try:
        return dependencies.table_has_cross_record_formulas(table_id)
    except Exception as exc:
        dependencies.logger.warning(
            "Could not validate cross-record formulas for table %s: %s",
            table_id,
            exc,
        )
        return False


def _table_rows(
    table_id: str,
    exclude_page_id: str | None,
    dependencies: FormulaRecalculationDependencies,
) -> Iterator[tuple[Path, str, Metadata, str]]:
    for file_path in dependencies.vault_root().rglob("*.md"):
        relative_parts = file_path.relative_to(dependencies.vault_root()).parts
        if any(part.startswith(".") for part in relative_parts):
            continue
        try:
            raw = file_path.read_text(encoding="utf-8")
            metadata, body = dependencies.parse_frontmatter(raw, file_path)
        except Exception:
            continue
        page_id = str(metadata.get("id") or file_path.stem)
        if exclude_page_id and page_id == exclude_page_id:
            continue
        if metadata.get("is_template") is True:
            continue
        row_table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if row_table_id == table_id:
            yield file_path, page_id, metadata, body


def _recompute_row(
    table_id: str,
    file_path: Path,
    page_id: str,
    metadata: Metadata,
    body: str,
    dependencies: FormulaRecalculationDependencies,
) -> bool:
    original = metadata.copy()
    try:
        updated = dependencies.process_updates(page_id, original, original.copy())
    except Exception as exc:
        dependencies.logger.warning(
            "Error recomputing row %s from table %s: %s",
            page_id,
            table_id,
            exc,
        )
        return False
    if updated == original:
        return False
    try:
        dependencies.save_page(file_path, updated, body)
        dependencies.refresh_page_index(file_path, updated, body)
        return True
    except Exception as exc:
        dependencies.logger.warning(
            "Error saving recomputation for %s: %s",
            page_id,
            exc,
        )
        return False


def _run_pass(
    table_id: str,
    exclude_page_id: str | None,
    dependencies: FormulaRecalculationDependencies,
) -> None:
    any_written = False
    for file_path, page_id, metadata, body in _table_rows(
        table_id,
        exclude_page_id,
        dependencies,
    ):
        row_written = _recompute_row(
            table_id,
            file_path,
            page_id,
            metadata,
            body,
            dependencies,
        )
        any_written = row_written or any_written
    if any_written:
        dependencies.invalidate_pages_cache()


def _finish_pass(
    table_id: str,
    dependencies: FormulaRecalculationDependencies,
) -> bool:
    with dependencies.lock:
        state = dependencies.states.setdefault(table_id, _default_state(running=True))
        state["last_run"] = dependencies.monotonic()
        return state["pending"]


def _release_run(
    table_id: str,
    dependencies: FormulaRecalculationDependencies,
) -> None:
    with dependencies.lock:
        state = dependencies.states.setdefault(table_id, _default_state())
        state["running"] = False


def recompute_cross_record_formulas_for_table(
    table_id: str,
    exclude_page_id: str | None,
    dependencies: FormulaRecalculationDependencies,
) -> None:
    """Serialize formula passes and coalesce concurrent rerun requests."""
    if not table_id or not _request_run(table_id, dependencies):
        return
    try:
        while True:
            _reset_pending(table_id, dependencies)
            if not _has_cross_record_formulas(table_id, dependencies):
                break
            _run_pass(table_id, exclude_page_id, dependencies)
            if not _finish_pass(table_id, dependencies):
                break
    finally:
        _release_run(table_id, dependencies)


__all__ = [
    "FormulaRecalculationDependencies",
    "RecalculationState",
    "recompute_cross_record_formulas_for_table",
]
