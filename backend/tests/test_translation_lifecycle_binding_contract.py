"""Observable lifecycle binding contracts with synthetic collaborators only."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Iterable
from pathlib import Path
from typing import Never, TypeVar

import pytest
from fastapi import BackgroundTasks

from backend.api import vault_routes
from backend.domains.vault.registry.records import RecordReader
from backend.domains.vault.schemas.pages import PageInfo, PagePatchRequest, PageSaveRequest
from backend.domains.vault.translation import lifecycle, page_service, row_service
from backend.domains.vault.translation.types import Metadata


Awaited = TypeVar("Awaited")


def _run(awaitable: Awaitable[Awaited]) -> Awaited:
    """Bridge callback Awaitables to asyncio.run's coroutine-only contract."""

    async def wait() -> Awaited:
        return await awaitable

    return asyncio.run(wait())


def _unexpected(*_args: object, **_kwargs: object) -> Never:
    raise AssertionError("A captured or unpatched collaborator was called")


@pytest.fixture(autouse=True)
def synthetic_boundaries(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "create_page",
        "patch_page",
        "_get_existing_translations",
        "_get_pages_snapshot",
        "find_translations_of",
        "_ensure_status_options_persisted",
        "_write_metadata_key_on_disk",
        "_set_translation_stale_on_disk",
    ):
        monkeypatch.setattr(vault_routes, name, _unexpected)
    monkeypatch.setattr(lifecycle, "_ensure_status_options_persisted", _unexpected)


@pytest.fixture
def trace() -> list[object]:
    return []


@pytest.fixture(params=["string-keys", "object-keys"])
def receipt(request: pytest.FixtureRequest) -> dict[str, object] | dict[object, object]:
    raw_id = object()
    if request.param == "string-keys":
        string_receipt: dict[str, object] = {"id": raw_id, "extension": object()}
        return string_receipt
    object_receipt: dict[object, object] = {"id": raw_id, object(): object()}
    return object_receipt


@pytest.mark.parametrize("owner", ["row", "page"])
def test_translation_callbacks_resolve_facade_late_and_preserve_receipts(
    monkeypatch: pytest.MonkeyPatch,
    trace: list[object],
    receipt: dict[str, object] | dict[object, object],
    owner: str,
) -> None:
    dependencies = (
        lifecycle._ROW_TRANSLATION_DEPENDENCIES
        if owner == "row"
        else lifecycle._PAGE_TRANSLATION_DEPENDENCIES
    )
    tasks = BackgroundTasks()
    create_request = PageSaveRequest(title="Synthetic", content="Body", parent_id="origin")
    patch_request = PagePatchRequest(content="Updated")
    existing: dict[str, object] = {"ca": object()}
    before = dict(receipt)

    async def patch(
        page_id: str, request: PagePatchRequest, background_tasks: BackgroundTasks
    ) -> RecordReader:
        assert request is patch_request and background_tasks is tasks
        trace.append(("patch", page_id, request.content))
        return receipt

    async def create(request: PageSaveRequest, background_tasks: BackgroundTasks) -> RecordReader:
        assert request is create_request and background_tasks is tasks
        trace.append(("create", request.title, request.parent_id))
        monkeypatch.setattr(vault_routes, "patch_page", patch)
        return receipt

    async def lookup(origin_id: str) -> dict[str, object]:
        trace.append(("lookup", origin_id))
        monkeypatch.setattr(vault_routes, "create_page", create)
        return existing

    monkeypatch.setattr(vault_routes, "_get_existing_translations", lookup)
    assert _run(dependencies.existing_translations("origin")) is existing
    assert _run(dependencies.create_page(create_request, tasks)) is receipt
    assert _run(dependencies.patch_page("child", patch_request, tasks)) is receipt
    assert receipt == before
    assert trace == [
        ("lookup", "origin"),
        ("create", "Synthetic", "origin"),
        ("patch", "child", "Updated"),
    ]


