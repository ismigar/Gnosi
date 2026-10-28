"""Architecture and behavior contracts for translation domains."""

from __future__ import annotations

import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import BackgroundTasks

from backend.api import vault_routes
from backend.domains.vault.schemas.pages import PageInfo, PageSaveRequest
from backend.domains.vault.translation import (
    adapters,
    lifecycle as translation_lifecycle,
    lookup,
    metadata_io,
    page_service,
    routes as translation_routes,
    row_service,
    staleness,
)
from backend.services.translation_helpers import translatable_content_changed


DOMAIN_MODULES = (
    adapters,
    lookup,
    metadata_io,
    page_service,
    row_service,
    staleness,
)


def test_domains_are_small_and_do_not_import_the_legacy_facade() -> None:
    for module in DOMAIN_MODULES:
        source_path = Path(module.__file__ or "")
        source = source_path.read_text(encoding="utf-8")
        assert len(source.splitlines()) <= 800, source_path
        assert "backend.api.vault_routes" not in source, source_path


def test_named_legacy_facade_targets_are_canonical_domain_reexports() -> None:
    target_owners = {
        "_propagate_translation_staleness": translation_lifecycle,
        "_do_translate_row": translation_lifecycle,
        "translate_page": translation_routes,
    }
    facade_source = Path(vault_routes.__file__ or "").read_text(encoding="utf-8")
    facade_tree = ast.parse(facade_source)
    facade_functions = {
        node.name
        for node in facade_tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }

    for name, owner in target_owners.items():
        assert name not in facade_functions
        assert getattr(vault_routes, name) is getattr(owner, name)


def _translate_markdown(
    text: str,
    source: str,
    target: str,
    *,
    deepl_api_key: str,
) -> tuple[str, set[str]]:
    del source, deepl_api_key
    return f"{text} [{target}]", {"fake"}


def _translate_title(
    text: str,
    source: str,
    target: str,
    *,
    deepl_api_key: str,
) -> tuple[str, str]:
    del source, deepl_api_key
    return f"{text} [{target}]", "fake"


def test_translate_page_route_keeps_late_bound_create_page(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.md"
    source.write_text("---\nid: page-1\ntitle: Original\n---\nBody", encoding="utf-8")
    created: list[PageSaveRequest] = []

    async def _existing(_page_id: str) -> dict[str, Any]:
        return {}

    async def _create(
        request: PageSaveRequest,
        _tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        created.append(request)
        return {"id": "child-1"}

    monkeypatch.setattr(
        adapters,
        "load_translate_page_skill",
        lambda _logger: (_translate_markdown, _translate_title, lambda _text: "ca"),
    )
    monkeypatch.setattr(vault_routes, "_read_deepl_key", lambda: "")
    monkeypatch.setattr(vault_routes, "find_page_path", lambda _page_id: source)
    monkeypatch.setattr(vault_routes, "_get_existing_translations", _existing)
    monkeypatch.setattr(vault_routes, "create_page", _create)

    response = asyncio.run(
        vault_routes.translate_page(
            BackgroundTasks(),
            {"page_id": "page-1", "target_languages": ["en"]},
        )
    )

    assert response["created"][0]["id"] == "child-1"
    assert created[0].title == "Original [en]"
    assert created[0].content == "Body [en]"
    assert created[0].metadata["translation_origin_id"] == "page-1"


def test_staleness_domain_marks_only_real_source_edits(tmp_path: Path) -> None:
    translation_path = tmp_path / "translation.md"
    translation_path.write_text("translation", encoding="utf-8")
    child = SimpleNamespace(id="child-1", path=str(translation_path), metadata={})
    statuses: list[tuple[str, object]] = []

    def _set_stale(
        page_id: str,
        _path: Path,
        status: tuple[dict[str, Any], Any] | None,
    ) -> bool:
        statuses.append((page_id, status[1] if status else None))
        return True

    dependencies = staleness.TranslationStalenessDependencies(
        table_id=lambda _metadata: "table-1",
        table_by_id=lambda _table_id: {
            "id": "table-1",
            "translation_enabled": True,
            "properties": [{"id": "summary", "name": "Summary", "translatable": True}],
        },
        content_changed=translatable_content_changed,
        find_translations=lambda _origin, _pages: {"en": child},
        page_snapshot=lambda: [child],
        on_stale_effect=lambda _table: ({"id": "status"}, "Draft", False),
        persist_status_options=lambda _table_id, _values: None,
        find_page=lambda _page_id: None,
        set_stale=_set_stale,
        logger=vault_routes.log,
    )

    staleness.propagate_translation_staleness(
        "origin-1",
        {"id": "origin-1", "summary": "before"},
        {"id": "origin-1", "summary": "after"},
        None,
        None,
        dependencies,
    )

    assert statuses == [("child-1", "Draft")]
