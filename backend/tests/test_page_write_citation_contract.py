"""Synthetic save/patch citation contracts; run through verify_typed_drawings.py."""

from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from datetime import date
from pathlib import Path
from types import MappingProxyType
from typing import assert_type

import pytest


@pytest.fixture(autouse=True)
def citation_callbacks(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    root = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    assert root.is_absolute() and root.is_dir()
    assert Path(os.environ["DIGITAL_BRAIN_VAULT_PATH"]).is_relative_to(root)
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"
    assert os.environ["GNOSI_DISABLE_SCHEDULER"] == "1"

    from backend.api import vault_routes as vault
    from backend.services import context_vars

    calls: list[str] = []

    def reference() -> str:
        calls.append("reference")
        return "references"

    def table_id(metadata: Mapping[str, object] | Mapping[object, object]) -> object:
        calls.append("table-id")
        return metadata.get("table_id")

    def table(identifier: str) -> dict[object, object]:
        assert identifier == "references"
        calls.append("table")
        return {"properties": [{"name": "Citation Key"}], 7: object()}

    def existing() -> set[str]:
        calls.append("existing")
        return set()

    monkeypatch.setattr(vault, "get_reference_table_id", reference)
    monkeypatch.setattr(vault, "get_table_id", table_id)
    monkeypatch.setattr(vault, "_table_by_id", table)
    monkeypatch.setattr(vault, "_existing_citation_keys", existing)
    monkeypatch.setattr(vault, "_ensure_cite_key_index", lambda _path: {})
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: root / "vault")
    return calls


def test_open_and_string_metadata_keep_identity_and_types() -> None:
    from backend.domains.vault.citations.lookup_routes import (
        _dedupe_citation_key,
        _ensure_recursos_citation_key,
    )

    extension = {date(2026, 8, 31): [b"opaque", object()]}
    open_metadata: dict[object, object] = {
        "table_id": "references", "Title": "Synthetic title", 9: extension,
    }
    string_metadata: dict[str, object] = {
        "table_id": "references", "Title": "Synthetic title", "extension": extension,
    }
    assert assert_type(
        _ensure_recursos_citation_key(open_metadata), dict[object, object]
    ) is open_metadata
    assert assert_type(
        _ensure_recursos_citation_key(string_metadata), dict[str, object]
    ) is string_metadata
    assert assert_type(_dedupe_citation_key(open_metadata, "new"), dict[object, object]) is open_metadata
    assert assert_type(_dedupe_citation_key(string_metadata, "new"), dict[str, object]) is string_metadata
    assert open_metadata[9] is string_metadata["extension"] is extension
    assert list(open_metadata) == ["table_id", "Title", 9, "Citation Key"]
    assert list(string_metadata) == ["table_id", "Title", "extension", "Citation Key"]
    assert open_metadata["Citation Key"] == string_metadata["Citation Key"] == "syntheticnd"


@pytest.mark.parametrize("helper", ["_ensure_recursos_citation_key", "_dedupe_citation_key"])
@pytest.mark.parametrize("reference", [None, "references"])
def test_non_reference_gate_does_not_read_metadata_or_index(
    monkeypatch: pytest.MonkeyPatch, citation_callbacks: list[str],
    helper: str, reference: str | None,
) -> None:
    from backend.api import vault_routes as vault
    from backend.domains.vault.citations import lookup_routes

    monkeypatch.setattr(vault, "get_reference_table_id", lambda: reference)
    metadata: dict[object, object] = {"table_id": "unrelated", 1: object()}
    if helper == "_ensure_recursos_citation_key":
        result = lookup_routes._ensure_recursos_citation_key(metadata)
    else:
        result = lookup_routes._dedupe_citation_key(metadata, "new")
    assert result is metadata and len(metadata) == 2
    assert citation_callbacks == ([] if reference is None else ["table-id"])


def test_ensure_keeps_explicit_table_and_resolves_callbacks_lazily(
    monkeypatch: pytest.MonkeyPatch, citation_callbacks: list[str],
) -> None:
    from backend.api import vault_routes as vault
    from backend.domains.vault.citations.lookup_routes import _ensure_recursos_citation_key

    raw_author: dict[object, object] = {"cognom1": "Synthetic", 12: object()}
    selected = [raw_author]
    title, year = object(), object()
    metadata: dict[object, object] = {
        "table_id": "references", "Any": year, "Title": title, 4: selected,
    }
    table: dict[object, object] = {8: object(), "properties": []}
    occupied = {"old"}

    def property_name(value: object) -> str:
        assert value is table
        citation_callbacks.append("property")
        return "  Citation KEY  "

    def authors(value: object) -> list[dict[object, object]]:
        assert value is metadata
        citation_callbacks.append("authors")
        return selected

    def existing() -> set[str]:
        citation_callbacks.append("existing")
        return occupied

    def generate(authors: object, raw_year: object, raw_title: object, keys: object) -> str:
        assert authors is selected and raw_year is year and raw_title is title
        assert keys is occupied
        citation_callbacks.append("generate")
        return "new-key"

    monkeypatch.setattr(vault, "_citation_key_prop_name", property_name)
    monkeypatch.setattr(vault, "_find_structured_authors", authors)
    monkeypatch.setattr(vault, "_existing_citation_keys", existing)
    monkeypatch.setattr(vault, "generate_citation_key", generate)
    assert _ensure_recursos_citation_key(metadata, table) is metadata
    assert metadata["  Citation KEY  "] == "new-key"
    assert metadata[4] is selected and selected[0] is raw_author
    assert citation_callbacks == [
        "reference", "table-id", "property", "authors", "existing", "generate",
    ]


