"""View usage scans must not block unrelated HTTP work on cloud file reads."""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import nullcontext
from contextvars import ContextVar
from pathlib import Path

from backend.domains.vault.schemas.pages import PageInfo
from backend.domains.vault.views.api import ViewDependencies, get_view_usage


def test_usage_reads_off_event_loop_and_retains_vault_context(tmp_path, monkeypatch):
    active_vault = ContextVar("test_view_usage_vault", default="wrong-vault")
    page = tmp_path / "reading.md"
    page.write_text('<!-- gnosi-view:def {"view_id":"view-1"} -->', encoding="utf-8")
    missing = tmp_path / "missing.md"
    reads = []
    original_read = Path.read_text

    def read_text(path, *args, **kwargs):
        reads.append((threading.get_ident(), active_vault.get()))
        return original_read(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)
    dependencies = ViewDependencies(
        load_registry=lambda: {},
        save_registry=lambda _registry: None,
        registry_mutation=nullcontext,
        sort_key=lambda _view: (0, ""),
        pages_snapshot=lambda: [
            PageInfo(id="page-1", title="Reading", path=str(page), last_modified="", size=1),
            PageInfo(id="missing", title="Missing", path=str(missing), last_modified="", size=1),
        ],
        logger=logging.getLogger(__name__),
    )

    async def run():
        active_vault.set("fixture-vault")
        loop_thread = threading.get_ident()
        result = await get_view_usage(" view-1 ", dependencies)
        assert result == {
            "view_id": "view-1",
            "count": 1,
            "pages": [{"id": "page-1", "title": "Reading", "path": str(page)}],
        }
        assert reads and all(
            thread != loop_thread and vault == "fixture-vault" for thread, vault in reads
        )

    asyncio.run(run())
