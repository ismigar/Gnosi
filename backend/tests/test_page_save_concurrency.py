"""Concurrent saves must validate the revision after acquiring the write lock."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.pages.save_service import save_page
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.tests.page_write_open_fixtures import _save_dependencies


@pytest.mark.parametrize("action", ["save", "rename", "delete"])
def test_save_rechecks_revision_after_waiting_for_another_writer(
    tmp_path: Path, action: str
) -> None:
    path = tmp_path / "page.md"
    path.write_text("old-revision", encoding="utf-8")
    events: list[str] = []

    async def scenario() -> None:
        nonlocal path
        lock = asyncio.Lock()
        waiting = asyncio.Event()
        await lock.acquire()

        async def get_lock(page_id: str) -> asyncio.Lock:
            waiting.set()
            return lock

        dependencies = replace(
            _save_dependencies(path, {}, events),
            find_page=lambda page_id, **kwargs: path,
            file_etag=lambda file_path: file_path.read_text(encoding="utf-8"),
            get_page_write_lock=get_lock,
        )
        pending = asyncio.create_task(
            save_page(
                "page",
                PageSaveRequest(
                    title="Page", content="stale editor text", expected_etag="old-revision"
                ),
                BackgroundTasks(),
                None,
                dependencies,
            )
        )
        await waiting.wait()
        if action == "rename":
            renamed = tmp_path / "renamed.md"
            path.rename(renamed)
            path = renamed
        if action == "delete":
            path.unlink()
        else:
            path.write_text("concurrent writer revision", encoding="utf-8")
        lock.release()
        with pytest.raises(HTTPException) as caught:
            await pending
        assert caught.value.status_code == 409
        assert caught.value.detail["current_etag"] == (None if action == "delete" else "concurrent writer revision")

    asyncio.run(scenario())
    assert events == []
    if action == "delete":
        assert not path.exists()
    else:
        assert path.read_text(encoding="utf-8") == "concurrent writer revision"