@pytest.mark.parametrize("regenerate", [False, True])
def test_existing_key_only_changes_when_regenerated(
    citation_callbacks: list[str], regenerate: bool,
) -> None:
    from backend.domains.vault.citations.lookup_routes import _ensure_recursos_citation_key

    metadata: dict[object, object] = {
        "table_id": "references", "Authors": "Synthetic, Author", "Citation Key": "  keep  ",
    }
    assert _ensure_recursos_citation_key(metadata, regenerate=regenerate) is metadata
    assert metadata["Citation Key"] == ("syntheticnd" if regenerate else "  keep  ")
    assert citation_callbacks == ["reference", "table-id", "table"] + (
        ["existing"] if regenerate else []
    )


@pytest.mark.parametrize("extra", [{}, {"Authors": [], "Any": 0, "Title": False}])
def test_empty_bibliography_never_reads_existing_keys(
    citation_callbacks: list[str], extra: dict[object, object],
) -> None:
    from backend.domains.vault.citations.lookup_routes import _ensure_recursos_citation_key

    metadata: dict[object, object] = {"table_id": "references", 1: object(), **extra}
    assert _ensure_recursos_citation_key(metadata) is metadata
    assert "Citation Key" not in metadata
    assert citation_callbacks == ["reference", "table-id", "table"]


def test_empty_generation_and_generator_errors_do_not_mutate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as vault
    from backend.domains.vault.citations.lookup_routes import _ensure_recursos_citation_key

    metadata: dict[object, object] = {"table_id": "references", "Title": "Synthetic"}
    monkeypatch.setattr(vault, "generate_citation_key", lambda *_args: "")
    assert _ensure_recursos_citation_key(metadata) is metadata
    assert "Citation Key" not in metadata
    error = LookupError("synthetic generator failure")

    def fail(*_args: object) -> str:
        raise error

    monkeypatch.setattr(vault, "generate_citation_key", fail)
    with pytest.raises(LookupError) as caught:
        _ensure_recursos_citation_key(metadata)
    assert caught.value is error and "Citation Key" not in metadata


def test_authors_scan_first_matching_list_preserving_raw_records() -> None:
    from backend.domains.vault.citations import authors, export_routes

    extension = object()
    first: dict[object, object] = {"nom": "Synthetic", 8: extension}
    other: dict[object, object] = {date(2026, 8, 31): extension}
    raw = ["ignored", first, MappingProxyType({"nom": "ignored"}), other, None]
    metadata: dict[object, object] = {
        "tags": ["only text"], 2: raw, "later": [{"nom": "later"}],
    }
    for find in (authors.find_structured_authors, export_routes._find_structured_authors):
        result = find(metadata)
        assert len(result) == 2 and result is not raw
        assert result[0] is first and result[1] is other
        assert result[0][8] is extension
        assert metadata[2] is raw and list(metadata) == ["tags", 2, "later"]
        assert find({"tags": ["a", {}]}) == []


def test_author_wrapper_resolves_replaced_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.vault.citations import authors, export_routes

    metadata: dict[object, object] = {1: object()}
    selected: list[dict[object, object]] = [{3: object()}]

    def find(value: object) -> list[dict[object, object]]:
        assert value is metadata
        return selected

    monkeypatch.setattr(authors, "find_structured_authors", find)
    assert export_routes._find_structured_authors(metadata) is selected


def test_structured_csl_reader_accepts_open_records_without_changing_output() -> None:
    from backend.domains.vault.citations import authors, export_routes
    from backend.domains.vault.registry.records import RecordReader

    extension = object()
    open_record: dict[object, object] = {"cognom1": "Synthetic", "nom": "Author", 6: extension}
    string_record: dict[str, object] = {"nom": "Institution", "extra": extension}
    readers: list[RecordReader] = [open_record, string_record]
    assert authors.structured_authors_to_csl(readers) == [
        {"family": "Synthetic", "given": "Author"}, {"literal": "Institution"},
    ]
    assert export_routes._structured_authors_to_csl([string_record]) == [{"literal": "Institution"}]
    assert open_record[6] is string_record["extra"] is extension
    assert readers[0] is open_record and readers[1] is string_record