def test_page_persistence_reads_receipt_without_coercing_its_id(
    monkeypatch: pytest.MonkeyPatch,
    receipt: dict[str, object] | dict[object, object],
) -> None:
    tasks = BackgroundTasks()
    metadata: Metadata = {"translation_lang": "es"}
    created: list[PageSaveRequest] = []

    async def create(request: PageSaveRequest, background_tasks: BackgroundTasks) -> RecordReader:
        assert background_tasks is tasks
        created.append(request)
        return receipt

    monkeypatch.setattr(vault_routes, "create_page", create)
    disposition, result = asyncio.run(
        page_service._persist_page_translation(
            page_id="origin",
            target_language="es",
            title="Títol",
            body="Cos",
            providers={"synthetic"},
            metadata=metadata,
            existing=None,
            background_tasks=tasks,
            dependencies=lifecycle._PAGE_TRANSLATION_DEPENDENCIES,
        )
    )
    assert disposition == "created"
    assert result["id"] is receipt["id"]
    assert result == {
        "id": receipt["id"],
        "lang": "es",
        "providers": ["synthetic"],
        "title": "Títol",
    }
    assert len(created) == 1
    assert (created[0].parent_id, created[0].title, created[0].content, created[0].metadata) == (
        "origin",
        "Títol",
        "Cos",
        metadata,
    )


def test_lookup_wrapper_resolves_finder_after_snapshot_callback(
    monkeypatch: pytest.MonkeyPatch, trace: list[object]
) -> None:
    pages: list[PageInfo] = []
    translations: dict[str, object] = {"ca": object()}

    def find(origin: str, received: Iterable[object]) -> dict[str, object]:
        assert received is pages
        trace.append(("find", origin))
        return translations

    def snapshot() -> list[PageInfo]:
        trace.append("snapshot")
        monkeypatch.setattr(vault_routes, "find_translations_of", find)
        return pages

    monkeypatch.setattr(vault_routes, "_get_pages_snapshot", snapshot)
    assert asyncio.run(lifecycle._get_existing_translations("origin")) is translations
    assert trace == ["snapshot", ("find", "origin")]


def test_row_source_effect_resolves_local_persist_then_local_write(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, trace: list[object]
) -> None:
    dependencies = lifecycle._ROW_TRANSLATION_DEPENDENCIES
    metadata: Metadata = {"title": "Synthetic"}
    table: Metadata = {"id": "table"}
    prop: Metadata = {"id": "status"}
    value = "Done"
    path = tmp_path / "synthetic.md"

    def effect(received: Metadata, action: str, target: str) -> tuple[Metadata, str, bool]:
        assert received is table
        trace.append(("effect", action, target))
        return prop, value, True

    def write(page_id: str, received_path: Path, key: str, received_value: object) -> bool:
        assert received_path is path and received_value is value
        trace.append(("write", page_id, key))
        return False

    def persist(table_id: str, values: list[object]) -> None:
        assert len(values) == 1 and values[0] is value
        trace.append(("persist", table_id))
        monkeypatch.setattr(lifecycle, "_write_metadata_key_on_disk", write)

    def key(received: Metadata, received_prop: Metadata) -> str:
        assert received is metadata and received_prop is prop
        trace.append("key")
        return "status-key"

    monkeypatch.setattr(vault_routes.action_rules_service, "status_effect", effect)
    monkeypatch.setattr(vault_routes.action_rules_service, "effect_write_key", key)
    monkeypatch.setattr(lifecycle, "_ensure_status_options_persisted", persist)
    monkeypatch.setattr(lifecycle, "_write_metadata_key_on_disk", _unexpected)
    asyncio.run(
        row_service._apply_source_status("origin", path, metadata, table, "table", dependencies)
    )
    assert trace == [
        ("effect", dependencies.action_translate, "source"),
        ("persist", "table"),
        "key",
        ("write", "origin", "status-key"),
    ]


