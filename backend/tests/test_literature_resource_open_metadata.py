"""Literature keys need only read-only named fields, never a mutable JSON shape."""

from __future__ import annotations

from pathlib import Path
from types import MappingProxyType

import pytest

from backend.domains.vault.registry.records import RecordReader
from backend.domains.vault.registry.state import RegistryData
from backend.services import literature_import_service as literature


@pytest.mark.parametrize(
    ("metadata", "expected"),
    [({"DOI": "https://doi.org/10.1000/synthetic"}, "doi:10.1000/synthetic"),
     ({"PMID": 123}, "pmid:123"), ({"PMCID": "pmc123"}, "pmcid:PMC123"),
     ({"arXiv": "2101.00001v3"}, "arxiv:2101.00001"),
     ({"ISBN": "invalid; 9780306406157"}, "isbn13:9780306406157"),
     ({"Title": "Synthetic", "Any": 2026, "Authors": "Riu, Ada; Sol, Pau"},
      "tay:synthetic|2026|riu"), ({}, "")],
)
def test_resource_keys_accept_open_and_readonly_records(
    metadata: RegistryData, expected: str
) -> None:
    marker = object()
    metadata[None] = marker
    before = dict(metadata)
    assert literature._resource_key(metadata) == expected
    readonly: MappingProxyType[object, object] = MappingProxyType(metadata)
    assert literature._resource_key(readonly) == expected
    assert metadata == before and metadata[None] is marker


def test_resource_key_accepts_string_key_projection() -> None:
    projection: dict[str, str] = {"DOI": "10.1000/synthetic"}
    reader: RecordReader = projection
    assert literature._resource_key(reader) == "doi:10.1000/synthetic"


def test_resource_key_preserves_repeated_get_and_priority() -> None:
    calls: list[str] = []

    class ReadOnly:
        def get(self, key: str, /) -> object:
            calls.append(key)
            assert key == "DOI"
            return "10.1000/first" if len(calls) == 1 else "10.1000/second"

    assert literature._resource_key(ReadOnly()) == "doi:10.1000/second"
    assert calls == ["DOI", "DOI"]


def test_resource_key_keeps_native_reader_exception_identity() -> None:
    failure = RuntimeError("synthetic read failure")

    class ReadOnly:
        def get(self, key: str, /) -> object:
            raise failure

    with pytest.raises(RuntimeError) as caught:
        literature._resource_key(ReadOnly())
    assert caught.value is failure


def test_existing_resource_lookup_preserves_metadata_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from backend.api import vault_routes

    source = tmp_path / "synthetic.md"
    source.write_text("synthetic", encoding="utf-8")
    opaque = object()
    metadata: RegistryData = {
        7: opaque, "id": "resource", "title": "Synthetic", "DOI": "10.1000/synthetic"
    }

    def parse(raw: str, path: Path) -> tuple[RegistryData, str]:
        assert raw == "synthetic" and path == source
        return metadata, ""

    monkeypatch.setattr(vault_routes, "_resolve_table_folder_from_metadata", lambda _md: tmp_path)
    monkeypatch.setattr(vault_routes, "parse_frontmatter", parse)
    existing = literature._existing_resources("table")
    assert existing["doi:10.1000/synthetic"]["metadata"] is metadata
    assert metadata[7] is opaque
