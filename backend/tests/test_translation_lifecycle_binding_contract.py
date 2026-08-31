"""Observable lifecycle binding contracts with synthetic collaborators only."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Never, TypeVar

import pytest
from fastapi import BackgroundTasks

from backend.api import vault_routes
from backend.domains.vault.drupal import composition, fields
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
        "_drupal_client_module",
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


class CapturedSyncError(Exception):
    pass


class ReplacementSyncError(Exception):
    pass


@dataclass
class SyntheticConnector:
    trace: list[object]
    error_type: type[Exception] = CapturedSyncError

    @property
    def DrupalSyncError(self) -> type[Exception]:
        self.trace.append("read-error-class")
        return self.error_type

    async def find_existing_file(self, filename: str, size: int | None = None) -> str | None:
        return _unexpected(filename, size)

    async def upload_image(self, bundle: str, field: str, filename: str, data: bytes) -> str:
        return _unexpected(bundle, field, filename, data)

    async def resolve_or_create_term(
        self, vocabulary: str, name: str, *, cache: dict[str, str] | None = None
    ) -> str:
        return _unexpected(vocabulary, name, cache)


@pytest.fixture
def connector(monkeypatch: pytest.MonkeyPatch, trace: list[object]) -> SyntheticConnector:
    synthetic = SyntheticConnector(trace)

    def resolve() -> SyntheticConnector:
        trace.append("resolve-connector")
        return synthetic

    monkeypatch.setattr(vault_routes, "_drupal_client_module", resolve)
    return synthetic


def test_upload_factory_captures_connector_but_resolves_its_members_late(
    monkeypatch: pytest.MonkeyPatch, connector: SyntheticConnector, trace: list[object]
) -> None:
    dependencies = lifecycle._drupal_upload_dependencies()
    assert trace == ["resolve-connector"]
    replacement = SyntheticConnector(trace)

    def resolve_replacement() -> SyntheticConnector:
        trace.append("resolve-replacement")
        return replacement

    async def find(filename: str, size: int) -> str:
        trace.append(("find", filename, size))
        return "existing-file"

    async def upload(bundle: str, field: str, filename: str, data: bytes) -> str:
        trace.append(("upload", bundle, field, filename, data))
        return "uploaded-file"

    monkeypatch.setattr(vault_routes, "_drupal_client_module", resolve_replacement)
    monkeypatch.setattr(connector, "find_existing_file", find)
    monkeypatch.setattr(connector, "upload_image", upload)
    assert _run(dependencies.find_existing_file("image.png", 3)) == "existing-file"
    assert _run(dependencies.upload_image("article", "image", "image.png", b"png")) == (
        "uploaded-file"
    )
    assert trace == [
        "resolve-connector",
        ("find", "image.png", 3),
        ("upload", "article", "image", "image.png", b"png"),
    ]
    fresh = lifecycle._drupal_upload_dependencies()
    with pytest.raises(AssertionError, match="unpatched collaborator"):
        _run(fresh.find_existing_file("image.png", 3))
    assert trace[-1] == "resolve-replacement"


def test_field_factory_captures_error_class_but_resolves_term_member_late(
    monkeypatch: pytest.MonkeyPatch, connector: SyntheticConnector, trace: list[object]
) -> None:
    dependencies = lifecycle._drupal_field_dependencies()
    assert trace == ["resolve-connector", "read-error-class"]
    monkeypatch.setattr(vault_routes, "_drupal_client_module", _unexpected)
    monkeypatch.setattr(connector, "error_type", ReplacementSyncError)
    cache: dict[str, str] = {}
    metadata: dict[str, object] = {"tags": ["Alpha", "Beta"]}
    prop: dict[str, object] = {"id": "tags"}

    def read(received: dict[str, object], received_prop: dict[str, object] | None) -> object:
        assert received is metadata and received_prop is prop
        trace.append("read-prop")
        return received["tags"]

    async def resolve(vocabulary: str, name: str, *, cache: dict[str, str]) -> str:
        trace.append(("term", vocabulary, name, dict(cache)))
        if name == "Beta":
            raise CapturedSyncError("synthetic missing term")
        cache[name] = "term-alpha"
        return "term-alpha"

    monkeypatch.setattr(vault_routes, "_drupal_read_prop_value", read)
    monkeypatch.setattr(connector, "resolve_or_create_term", resolve)

    async def build() -> tuple[object, object, object]:
        return await fields.build_fields(
            mapping={"tags": "field_tags"},
            properties_by_ref={"tags": prop},
            field_metadata={"field_tags": {"type": "entity_reference", "vocab": "topics"}},
            metadata=metadata,
            body="",
            bundle="article",
            term_cache=cache,
            image_cache={},
            dependencies=dependencies,
        )

    assert asyncio.run(build()) == (
        {},
        {"field_tags": {"data": [{"type": "taxonomy_term--topics", "id": "term-alpha"}]}},
        [{"field": "field_tags", "value": "Beta", "reason": "synthetic missing term"}],
    )
    assert cache == {"Alpha": "term-alpha"}
    assert trace == [
        "resolve-connector",
        "read-error-class",
        "read-prop",
        ("term", "topics", "Alpha", {}),
        ("term", "topics", "Beta", {"Alpha": "term-alpha"}),
    ]

    async def replacement_error(vocabulary: str, name: str, *, cache: dict[str, str]) -> str:
        raise ReplacementSyncError("replacement class must escape")

    monkeypatch.setattr(connector, "resolve_or_create_term", replacement_error)
    with pytest.raises(ReplacementSyncError, match="replacement class must escape"):
        asyncio.run(build())


def test_field_factory_resolves_facade_callbacks_after_construction(
    monkeypatch: pytest.MonkeyPatch, connector: SyntheticConnector, trace: list[object]
) -> None:
    dependencies = lifecycle._drupal_field_dependencies()
    metadata: dict[str, object] = {"image": object()}
    image_cache: dict[str, str] = {}
    link_cache: dict[str, str | None] = {}
    relationship: dict[str, object] = {"data": {"id": "synthetic-image"}}
    scalar = object()

    def markdown(text: str, cache: dict[str, str | None]) -> str:
        assert cache is link_cache
        trace.append(("markdown", text))
        return "<p>synthetic</p>"

    def read(received: dict[str, object], prop: dict[str, object] | None) -> object:
        assert received is metadata and prop is None
        trace.append("read-none")
        return scalar

    async def upload(
        value: object, bundle: str, field: str, received: dict[str, object], cache: dict[str, str]
    ) -> dict[str, object]:
        assert value is metadata["image"] and received is metadata and cache is image_cache
        trace.append(("field-image", bundle, field))
        cache["image"] = "synthetic-image"
        return relationship

    def coerce(value: object, field_type: str | None) -> object:
        assert value is scalar
        trace.append(("coerce", field_type))
        return value

    monkeypatch.setattr(vault_routes, "_drupal_md_to_html", markdown)
    monkeypatch.setattr(vault_routes, "_drupal_read_prop_value", read)
    monkeypatch.setattr(vault_routes, "_drupal_upload_field_image", upload)
    monkeypatch.setattr(vault_routes, "_drupal_coerce_scalar", coerce)
    assert dependencies.markdown_to_html("synthetic", link_cache) == "<p>synthetic</p>"
    assert dependencies.read_prop_value(metadata, None) is scalar
    assert (
        _run(
            dependencies.upload_field_image(
                metadata["image"], "article", "field_image", metadata, image_cache
            )
        )
        is relationship
    )
    assert dependencies.coerce_scalar(scalar, None) is scalar
    assert image_cache == {"image": "synthetic-image"}
    assert trace == [
        "resolve-connector",
        "read-error-class",
        ("markdown", "synthetic"),
        "read-none",
        ("field-image", "article", "field_image"),
        ("coerce", None),
    ]


def test_read_prop_wrapper_accepts_none_and_keeps_native_value() -> None:
    value = object()
    metadata: Metadata = {"title": value, "stable-id": "fallback"}
    assert composition._drupal_read_prop_value(metadata, None) is None
    assert (
        composition._drupal_read_prop_value(metadata, {"type": "title", "id": "stable-id"}) is value
    )


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
