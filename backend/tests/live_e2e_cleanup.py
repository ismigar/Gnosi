"""Strict, idempotent cleanup helpers for opt-in live Vault tests."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from pathlib import PurePosixPath
from typing import Protocol
from uuid import UUID

from backend.domains.vault.registry.records import is_record


_OWNED_TITLE = re.compile(
    r"^pytest-(?:etag|trash(?:-(?:a|b|needle))?)-[0-9a-f]{8}$"
)


class DeleteResponse(Protocol):
    """Minimum response contract needed by the cleanup boundary."""

    status_code: int


DeleteRequest = Callable[[str], DeleteResponse]


def _owned_page_id(item: object) -> str | None:
    if not is_record(item):
        return None
    title = item.get("title")
    page_id = item.get("id")
    if not isinstance(title, str) or not _OWNED_TITLE.fullmatch(title):
        return None
    if not isinstance(page_id, str):
        return None
    try:
        parsed = UUID(page_id)
    except ValueError:
        return None
    if str(parsed) != page_id.lower():
        return None
    if title.startswith("pytest-etag-") and not parsed.hex.startswith(
        title.rsplit("-", 1)[-1]
    ):
        return None
    return page_id


def select_owned_active_page_ids(payload: object) -> list[str]:
    """Return only IDs produced by the known opt-in live page tests."""
    if not isinstance(payload, list):
        return []
    return [page_id for item in payload if (page_id := _owned_page_id(item))]


def select_owned_trash_entry_ids(payload: object) -> list[str]:
    """Select test-owned Trash entries using title, UUID and original path."""
    if not is_record(payload):
        return []
    items = payload.get("items")
    if not isinstance(items, list):
        return []

    selected: list[str] = []
    for item in items:
        page_id = _owned_page_id(item)
        if page_id is None or not is_record(item):
            continue
        title = item.get("title")
        original_path = item.get("original_path")
        if not isinstance(title, str) or not isinstance(original_path, str):
            continue
        original_name = PurePosixPath(original_path.replace("\\", "/")).name
        suffix = PurePosixPath(original_name).suffix.lower()
        if suffix not in {".md", ".json"}:
            continue
        if original_name.removesuffix(suffix) != title:
            continue
        selected.append(page_id)
    return selected


def cleanup_live_test_page(
    backend_url: str,
    page_id: str,
    delete_request: DeleteRequest,
) -> tuple[int, int]:
    """Soft-delete and then purge one exact test page, tolerating absence."""
    soft_delete = delete_request(f"{backend_url}/api/vault/pages/{page_id}")
    if soft_delete.status_code not in {200, 404}:
        raise RuntimeError(
            f"Live test soft-delete failed for {page_id}: {soft_delete.status_code}"
        )
    purge = delete_request(f"{backend_url}/api/vault/trash/{page_id}")
    if purge.status_code not in {200, 404}:
        raise RuntimeError(
            f"Live test purge failed for {page_id}: {purge.status_code}"
        )
    return soft_delete.status_code, purge.status_code


def unique_page_ids(groups: Iterable[Iterable[str]]) -> list[str]:
    """Preserve first-seen order while de-duplicating cleanup candidates."""
    seen: set[str] = set()
    result: list[str] = []
    for group in groups:
        for page_id in group:
            if page_id in seen:
                continue
            seen.add(page_id)
            result.append(page_id)
    return result


__all__ = [
    "cleanup_live_test_page",
    "select_owned_active_page_ids",
    "select_owned_trash_entry_ids",
    "unique_page_ids",
]
