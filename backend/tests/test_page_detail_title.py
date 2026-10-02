"""Detail titles agree with localized schema storage without rewriting pages."""

import asyncio
from types import SimpleNamespace
import threading

import pytest

from backend.domains.vault.api import pages_queries
from backend.domains.vault.pages import foundation


@pytest.mark.parametrize("name", ["Títol", "Título", "Title", "Titre"])
@pytest.mark.parametrize("stored_key", ["name", "id", "alias"])
def test_schema_title_resolves_current_name_id_and_alias(tmp_path, monkeypatch, name, stored_key):
    table = {"id": "qa", "properties": [{"id": "fld_12345678", "name": name, "type": "title", "aliases": ["Old title"]}]}
    monkeypatch.setattr(foundation, "_legacy", SimpleNamespace(_table_by_id=lambda _id: table))
    monkeypatch.setattr(foundation, "_resolve_page_context_from_path", lambda *_args: ("QA", "qa"))
    key = {"name": name, "id": "fld_12345678", "alias": "Old title"}[stored_key]
    metadata = {key: "El papa de mis sueños", "opaque": {"keep": True}}
    assert foundation._query_page_title(metadata, tmp_path / "Other.md") == "El papa de mis sueños"
    assert metadata == {key: "El papa de mis sueños", "opaque": {"keep": True}}
    assert foundation._query_page_title({key: ""}, tmp_path / "Other.md") == ""


def test_detail_captures_title_before_response_names_remove_canonical_key(tmp_path, monkeypatch):
    path = tmp_path / "Fixture.md"
    path.write_text("fixture")
    main_thread = threading.get_ident()
    async def materialize(*_args):
        return None
    def title(metadata, _path):
        assert threading.get_ident() != main_thread
        return metadata["title"]
    ports = SimpleNamespace(find_page=lambda _id: path, materialize_page=materialize,
                            is_dashboard=lambda _path: False, parse_frontmatter=lambda *_args: ({"id": "p", "title": "Actual title"}, "Body"),
                            resolve_title=title,
                            enrich_single_page=lambda metadata, *_args: ({"id": metadata["id"], "Títol": metadata["title"]}, "QA", "table"),
                            file_etag=lambda _path: "etag")
    monkeypatch.setattr(pages_queries, "_deps", lambda: ports)
    result = asyncio.run(pages_queries.get_page("p"))
    assert result["title"] == "Actual title" and result["metadata"] == {"id": "p", "Títol": "Actual title"}
    assert path.read_text() == "fixture"
