"""Cloud delays cannot monopolize the event loop during page creation."""

import asyncio
from dataclasses import replace
from pathlib import Path
import threading

from fastapi import BackgroundTasks, FastAPI
import httpx
import pytest

from backend.domains.vault.pages.create_service import CreatePageDependencies, create_page
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.services.context_vars import active_vault_path


def dependencies(root, **changes):
    ports = CreatePageDependencies(
        new_id=lambda: "new-id", normalize_metadata=lambda value: value,
        prepare_table_metadata=lambda value: (value, None), process_updates=lambda _id, _old, value: value,
        stamp_author=lambda value, user, _new: value.update(author=user), persist_assets=lambda value: value,
        ensure_citation_key=lambda value, _table: value, dedupe_citation_key=lambda value, _id: value,
        fill_authorship=lambda value, _table: value, path_for=lambda _key: root,
        is_calendar_entry=lambda _value: False, table_folder=lambda _value: root,
        canonicalize_id=str, parse_frontmatter=lambda _raw, _path: ({}, ""),
        unique_file_path=lambda folder, title, suffix: folder / (title + suffix),
        save_page=lambda path, _value, body: path.write_text(body), get_table_id=lambda _value: None,
        recompute_formulas=lambda *_args: None, index_created_page=lambda *_args: None,
        invalidate_page_responses=lambda: None, add_page_index=lambda _path: None,
        update_link_index=lambda _path: None, queue_planning=lambda _tasks: None,
        propagate_relations=lambda *_args: None, resolve_page_context=lambda _value, _path: ("QA", None),
        emit_created=lambda *_args: None, find_page_by_id=lambda _id: None,
    )
    return replace(ports, **changes)


@pytest.mark.parametrize("phase", ["metadata", "lookup", "write", "index"])
def test_health_responds_while_cloud_io_is_waiting(tmp_path, phase):
    entered, release = threading.Event(), threading.Event()
    worker_ids = []
    def wait():
        worker_ids.append(threading.get_ident())
        assert active_vault_path.get() == tmp_path
        entered.set()
        assert release.wait(3), "test did not release the synthetic cloud delay"
    def metadata(value):
        wait()
        return value
    def lookup(_id):
        wait()
        return None
    def save(path, _value, body):
        wait()
        path.write_text(body)
    def index(*_args):
        wait()
    changes = {"metadata": {"normalize_metadata": metadata}, "lookup": {"find_page_by_id": lookup},
               "write": {"save_page": save}, "index": {"index_created_page": index}}
    ports = dependencies(tmp_path, **changes[phase])
    app = FastAPI()
    @app.get("/health")
    async def health():
        return {"ok": True}
    @app.post("/create")
    async def create():
        return await create_page(PageSaveRequest(title="QA", content="body"), BackgroundTasks(), "author", ports)
    async def run():
        loop_thread = threading.get_ident()
        token = active_vault_path.set(tmp_path)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa") as client:
                pending = asyncio.create_task(client.post("/create"))
                try:
                    assert await asyncio.to_thread(entered.wait, 2)
                    response = await asyncio.wait_for(client.get("/health"), timeout=0.5)
                    assert response.status_code == 200 and not pending.done()
                finally:
                    release.set()
                result = await pending
                assert result.status_code == 200 and result.json()["metadata"]["author"] == "author"
                assert worker_ids and all(thread != loop_thread for thread in worker_ids)
        finally:
            active_vault_path.reset(token)
    asyncio.run(run())


def test_new_page_does_not_read_unmaterialized_neighbors(tmp_path, monkeypatch):
    neighbor = tmp_path / "Cloud.md"
    neighbor.write_text("unmaterialized")
    original_read = Path.read_text
    def read(path, *args, **kwargs):
        if path == neighbor:
            raise AssertionError("Creating a fresh page must not hydrate unrelated cloud files")
        return original_read(path, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", read)
    result = asyncio.run(create_page(PageSaveRequest(title="New", content="body"), BackgroundTasks(), None, dependencies(tmp_path)))
    assert result["id"] == "new-id" and (tmp_path / "New.md").read_text() == "body"


def test_cached_id_in_another_folder_cannot_redirect_the_write(tmp_path):
    other = tmp_path / "Other"
    other.mkdir()
    existing = other / "Keep.md"
    existing.write_text("keep")
    ports = dependencies(tmp_path, find_page_by_id=lambda _id: existing)
    asyncio.run(create_page(PageSaveRequest(title="New", content="body"), BackgroundTasks(), None, ports))
    assert existing.read_text() == "keep" and (tmp_path / "New.md").read_text() == "body"
