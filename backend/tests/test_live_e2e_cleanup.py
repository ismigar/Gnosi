"""Hermetic coverage for strict live-test artifact cleanup."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from backend.tests.live_e2e_cleanup import (
    cleanup_live_test_page,
    select_owned_active_page_ids,
    select_owned_trash_entry_ids,
    unique_page_ids,
)


ETAG_ID = "12345678-1234-4234-8234-123456789abc"
TRASH_ID = "abcdef12-1234-4234-8234-123456789abc"


def test_active_selector_accepts_only_owned_shapes() -> None:
    payload: object = [
        {"id": ETAG_ID, "title": "pytest-etag-12345678"},
        {"id": TRASH_ID, "title": "pytest-trash-a-deadbeef"},
        {"id": TRASH_ID, "title": "pytest-private-deadbeef"},
        {"id": "not-a-uuid", "title": "pytest-trash-deadbeef"},
        {"id": ETAG_ID, "title": "pytest-etag-deadbeef"},
        {"id": TRASH_ID, "title": "My pytest-trash-a-deadbeef note"},
    ]

    assert select_owned_active_page_ids(payload) == [ETAG_ID, TRASH_ID]
    assert select_owned_active_page_ids({"items": payload}) == []


def test_trash_selector_requires_exact_original_basename() -> None:
    payload: object = {
        "items": [
            {
                "id": ETAG_ID,
                "title": "pytest-etag-12345678",
                "original_path": "tests/pytest-etag-12345678.md",
            },
            {
                "id": TRASH_ID,
                "title": "pytest-trash-abcdef12",
                "original_path": "pytest-trash-abcdef12.json",
            },
            {
                "id": TRASH_ID,
                "title": "pytest-trash-abcdef12",
                "original_path": "personal-note.md",
            },
            {
                "id": TRASH_ID,
                "title": "pytest-trash-abcdef12",
                "original_path": None,
            },
        ]
    }

    assert select_owned_trash_entry_ids(payload) == [ETAG_ID, TRASH_ID]


@dataclass
class _Response:
    status_code: int


def test_cleanup_soft_deletes_before_exact_purge() -> None:
    calls: list[str] = []

    def delete_request(url: str) -> _Response:
        calls.append(url)
        return _Response(404 if "/pages/" in url else 200)

    assert cleanup_live_test_page("http://backend", ETAG_ID, delete_request) == (
        404,
        200,
    )
    assert calls == [
        f"http://backend/api/vault/pages/{ETAG_ID}",
        f"http://backend/api/vault/trash/{ETAG_ID}",
    ]


def test_cleanup_stops_before_purge_when_soft_delete_fails() -> None:
    calls: list[str] = []

    def delete_request(url: str) -> _Response:
        calls.append(url)
        return _Response(500)

    with pytest.raises(RuntimeError, match="soft-delete failed"):
        cleanup_live_test_page("http://backend", ETAG_ID, delete_request)
    assert calls == [f"http://backend/api/vault/pages/{ETAG_ID}"]


def test_unique_page_ids_preserves_order() -> None:
    assert unique_page_ids([[ETAG_ID, TRASH_ID], [TRASH_ID, ETAG_ID]]) == [
        ETAG_ID,
        TRASH_ID,
    ]
