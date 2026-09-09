"""Selectors preserve full table identity without transferring unused fields."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from backend.domains.vault.api import pages_queries
from backend.domains.vault.schemas.pages import PageInfo


def _page(identifier: str, title: str, template: bool = False) -> PageInfo:
    return PageInfo(id=identifier, title=title, last_modified="2026-09-08", size=12,
                    metadata={"is_template": template, "unused": "x" * 1000})


@pytest.mark.parametrize("include_templates", [True, False])
def test_http_references_match_complete_table_titles_and_order(monkeypatch, include_templates) -> None:
    pages = [_page("first", "Title"), _page("template", "Template", True),
             _page("duplicate-title", "Title"), _page("blank", "")]
    hydrated: list[str] = []

    def refresh(table_id, selected):
        assert table_id == "requested-table"
        hydrated.extend(page.id for page in selected)
        selected[0].title = "Refreshed title"

    monkeypatch.setattr(pages_queries, "_dependencies", SimpleNamespace(
        get_pages_for_table=lambda _: pages, enrich_table_pages=refresh,
    ))
    app, router = FastAPI(), APIRouter()
    pages_queries.register_catalog_routes(router)
    app.include_router(router, prefix="/api/vault")
    query = {"include_templates": str(include_templates).lower()}
    with TestClient(app) as client:
        full = client.get("/api/vault/pages/by-table/requested-table", params=query)
        compact = client.get("/api/vault/pages/by-table/requested-table/references", params=query)
    assert full.status_code == compact.status_code == 200
    expected = [{"id": page["id"], "title": page["title"]} for page in full.json()]
    assert compact.json() == expected
    assert len(compact.content) < len(full.content) / 10
    assert hydrated == [page["id"] for page in expected] * 2
    assert pages[0].metadata["unused"] == "x" * 1000


def test_references_revalidate_and_remain_independent(monkeypatch) -> None:
    pages = [_page("first", "Original")]
    monkeypatch.setattr(pages_queries, "_dependencies", SimpleNamespace(
        get_pages_for_table=lambda _: pages, enrich_table_pages=lambda *_: None,
    ))
    first = asyncio.run(pages_queries.list_page_references_by_table("table", False))
    first[0].title = "Changed by caller"
    assert pages[0].title == "Original"
    pages[0].title = "Renamed"
    pages.append(_page("new", "New"))
    assert [page.model_dump() for page in asyncio.run(
        pages_queries.list_page_references_by_table("table", False)
    )] == [{"id": "first", "title": "Renamed"}, {"id": "new", "title": "New"}]
    pages.clear()
    assert asyncio.run(pages_queries.list_page_references_by_table("table", False)) == []


def test_slow_reference_reads_keep_loop_available_and_vault_context(monkeypatch) -> None:
    vault = ContextVar("reference_vault", default="missing")

    async def scenario():
        loop = asyncio.get_running_loop()
        served = Event()

        def read(table_id):
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), "Reference read blocked another request"
            return [_page(table_id, vault.get())]

        monkeypatch.setattr(pages_queries, "_dependencies", SimpleNamespace(
            get_pages_for_table=read, enrich_table_pages=lambda *_: None,
        ))
        for name in ("first-vault", "second-vault"):
            served.clear()
            token = vault.set(name)
            try:
                result = await pages_queries.list_page_references_by_table("same-table", False)
                assert result[0].title == name
            finally:
                vault.reset(token)

    asyncio.run(scenario())
