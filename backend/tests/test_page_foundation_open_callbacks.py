"""Page-only synthetic regression cases for late callbacks and native errors."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.config.validation_runtime import validation_runtime_enabled
from backend.domains.vault.registry.state import RegistryData


@pytest.fixture(autouse=True)
def require_isolated_runner() -> None:
    assert validation_runtime_enabled(), "Run through verify_typed_drawings.py"


@pytest.mark.parametrize("second", [[("extension", 7)], None, 7, [1]])
def test_dashboard_second_get_uses_native_dictionary_constructor(
    second: object, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from backend.domains.vault.pages import foundation

    calls: list[object] = []

    class Document:
        def get(self, key: object) -> object:
            calls.append(key)
            if key == "metadata":
                return {} if calls.count("metadata") == 1 else second
            return None

    path = tmp_path / "Synthetic.json"
    path.write_text("synthetic mocked JSON input", encoding="utf-8")
    document = Document()
    monkeypatch.setattr(json, "loads", lambda _raw: document)
    try:
        native: object = eval("dict(second)", {}, {"second": second})
    except Exception as expected:
        with pytest.raises(type(expected)) as caught:
            foundation._read_dashboard_file(path)
        assert caught.value.args == expected.args
        assert calls == ["metadata", "metadata"]
    else:
        metadata, body = foundation._read_dashboard_file(path)
        assert native == {"extension": 7} and metadata["extension"] == 7
        assert body == "{}"
        assert calls == ["metadata", "metadata", "id", "title", "parent_id", "content"]


def test_fallback_captures_strip_before_table_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.pages import foundation

    opaque = object()
    metadata: RegistryData = {7: opaque, "Related": "[[Title|id]]"}
    calls: list[str] = []

    def strip(value: RegistryData, keys: set[str] | None) -> RegistryData:
        calls.append("strip")
        assert value is metadata and keys == {"Related"}
        return value

    def wrong_strip(value: RegistryData, keys: set[str] | None) -> RegistryData:
        raise AssertionError("Resolved strip callback after evaluating its arguments")

    def table_by_id(table_id: str) -> RegistryData:
        calls.append("table")
        monkeypatch.setattr(facade, "strip_relation_wikilinks", wrong_strip)
        return {"properties": [{"name": "Related", "type": "relation"}]}

    monkeypatch.setattr(facade, "apply_sidecar_to", lambda value, path: metadata)
    monkeypatch.setattr(facade, "get_table_id", lambda value: "synthetic-table")
    monkeypatch.setattr(facade, "_table_by_id", table_by_id)
    monkeypatch.setattr(facade, "strip_relation_wikilinks", strip)
    result, body = foundation.parse_frontmatter('---\ntitle: "unfinished\n---\nBody')
    assert result is metadata and result[7] is opaque and body == "Body"
    assert calls == ["table", "strip"]


def test_virtual_properties_generator_is_consumed_in_original_two_pass_order() -> None:
    from backend.domains.vault.pages import foundation

    calls: list[str] = []
    opaque = object()

    def properties() -> Iterator[object]:
        calls.append("next")
        yield {"name": "Derived", "id": "fld_derived", "type": "virtual"}

    metadata: RegistryData = {"Derived": 1, "fld_derived": 2, 7: opaque}
    result = foundation._strip_virtual_keys(metadata, {"properties": properties()})
    # The original second pass sees an exhausted iterator, so its ID remains.
    assert result == {"fld_derived": 2, 7: opaque} and result[7] is opaque
    assert calls == ["next"] and metadata["Derived"] == 1


@pytest.mark.parametrize("property_value", [None, 7, False, "scalar", []])
def test_virtual_properties_keep_native_attribute_errors(property_value: object) -> None:
    from backend.domains.vault.pages import foundation

    with pytest.raises(AttributeError) as caught:
        foundation._strip_virtual_keys({"field": 1}, {"properties": [property_value]})
    with pytest.raises(AttributeError) as expected:
        eval("property_value.get('type')", {}, {"property_value": property_value})
    assert caught.value.args == expected.value.args


@pytest.mark.parametrize("view", [None, 7, False, "scalar", []])
def test_view_revision_keeps_native_attribute_errors(view: object) -> None:
    from backend.domains.vault.pages import foundation

    with pytest.raises(AttributeError) as caught:
        foundation._table_views_revision({"views": [view]}, "synthetic")
    with pytest.raises(AttributeError) as expected:
        eval("view.get('table_id')", {}, {"view": view})
    assert caught.value.args == expected.value.args


def test_writer_keeps_raw_yaml_id_and_late_snapshot_callback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.pages import foundation

    host_id = ["synthetic", 7]
    opaque = [False, None]
    metadata: RegistryData = {"id": host_id, 7: opaque}
    seen: list[object] = []

    def inject(body: str, **kwargs: object) -> str:
        seen.append(kwargs["host_page_id"])
        return body

    monkeypatch.setattr(facade, "get_table_id", lambda _metadata: None)
    monkeypatch.setattr(facade, "inject_view_snapshots", inject)
    path = tmp_path / "Synthetic.md"
    foundation.save_page_md(path, metadata, " Body")
    assert seen == [host_id] and seen[0] is host_id
    assert metadata[7] is opaque and path.read_text().endswith("\nBody")
    parsed, _ = foundation.parse_frontmatter(path.read_text())
    assert parsed == metadata
