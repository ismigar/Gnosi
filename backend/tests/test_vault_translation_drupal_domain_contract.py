"""Architecture and behavior contracts for translation and Drupal domains."""

from __future__ import annotations

import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import BackgroundTasks

from backend.api import vault_routes
from backend.domains.vault.drupal import (
    composition as drupal_composition,
    core,
    fields,
    languages,
    markdown,
    matching,
    media,
    service,
)
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
    core,
    fields,
    languages,
    markdown,
    matching,
    media,
    service,
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
        "_drupal_shrink_image": drupal_composition,
        "_drupal_build_fields": drupal_composition,
        "_do_sync_drupal_row": drupal_composition,
        "match_drupal_rows": translation_routes,
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


class FakeDrupalError(Exception):
    pass


async def _resolve_term(
    vocabulary: str,
    name: str,
    cache: dict[str, str],
) -> str:
    term_id = f"{vocabulary}:{name}"
    cache[name] = term_id
    return term_id


async def _upload_field(
    value: Any,
    bundle: str,
    field_name: str,
    metadata: dict[str, Any],
    cache: dict[str, str],
) -> dict[str, Any]:
    del value, bundle, metadata
    cache[field_name] = "file-1"
    return {"data": {"type": "file--file", "id": "file-1"}}


def test_drupal_field_builder_preserves_text_taxonomy_media_and_scalar_modes() -> None:
    dependencies = fields.DrupalFieldDependencies(
        sync_error=FakeDrupalError,
        markdown_to_html=lambda text, _cache: f"<p>{text}</p>",
        read_prop_value=core.read_prop_value,
        upload_field_image=_upload_field,
        resolve_or_create_term=_resolve_term,
        coerce_scalar=core.coerce_scalar,
    )
    mapping = {
        core.DRUPAL_BODY_REF: "body",
        "summary": "field_summary",
        "tags": "field_tags",
        "image": "field_image",
        "count": "field_count",
    }
    properties = {key: {"id": key, "name": key} for key in ("summary", "tags", "image", "count")}
    field_metadata = {
        "body": {"type": "text_long"},
        "field_summary": {"type": "text_long"},
        "field_tags": {"type": "entity_reference", "vocab": "topics"},
        "field_image": {"type": "image"},
        "field_count": {"type": "integer"},
    }
    metadata = {
        "summary": "Summary",
        "tags": ["Alpha", "Beta"],
        "image": "Assets/image.png",
        "count": "7",
    }
    attributes, relationships, skipped = asyncio.run(
        fields.build_fields(
            mapping=mapping,
            properties_by_ref=properties,
            field_metadata=field_metadata,
            metadata=metadata,
            body="Body",
            bundle="article",
            term_cache={},
            image_cache={},
            dependencies=dependencies,
        )
    )
    assert attributes == {
        "body": {"value": "<p>Body</p>", "format": "full_html"},
        "field_summary": {
            "value": "<p>Summary</p>",
            "format": "full_html",
        },
        "field_count": 7,
    }
    assert relationships == {
        "field_tags": {
            "data": [
                {"type": "taxonomy_term--topics", "id": "topics:Alpha"},
                {"type": "taxonomy_term--topics", "id": "topics:Beta"},
            ]
        },
        "field_image": {"data": {"type": "file--file", "id": "file-1"}},
    }
    assert skipped == []


class FakeDrupalModule:
    DrupalSyncError = FakeDrupalError
    DrupalNotFound = FakeDrupalError

    async def find_nodes_by_title(
        self,
        bundle: str,
        title: str,
    ) -> list[dict[str, Any]]:
        assert bundle == "article"
        return [
            {
                "uuid": f"uuid:{title}",
                "nid": 42,
                "url": "/article",
            }
        ]


def test_match_route_keeps_late_bound_facade_collaborators(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    page = PageInfo.model_construct(
        id="row-1",
        title="Exact title",
        metadata={"title": "Exact title"},
    )
    table = {
        "id": "table-1",
        "drupal_bundle": "article",
        "properties": [],
    }
    patched: list[tuple[str, dict[str, Any]]] = []

    async def _patch(
        page_id: str,
        request: Any,
        _tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        patched.append((page_id, dict(request.metadata or {})))
        return {"id": page_id}

    fake_drupal = FakeDrupalModule()
    monkeypatch.setattr(vault_routes, "_drupal_client_module", lambda: fake_drupal)
    monkeypatch.setattr(vault_routes, "_table_by_id", lambda _table_id: table)
    monkeypatch.setattr(vault_routes, "_get_pages_for_table", lambda _table_id: [page])
    monkeypatch.setattr(vault_routes, "patch_page", _patch)

    response = asyncio.run(
        vault_routes.match_drupal_rows(
            BackgroundTasks(),
            {"table_id": "table-1", "dry_run": False},
        )
    )

    assert response["counts"] == {"matched": 1, "unmatched": 0, "ambiguous": 0}
    assert response["matched"][0]["applied"] is True
    assert patched == [
        (
            "row-1",
            {
                "drupal_uuid": "uuid:Exact title",
                "drupal_nid": "42",
                "drupal_url": "/article",
            },
        )
    ]


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
