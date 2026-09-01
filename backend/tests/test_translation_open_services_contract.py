"""Row/page behavioral tests with real request validation and fake providers."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.translation import page_service, row_service
from backend.tests.translation_open_fixtures import page_fixture, row_fixture


def test_row_keeps_open_source_and_duplicate_target_behavior(tmp_path: Path) -> None:
    deps, fixture = row_fixture(tmp_path)
    opaque = fixture.metadata[19]
    raw_id: list[object] = ["id", 42]
    fixture.new_id = raw_id
    result = asyncio.run(row_service.translate_row(
        "origin", [None, 7, " ", "CA", " ES ", "es"], translate_fn=fixture.text,
        detect_fn=lambda _text: "unexpected", deepl_api_key="synthetic-key",
        background_tasks=BackgroundTasks(), dependencies=deps,
    ))
    assert set(result) == {"item_id", "source_lang", "created", "updated", "skipped"}
    assert result["source_lang"] == "ca" and result["updated"] == []
    assert result["skipped"] == [{"lang": "ca", "reason": "same as source"}]
    created = result["created"]
    assert isinstance(created, list) and len(created) == 2
    assert created[0]["id"] is raw_id
    assert len(fixture.creates) == 2  # Lookup is not augmented with new children.
    assert fixture.metadata[19] is opaque and fixture.metadata["title"] == "Original"
    assert fixture.creates[0].metadata["language"] == "ES"
    assert fixture.creates[0].content == "Body-es"
    assert ("record", "origin", "es", str(raw_id)) in fixture.trace


def test_row_reuses_opaque_existing_id_and_preserves_request_validation(tmp_path: Path) -> None:
    deps, fixture = row_fixture(tmp_path)
    raw_id: list[object] = ["opaque"]
    fixture.existing["es"] = SimpleNamespace(id=raw_id)
    disposition, record = asyncio.run(row_service._persist_translation(
        item_id="origin", target_language="es", title="Title", body="   ",
        metadata={"extra": {8: "nested"}}, providers={"fake"}, existing=fixture.existing["es"],
        background_tasks=BackgroundTasks(), dependencies=deps,
    ))
    assert disposition == "updated" and record["id"] is raw_id
    assert fixture.patches[0][0] == str(raw_id) and fixture.patches[0][1].content is None
    assert fixture.trace == [
        ("materialize", fixture.path, f"translate-patch/{raw_id}"),
        ("patch", str(raw_id)), ("record", "origin", "es", str(raw_id)),
    ]
    with pytest.raises(ValidationError):
        asyncio.run(row_service._persist_translation(
            item_id="origin", target_language="es", title="Title", body="Body",
            metadata={8: "top-level invalid HTTP key"}, providers=set(), existing=None,
            background_tasks=BackgroundTasks(), dependencies=deps,
        ))
    assert fixture.creates == []


def test_merge_preserves_snapshot_identity_and_precedence(tmp_path: Path) -> None:
    deps, fixture = row_fixture(tmp_path)
    snapshot_es = object()
    recovered_fr = object()
    fixture.existing["es"] = snapshot_es
    fixture.recovered.update({"es": object(), "fr": recovered_fr})
    fixture.known.update({"es": "ignored", "de": "de-child", "it": "missing"})
    deps = replace(deps, find_page=lambda child: None if child == "missing" else fixture.path)
    result = asyncio.run(row_service._merge_known_translations("origin", ["es", "fr"], tmp_path, deps))
    assert result is fixture.existing and result["es"] is snapshot_es and result["fr"] is recovered_fr
    page = result["de"]
    assert isinstance(page, SimpleNamespace) and page.id == "de-child"
    assert "it" not in result and ("forget", "origin", "it") in fixture.trace


def test_row_property_reread_keeps_list_length_hint_and_callback_order(tmp_path: Path) -> None:
    deps, fixture = row_fixture(tmp_path)
    events: list[str] = []
    props: list[object] = [{"name": "title", "type": "title", "translatable": True}]

    class Properties:
        def __iter__(self) -> Iterator[object]:
            events.append("iter")
            return iter(props)

        def __len__(self) -> int:
            events.append("len")
            return len(props)

    class Table(dict[object, object]):
        reads = 0

        def get(self, key: object, default: object = None) -> object:
            if key == "properties":
                self.reads += 1
                events.append(f"get-{self.reads}")
                return Properties()
            return super().get(key, default)

    fixture.table = Table(id="table", translation_enabled=True)
    asyncio.run(row_service.translate_row(
        "origin", ["es"], translate_fn=fixture.text, detect_fn=lambda _text: "ca",
        deepl_api_key="", background_tasks=BackgroundTasks(), dependencies=deps,
    ))
    assert events == ["get-1", "len", "iter", "get-2", "len", "iter", "len"]


def test_source_status_preserves_persist_before_key_resolution(tmp_path: Path) -> None:
    deps, fixture = row_fixture(tmp_path)
    prop: RegistryData = {8: object(), "id": "status"}
    events: list[str] = []

    def key(_metadata: RegistryData, received: RegistryData) -> str:
        assert received is prop
        events.append("key")
        return "status"

    def write(*_args: object) -> bool:
        events.append("write")
        return False

    deps = replace(deps, status_effect=lambda *_args: (prop, "Done", True),
                   persist_status_options=lambda *_args: events.append("persist"),
                   effect_write_key=key,
                   write_metadata_key=write)
    asyncio.run(row_service._apply_source_status("origin", fixture.path, fixture.metadata, fixture.table, "table", deps))
    assert events == ["persist", "key", "write"]


def test_page_providers_positional_arity_and_existing_raw_id(tmp_path: Path) -> None:
    deps, fixture = page_fixture(tmp_path)
    fixture.existing["es"] = SimpleNamespace(id=42)
    result = asyncio.run(page_service.translate_page(BackgroundTasks(), {
        "page_id": 7, "target_languages": ["ca", "ES", "fr", "fr", None],
    }, deps))
    assert result["page_id"] == "7" and result["status"] == "ok"
    assert result["updated"] == [{"id": 42, "lang": "es", "providers": ["synthetic"], "title": "Original-es"}]
    assert len(fixture.creates) == 2 and fixture.patches[0][0] == "42"
    assert fixture.patches[0][1].content == "Body-es"
    assert ("title", "Original", "ca", "es", "synthetic-key") in fixture.trace
    assert ("markdown", "Body", "ca", "es", "synthetic-key") in fixture.trace
    assert fixture.metadata["title"] == "Original"


@pytest.mark.parametrize("payload,detail", [
    ({"page_id": "", "target_languages": 7}, "page_id is required"),
    ({"page_id": "x", "target_languages": 7, "button_action": "bad"}, "target_languages must be a non-empty list"),
    ({"page_id": "x", "target_languages": ["es"], "button_action": "bad"}, "Unsupported button_action: bad"),
])
def test_page_validation_order(payload: dict[str, object], detail: str) -> None:
    with pytest.raises(HTTPException) as error:
        page_service._validated_payload(payload)
    assert error.value.status_code == 400 and error.value.detail == detail


def test_page_provider_failure_skips_only_failed_language(tmp_path: Path) -> None:
    deps, fixture = page_fixture(tmp_path)

    def title(text: str, src: str, tgt: str, /, *, deepl_api_key: str) -> tuple[str, str]:
        if tgt == "es":
            raise ValueError("synthetic failure")
        return fixture.title(text, src, tgt, deepl_api_key=deepl_api_key)

    deps = replace(deps, load_translators=lambda: (fixture.markdown, title, lambda _text: "ca"))
    result = asyncio.run(page_service.translate_page(BackgroundTasks(), {"page_id": "origin", "target_languages": ["es", "fr"]}, deps))
    assert result["skipped"] == [{"lang": "es", "reason": "translate failed: synthetic failure"}]
    assert len(fixture.creates) == 1 and fixture.creates[0].metadata["translation_lang"] == "fr"


def test_page_dictionary_lookup_value_still_uses_attribute_only(tmp_path: Path) -> None:
    deps, fixture = page_fixture(tmp_path)
    fixture.existing["es"] = {"id": "not-an-attribute"}
    asyncio.run(page_service.translate_page(BackgroundTasks(), {"page_id": "origin", "target_languages": ["es"]}, deps))
    assert len(fixture.creates) == 1 and fixture.patches == []
