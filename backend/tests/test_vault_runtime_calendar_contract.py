"""Characterize native page-runtime boundaries without provider operations."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import BackgroundTasks

from backend.api import vault_routes
from backend.domains.vault.pages import runtime
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.services import google_calendar_service


@pytest.mark.parametrize("uid", [17, {"raw": "id"}, ["opaque"]])
def test_calendar_task_retains_raw_id_and_payload(
    monkeypatch: pytest.MonkeyPatch, uid: object
) -> None:
    tasks = BackgroundTasks()
    title = {"opaque": True}
    start = ["raw-date"]
    end = {"raw": "end"}

    def update(email: str, event_uid: object, patch: dict[str, object]) -> bool:
        raise AssertionError("Scheduling must not execute the provider callback")

    monkeypatch.setattr(google_calendar_service, "update_google_event", update)
    runtime.sync_to_google_calendar_if_needed(
        {"source": "Google Calendar (fixture@example.invalid)", "uid": uid,
         "title": title, "date": start, "end_date": end},
        tasks,
    )
    assert len(tasks.tasks) == 1
    task = tasks.tasks[0]
    assert task.func is update
    assert task.args[0] == "fixture@example.invalid"
    assert task.args[1] is uid
    patch = task.args[2]
    assert isinstance(patch, dict)
    assert patch["summary"] is title
    assert patch["start"] is start
    assert patch["end"] is end


@pytest.mark.parametrize("source", [None, 7, object()])
def test_calendar_source_retains_native_membership_error(source: object) -> None:
    with pytest.raises(TypeError):
        runtime.sync_to_google_calendar_if_needed({"source": source, "uid": "id"}, BackgroundTasks())


@pytest.mark.parametrize(
    ("metadata", "expected"),
    [(None, False), ({}, False), ({"note_type": "daily", "source": 7}, False),
     ({"date": "2026-01-01"}, True),
     ({"date": "2026-01-01", "source": " GNOSI ", "table_id": "t"}, True),
     ({"date": "2026-01-01", "source": "other", "table_id": "t"}, False)],
)
def test_calendar_classification(metadata: PageMetadata | None, expected: bool) -> None:
    assert runtime.is_calendar_entry(metadata) is expected


def test_calendar_source_keeps_native_attribute_error() -> None:
    with pytest.raises(AttributeError):
        runtime.is_calendar_entry({"source": 7, "date": "2026-01-01"})


def test_link_view_retains_late_bound_state_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    outlinks = {"synthetic": {"child"}}
    monkeypatch.setattr(vault_routes, "_outlinks_by_source", outlinks)
    view = runtime._link_index_view()
    assert view.outlinks_by_source is outlinks
    assert view.lock is vault_routes._link_index_lock


def test_dashboard_retains_raw_parent_id(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from backend.domains.vault.pages.foundation import _write_dashboard_file

    saved: list[object] = []

    def write(path: Path, value: object, **options: object) -> None:
        saved.append(value)

    monkeypatch.setattr(vault_routes, "safe_write_json", write)
    parent = ["raw-parent"]
    _write_dashboard_file(tmp_path / "fixture.json", "id", "Title", {}, "{}", parent)
    assert isinstance(saved[0], dict)
    assert saved[0]["parent_id"] is parent