def test_property_open_mapping_keeps_default_reads_and_stops_at_first_match() -> None:
    from backend.domains.vault.citations.export_routes import _citation_key_prop_name

    calls: list[str] = []
    name = "  Citation KEY  "

    def properties() -> Iterator[Mapping[object, object]]:
        calls.append("first")
        yield {"name": name, 7: object()}
        raise AssertionError("read beyond first matching property")

    source = properties()

    class Table(dict[object, object]):
        def get(self, key: object, default: object = None) -> object:
            calls.append("get")
            assert key == "properties" and default == []
            return source

    table = Table({1: object()})
    assert _citation_key_prop_name(table) is name
    assert calls == ["get", "first"] and len(table) == 1
    string_table: dict[str, object] = {"properties": [{"name": name}]}
    assert _citation_key_prop_name(MappingProxyType(string_table)) is name


@pytest.mark.parametrize("properties,message", [
    (3, "Citation table properties must be iterable"),
    ([3], "Citation table properties must contain mappings"),
])
def test_property_errors_keep_their_boundary(properties: object, message: str) -> None:
    from backend.domains.vault.citations.export_routes import _citation_key_prop_name

    table: dict[object, object] = {4: object(), "properties": properties}
    with pytest.raises(TypeError, match=message):
        _citation_key_prop_name(table)


@pytest.mark.parametrize("holder_id,expected", [("new", "  hand  "), ("other", "handb")])
def test_dedupe_preserves_index_and_identity_with_lazy_suffix_callback(
    monkeypatch: pytest.MonkeyPatch, citation_callbacks: list[str],
    holder_id: str, expected: str,
) -> None:
    from backend.api import vault_routes as vault
    from backend.domains.vault.citations.lookup_routes import _dedupe_citation_key
    from backend.services import context_vars

    root = Path(os.environ["GNOSI_VALIDATION_ROOT"]) / "vault"
    index = {"hand": {"id": holder_id}, "handa": {"id": "other"}, "handb": {"id": "new"}}
    metadata: dict[object, object] = {"table_id": "references", "Citation Key": "  hand  "}

    def active() -> Path:
        citation_callbacks.append("active")
        return root

    def ensure(path: str) -> dict[str, dict[str, str]]:
        assert path == str(root)
        citation_callbacks.append("index")
        return index

    def suffix(value: int) -> str:
        citation_callbacks.append(f"suffix:{value}")
        return "ab"[value]

    monkeypatch.setattr(context_vars, "get_active_vault_path", active)
    monkeypatch.setattr(vault, "_ensure_cite_key_index", ensure)
    monkeypatch.setattr(vault, "_alpha_suffix", suffix)
    assert _dedupe_citation_key(metadata, "new") is metadata
    assert metadata["Citation Key"] == expected
    assert index == {"hand": {"id": holder_id}, "handa": {"id": "other"}, "handb": {"id": "new"}}
    assert citation_callbacks == ["reference", "table-id", "table", "active", "index"] + (
        [] if holder_id == "new" else ["suffix:0", "suffix:1"]
    )


@pytest.mark.parametrize("stage", ["no-vault", "active-error", "index-error", "blank-key"])
def test_dedupe_best_effort_and_early_return_boundaries(
    monkeypatch: pytest.MonkeyPatch, stage: str,
) -> None:
    from backend.api import vault_routes as vault
    from backend.domains.vault.citations.lookup_routes import _dedupe_citation_key
    from backend.services import context_vars

    calls: list[str] = []

    def active() -> None:
        calls.append("active")
        if stage == "active-error":
            raise RuntimeError("synthetic active error")
        return None

    def index(_path: str) -> dict[str, dict[str, object]]:
        calls.append("index")
        raise RuntimeError("synthetic index error")

    if stage != "index-error":
        monkeypatch.setattr(context_vars, "get_active_vault_path", active)
    monkeypatch.setattr(vault, "_ensure_cite_key_index", index)
    key = "   " if stage == "blank-key" else "hand"
    metadata: dict[object, object] = {"table_id": "references", "Citation Key": key}
    assert _dedupe_citation_key(metadata, "new") is metadata
    assert metadata["Citation Key"] == key
    assert calls == ([] if stage == "blank-key" else ["index" if stage == "index-error" else "active"])


def test_dedupe_does_not_swallow_malformed_holder_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.api import vault_routes as vault
    from backend.domains.vault.citations.lookup_routes import _dedupe_citation_key

    monkeypatch.setattr(vault, "_ensure_cite_key_index", lambda _path: {"hand": 3})
    metadata: dict[object, object] = {"table_id": "references", "Citation Key": "hand"}
    with pytest.raises(AttributeError, match="get"):
        _dedupe_citation_key(metadata, "new")
    assert metadata["Citation Key"] == "hand"
