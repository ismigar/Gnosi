"""Characterize open relation rules and API ports before narrowing their types."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.api import vault_routes as facade
from backend.domains.vault.links import runtime
from backend.domains.vault.links.api.dependencies import LinkApiDependencies
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.state import RegistryData
from backend.services import relation_sync as rules


class OpaqueName:
    def __str__(self) -> str:
        return " 🔗 Targets "


class AliasSequence:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def __getitem__(self, index: int) -> object:
        self.events.append(f"alias:{index}")
        if index:
            raise IndexError(index)
        return OpaqueName()


class InterruptedAliases:
    def __iter__(self) -> Iterator[object]:
        raise StopIteration("native alias stop")


def _tables(origin_id: object, aliases: object) -> tuple[RegistryData, RegistryData]:
    origin: RegistryData = {
        "id": origin_id,
        7: object(),
        "properties": [
            {
                "name": OpaqueName(),
                "type": "relation",
                "relation_database_id": "dest",
                "aliases": aliases,
            }
        ],
    }
    destination: RegistryData = {
        "properties": [{"name": "Back", "type": "relation", "relation_database_id": origin_id}]
    }
    return origin, destination


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, []),
        (0, []),
        (b"target", []),
        (("target",), []),
        (OpaqueName(), []),
        (" [[Title| target ]] ", ["target"]),
        ([" a ", "[[Title|a]]", None, 8, ["nested"], "", "[[Title]]"], ["a", "a", "[[Title]]"]),
    ],
)
def test_relation_ids_preserve_string_only_filter_and_duplicates(
    value: object,
    expected: list[str],
) -> None:
    assert rules.to_ids(value) == expected


def test_property_filter_keeps_dictionary_identity_and_open_keys() -> None:
    marker = object()
    relation: RegistryData = {8: marker, "name": OpaqueName(), "type": "relation"}
    properties: list[object] = [marker, relation, {"type": "text"}, None]
    table: RegistryData = {"properties": properties, 9: marker}
    result = rules._relations(table)
    assert len(result) == 1 and result[0] is relation
    assert result[0][8] is marker
    assert table["properties"] is properties
    assert rules._relations({"properties": (relation,)}) == []


def test_changes_keep_opaque_origin_id_and_native_alias_sequence_order() -> None:
    events: list[str] = []
    marker = object()
    aliases = AliasSequence(events)
    origin, destination = _tables(marker, aliases)
    old: PageMetadata = {1: marker, "Targets": ["old", None]}
    new: PageMetadata = {1: marker, "Targets": ["new", "new", marker]}

    def get_table(table_id: str) -> RegistryData | None:
        assert table_id == "dest"
        events.append("table")
        return destination

    assert rules.relation_changes(old, new, origin, get_table) == [
        ("new", "Back", "add"),
        ("old", "Back", "remove"),
    ]
    assert events == ["alias:0", "alias:1", "table"]
    assert origin["id"] is marker
    assert old[1] is marker and new[1] is marker
    assert old["Targets"] == ["old", None]
    assert new["Targets"] == ["new", "new", marker]


def test_truthy_noniterable_aliases_raise_original_type_error() -> None:
    origin, destination = _tables("origin", 7)
    with pytest.raises(TypeError, match="'int' object is not iterable"):
        rules.relation_changes({}, {"Targets": ["target"]}, origin, lambda _id: destination)


def test_iterator_stop_is_not_converted_to_runtime_error() -> None:
    origin, destination = _tables("origin", InterruptedAliases())
    with pytest.raises(StopIteration, match="native alias stop"):
        rules.relation_changes({}, {"Targets": ["target"]}, origin, lambda _id: destination)


def test_normalization_and_table_callback_errors_propagate_unchanged() -> None:
    assert rules._norm(OpaqueName()) == "targets"
    assert rules._norm(False) == ""
    origin, _ = _tables("origin", [])
    failure = LookupError("synthetic lookup")

    def broken_lookup(_table_id: str) -> RegistryData | None:
        raise failure

    with pytest.raises(LookupError) as raised:
        rules.resolve_inverse_relation(origin, "Targets", broken_lookup)
    assert raised.value is failure


def test_api_ports_keep_open_metadata_and_opaque_parent(tmp_path: Path) -> None:
    captured = runtime._LINK_API_DEPENDENCIES
    marker = object()
    metadata: PageMetadata = {7: marker}
    events: list[str] = []

    def parser(raw: str, path: Path) -> tuple[PageMetadata, str]:
        assert path == tmp_path
        events.append("parse")
        return metadata, raw

    def save(path: Path, value: PageMetadata, body: str) -> None:
        assert path == tmp_path and value is metadata and body == "raw"
        events.append("save")

    def dashboard(
        *,
        file_path: Path,
        page_id: str,
        title: str,
        metadata: PageMetadata,
        content: str,
        parent_id: object,
        is_database: bool,
    ) -> None:
        assert file_path == tmp_path and metadata[7] is marker and parent_id is marker
        events.append("dashboard")

    ports = LinkApiDependencies(
        read_state=captured.read_state,
        build_id_title_index=captured.build_id_title_index,
        build_alias_index=captured.build_alias_index,
        get_cache_path=captured.get_cache_path,
        resolve_kickoff_rebuild=captured.resolve_kickoff_rebuild,
        iter_documents=captured.iter_documents,
        find_page=captured.find_page,
        is_dashboard=captured.is_dashboard,
        read_dashboard=captured.read_dashboard,
        parse_frontmatter=parser,
        resolve_create_page_version=captured.resolve_create_page_version,
        write_dashboard=dashboard,
        save_page=save,
        resolve_update_index=captured.resolve_update_index,
        is_safe_external_url=captured.is_safe_external_url,
        build_browser_path=captured.build_browser_path,
    )
    parsed, body = ports.parse_frontmatter("raw", tmp_path)
    assert parsed is metadata
    ports.save_page(tmp_path, parsed, body)
    ports.write_dashboard(
        file_path=tmp_path,
        page_id="page",
        title="title",
        metadata=parsed,
        content=body,
        parent_id=marker,
        is_database=False,
    )
    assert events == ["parse", "save", "dashboard"]


def test_real_dashboard_writer_keeps_raw_parent_in_payload(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    marker = object()
    metadata: PageMetadata = {8: marker}
    payloads: list[object] = []

    def write(path: Path, value: object, *, indent: int, ensure_ascii: bool) -> None:
        assert path == tmp_path and indent == 2 and ensure_ascii is False
        payloads.append(value)

    monkeypatch.setattr(facade, "safe_write_json", write)
    runtime._LINK_API_DEPENDENCIES.write_dashboard(
        file_path=tmp_path,
        page_id="page",
        title="title",
        metadata=metadata,
        content="raw",
        parent_id=marker,
        is_database=False,
    )
    assert payloads == [
        {
            "id": "page",
            "title": "title",
            "parent_id": marker,
            "is_database": False,
            "metadata": metadata,
            "content": "raw",
        }
    ]
