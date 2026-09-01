"""Synthetic persistence contracts for Wiki metadata and property records."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from backend.domains.llm_wiki import writing
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.state import RegistryData
from backend.services import llm_wiki


@dataclass
class _Page:
    id: str
    path: Path
    metadata: PageMetadata


def _dependencies(root: Path) -> writing.WritingDependencies:
    return writing.WritingDependencies(
        get_pages_for_table=lambda table_id: [],
        get_unique_filepath=lambda folder, title, suffix: folder / f"{title}{suffix}",
        resolve_table_folder=lambda metadata: root,
        table_by_id=lambda table_id: {},
        parse_frontmatter=lambda content, path: ({}, "Body"),
        register_page_in_index=lambda path: None,
        save_page_md=lambda path, metadata, body: None,
        load_config=lambda: {},
        note_type_value=lambda kind, config, prop=None: "Reading",
        page_metadata=lambda page: page.metadata if isinstance(page, _Page) else {},
        merge_page_metadata=lambda metadata, page_id: metadata,
        prepare_managed_markdown=lambda metadata: metadata,
        base_note_metadata=llm_wiki._base_note_metadata,
        fonts_ids=llm_wiki._fonts_ids,
        page_path=lambda page: page.path if isinstance(page, _Page) else None,
        apply_dimensions=llm_wiki._apply_dimensions_to_metadata,
        effective_dimensions=llm_wiki._effective_dimensions,
        render_citations=lambda citations, title, page_id, table_id: "",
        replace_note_block=llm_wiki._replace_note_block,
        today=lambda: "2026-01-01",
        uuid_factory=lambda: "synthetic-created",
        generated_note_type="lectura",
    )


def test_update_keeps_open_metadata_identity_and_callback_order(tmp_path: Path) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("Owned fixture", encoding="utf-8")
    key = object()
    value = object()
    old: PageMetadata = {key: value, 7: value, "id": "old-id"}
    incoming: PageMetadata = {"title": "Updated", "id": "new-id"}
    portable: PageMetadata = {11: value}
    page = _Page("page-id", path, old)
    events: list[str] = []

    def parse(content: str, file_path: Path) -> tuple[PageMetadata, str]:
        assert content == "Owned fixture" and file_path == path
        events.append("parse")
        return old, "Original body"

    def merge(metadata: PageMetadata, page_id: str) -> PageMetadata:
        assert metadata is old and page_id == "page-id"
        events.append("merge")
        return metadata

    def prepare(metadata: PageMetadata) -> PageMetadata:
        assert metadata is old and metadata["id"] == "new-id"
        assert metadata[key] is value and metadata[7] is value
        events.append("prepare")
        return portable

    def block(body: str, managed_key: str, managed_body: str) -> str:
        assert (body, managed_key, managed_body) == ("Original body", "key", "Managed body")
        events.append("block")
        return "Replaced body"

    def save(file_path: Path, metadata: PageMetadata, body: str) -> None:
        assert file_path == path and metadata is portable and body == "Replaced body"
        events.append("save")

    dependencies = replace(
        _dependencies(tmp_path),
        parse_frontmatter=parse,
        merge_page_metadata=merge,
        prepare_managed_markdown=prepare,
        replace_note_block=block,
        save_page_md=save,
        register_page_in_index=lambda path: events.append("index"),
    )
    assert writing._update_existing_page(page, incoming, "key", "Managed body", dependencies)
    assert events == ["parse", "merge", "prepare", "block", "save", "index"]
    assert old[key] is value and incoming == {"title": "Updated", "id": "new-id"}


def test_new_note_preserves_property_extensions_and_output_envelope(tmp_path: Path) -> None:
    key = object()
    value = object()
    prop: RegistryData = {"id": "note-type", "name": "Note type", key: value}
    saved: list[PageMetadata] = []

    def note_type(
        kind: str, config: dict[str, object], actual_prop: RegistryData | None = None
    ) -> str:
        assert actual_prop is not None and actual_prop is not prop
        assert actual_prop[key] is value
        return "Reading"

    def base(
        note: dict[str, object], title: str, page_id: str, position: int | None
    ) -> PageMetadata:
        return {key: value, 7: value}

    dependencies = replace(
        _dependencies(tmp_path),
        table_by_id=lambda table_id: {"properties": [prop]},
        note_type_value=lambda kind, config, prop=None: note_type(kind, config, prop),
        base_note_metadata=base,
        save_page_md=lambda path, metadata, body: saved.append(metadata),
    )
    result = writing.apply_plan(
        {"notes": [{"title": "Synthetic", "managed_key": "key"}]},
        "source",
        "Source",
        "brain",
        config={"brain_roles": {"note_type": "note-type"}},
        dependencies=dependencies,
    )
    assert result == {"created": ["Synthetic"], "created_ids": ["synthetic-created"], "updated": []}
    assert saved[0][key] is value and saved[0][7] is value
    assert saved[0]["Note type"] == "Reading"


def test_stale_note_retains_open_keys_original_body_and_prepare_before_save(tmp_path: Path) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("Owned fixture", encoding="utf-8")
    value = object()
    metadata: PageMetadata = {
        "id": "page",
        "llm_wiki_key": "stale-key",
        "llm_wiki_resource_id": "source",
        7: value,
    }
    page = _Page("page", path, metadata)
    events: list[str] = []

    def prepare(actual: PageMetadata) -> PageMetadata:
        assert actual["llm_wiki_stale"] is True and actual[7] is value
        events.append("prepare")
        return actual

    def save(file_path: Path, actual: PageMetadata, body: str) -> None:
        assert file_path == path and actual is metadata and body == "Original body"
        events.append("save")

    dependencies = replace(
        _dependencies(tmp_path),
        get_pages_for_table=lambda table_id: [page],
        parse_frontmatter=lambda content, path: (metadata, "Original body"),
        prepare_managed_markdown=prepare,
        save_page_md=save,
        register_page_in_index=lambda path: events.append("index"),
    )
    assert writing.apply_plan(
        {"notes": []}, "source", "Source", "brain", dependencies=dependencies
    ) == {"created": [], "created_ids": [], "updated": []}
    assert events == ["prepare", "save", "index"]
    assert metadata[7] is value


def test_failed_prepare_does_not_save_or_register(tmp_path: Path) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("Owned fixture", encoding="utf-8")
    page = _Page("page", path, {})
    events: list[str] = []
    failure = OSError("synthetic storage failure")

    def prepare(metadata: PageMetadata) -> PageMetadata:
        raise failure

    dependencies = replace(
        _dependencies(tmp_path),
        prepare_managed_markdown=prepare,
        save_page_md=lambda path, metadata, body: events.append("save"),
        register_page_in_index=lambda path: events.append("index"),
    )
    with pytest.raises(OSError) as actual:
        writing._update_existing_page(page, {}, "key", "body", dependencies)
    assert actual.value is failure and events == []
    assert path.read_text(encoding="utf-8") == "Owned fixture"


class _SingleIterator(Iterator[object]):
    def __init__(self, value: object, events: list[str]) -> None:
        self.value = value
        self.events = events
        self.finished = False

    def __iter__(self) -> Iterator[object]:
        raise AssertionError("Do not call iter on the returned iterator a second time")

    def __next__(self) -> object:
        self.events.append("next")
        if self.finished:
            raise StopIteration
        self.finished = True
        return self.value


class _Properties:
    def __init__(self, value: object, events: list[str]) -> None:
        self.value = value
        self.events = events

    def __iter__(self) -> Iterator[object]:
        self.events.append("iter")
        return _SingleIterator(self.value, self.events)


def test_property_iteration_is_single_and_keeps_opaque_keys_in_native_copy() -> None:
    value = object()
    prop: RegistryData = {"id": "prop", 7: value}
    events: list[str] = []
    result = writing._properties_by_id({"properties": _Properties(prop, events)})
    assert result["prop"] is not prop and result["prop"][7] is value
    assert events == ["iter", "next", "next"]


@pytest.mark.parametrize("value", [7, True, 1.5])
def test_property_container_retains_native_iteration_error(value: object) -> None:
    with pytest.raises(TypeError) as expected:
        eval("[item for item in value]", {"value": value})
    with pytest.raises(type(expected.value)) as actual:
        writing._properties_by_id({"properties": value})
    assert str(actual.value) == str(expected.value)


class _Position:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def __int__(self) -> int:
        self.events.append("int")
        return 7


def test_legacy_position_keeps_native_numeric_protocol(tmp_path: Path) -> None:
    events: list[str] = []
    metadata: PageMetadata = {
        "note_type": "lectura",
        "Font": "[[Source|source]]",
        "Posició": _Position(events),
        11: object(),
    }
    page = _Page("page", tmp_path / "synthetic.md", metadata)
    dependencies = replace(_dependencies(tmp_path), get_pages_for_table=lambda table_id: [page])
    existing = writing._collect_existing_notes("brain", "source", dependencies)
    assert existing.legacy_by_position[7][0] is page
    assert events == ["int"]


@pytest.mark.parametrize("value", ["invalid", [1], {"position": 1}])
def test_invalid_legacy_position_keeps_existing_skip(tmp_path: Path, value: object) -> None:
    metadata: PageMetadata = {"note_type": "lectura", "Font": "[[Source|source]]", "Posició": value}
    page = _Page("page", tmp_path / "synthetic.md", metadata)
    dependencies = replace(_dependencies(tmp_path), get_pages_for_table=lambda table_id: [page])
    assert writing._collect_existing_notes("brain", "source", dependencies).legacy_by_position == {}