def test_staleness_resolves_local_persist_then_local_stale_callback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, trace: list[object]
) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("synthetic translation", encoding="utf-8")
    table: Metadata = {"id": "table", "translation_enabled": True, "properties": []}
    prop: Metadata = {"id": "status"}
    old: Metadata = {"id": "origin", "title": "Old"}
    new: Metadata = {"id": "origin", "title": "New"}
    pages: list[PageInfo] = []
    children: dict[str, object] = {"ca": {"id": "child", "path": str(path)}}

    def table_id(metadata: Metadata) -> str:
        assert metadata is new
        trace.append("table-id")
        return "table"

    def find_table(identifier: str | None) -> Metadata:
        trace.append(("table", identifier))
        return table

    def changed(
        keys: Iterable[str],
        old_md: Metadata | None,
        new_md: Metadata | None,
        old_body: str | None = None,
        new_body: str | None = None,
        *,
        title_matters: bool = False,
    ) -> bool:
        assert old_md is old and new_md is new
        trace.append(("changed", list(keys), old_body, new_body, title_matters))
        return True

    def snapshot() -> list[PageInfo]:
        trace.append("snapshot")
        return pages

    def find(origin: str, received: Iterable[object]) -> dict[str, object]:
        assert received is pages
        trace.append(("find", origin))
        return children

    def effect(received: Metadata) -> tuple[Metadata, str, bool]:
        assert received is table
        trace.append("effect")
        return prop, "Draft", True

    def stale(
        page_id: str, received_path: Path, *, stale_status: tuple[Metadata, object] | None = None
    ) -> bool:
        assert stale_status is not None and stale_status[0] is prop
        trace.append(("stale", page_id, received_path, stale_status[1]))
        return True

    def persist(identifier: str, values: list[object]) -> None:
        trace.append(("persist", identifier, values))
        monkeypatch.setattr(lifecycle, "_set_translation_stale_on_disk", stale)

    monkeypatch.setattr(vault_routes, "get_table_id", table_id)
    monkeypatch.setattr(vault_routes, "_table_by_id", find_table)
    monkeypatch.setattr(vault_routes, "translatable_content_changed", changed)
    monkeypatch.setattr(vault_routes, "_get_pages_snapshot", snapshot)
    monkeypatch.setattr(vault_routes, "find_translations_of", find)
    monkeypatch.setattr(vault_routes.action_rules_service, "on_stale_effect", effect)
    monkeypatch.setattr(lifecycle, "_ensure_status_options_persisted", persist)
    monkeypatch.setattr(lifecycle, "_set_translation_stale_on_disk", _unexpected)
    lifecycle._propagate_translation_staleness("ignored-fallback", old, new, "Before", "After")
    assert trace == [
        "table-id",
        ("table", "table"),
        ("changed", [], None, None, False),
        "snapshot",
        ("find", "origin"),
        "effect",
        ("persist", "table", ["Draft"]),
        ("stale", "child", path, "Draft"),
    ]


@pytest.mark.parametrize("kind", ["row", "page"])
def test_canonical_translation_creation_uses_domain_service(monkeypatch: pytest.MonkeyPatch, kind: str) -> None:
    """Internal translation cannot rely on FastAPI resolving handler defaults."""
    from backend.domains.vault.api import core_routes
    from backend.domains.vault.pages import create_service

    request = PageSaveRequest(title="Translated", content="Body", metadata={})
    tasks = BackgroundTasks()
    receipt: dict[str, object] = {"id": "translated"}
    calls: list[object] = []

    async def create(request_arg: PageSaveRequest, tasks_arg: object, user_id: str | None,
                     dependencies: create_service.CreatePageDependencies) -> dict[str, object]:
        assert request_arg is request and tasks_arg is tasks
        assert user_id is None
        assert dependencies is core_routes._CREATE_PAGE_DEPENDENCIES
        calls.append(request_arg)
        return receipt

    monkeypatch.setattr(vault_routes, "create_page", core_routes.create_page)
    monkeypatch.setattr(create_service, "create_page", create)
    dependencies = lifecycle._ROW_TRANSLATION_DEPENDENCIES if kind == "row" else lifecycle._PAGE_TRANSLATION_DEPENDENCIES
    assert _run(dependencies.create_page(request, tasks)) is receipt
    assert calls == [request]
