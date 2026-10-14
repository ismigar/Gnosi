"""Full-body search semantics against synthetic documents and Vault scopes."""

from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from backend.domains.vault.search import api
from backend.domains.vault.search.query import SearchQueryError
from backend.domains.vault.search.service import SearchDocument, search_documents
from backend.services.context_vars import active_vault_path


def document(body: str, *, title: str = "Ordinary note", id: str = "one", **metadata: object) -> SearchDocument:
    return SearchDocument(id, title, f"Notes/{id}.md", body, metadata)


def ids(query: str, *documents: SearchDocument) -> list[str]:
    return [hit.id for hit in search_documents(documents, query).results]


def test_searches_complete_body_with_context_and_line():
    body = "Opening line\n" + "Unrelated paragraph\n" * 300 + "A very distant nebula appears here.\n"
    hit = search_documents([document(body)], '"distant nebula"').results[0]
    assert hit.line == 302
    assert "distant nebula" in hit.excerpt
    assert hit.excerpt.startswith("…")
    assert len(hit.excerpt) < 300


def test_boolean_precedence_negation_phrases_and_aliases():
    a = document("red fox", id="a", aliases=["Alternative name"])
    b = document("blue fox", id="b")
    c = document("green fox", id="c")
    assert ids('(red OR blue) AND fox -green', a, b, c) == ["a", "b"]
    assert ids('red OR blue AND NOT fox', a, b, c) == ["a"]
    assert ids('"Alternative name"', a, b) == ["a"]
    assert ids('"red blue"', a, b) == []


def test_structural_groups_must_match_the_same_unit_and_skip_code_tasks():
    a = document("# One\nred\nfox\n\n# Two\nblue\n- [ ] follow up\n- [x] sent\n```\n- [ ] fake\n```\n")
    assert ids('line:(red fox)', a) == []
    assert ids('block:(red fox)', a) == ["one"]
    assert ids('section:(red blue)', a) == []
    assert ids('section:(One fox)', a) == ["one"]
    assert ids('task-todo:"follow up"', a) == ["one"]
    assert ids('task-done:sent', a) == ["one"]
    assert ids('task:fake', a) == []


def test_filters_regex_and_properties():
    a = document("Llum de tarda", title="Català", tags=["research/notes"], status="Draft", score=4)
    assert ids('title:Català path:Notes content:/llum de Tarda/i [status:Draft] [score]', a) == ["one"]
    assert ids('tag:research', a) == ["one"]
    assert ids('[missing]', a) == []
    assert ids(r'content:/Llum\s+de/', a) == ["one"]
    assert ids('title:catala', a) == ["one"]
    assert ids('tag:search', a) == []


def test_grouped_tags_preserve_boundaries_hashes_and_nested_groups():
    page = document("", tags=["research/notes"])
    assert ids('tag:(search OR other)', page) == []
    assert ids('tag:(#research OR other)', page) == ["one"]
    assert ids('tag:((#research OR other) AND NOT archived)', page) == ["one"]


@pytest.mark.parametrize("delimiter", ["````", "~~~~"])
def test_structural_search_does_not_close_fences_on_short_or_annotated_lines(delimiter):
    page = document(f"{delimiter}\n{delimiter[:3]}\n- [ ] hidden-short\n{delimiter} text\n- [ ] hidden-annotated\n{delimiter}\n- [ ] visible\n")
    assert ids('task:hidden', page) == []
    assert ids('task:visible', page) == ["one"]


def test_setext_sections_and_indented_code_follow_markdown_structure():
    page = document("First\n=====\nneedle\n\nSecond\n======\nother\n\n    - [ ] literal-code\n\n- [ ] actual\n")
    assert ids('section:(needle Second)', page) == []
    assert ids('section:(First needle)', page) == ["one"]
    assert ids('task:literal-code', page) == []
    assert ids('task:actual', page) == ["one"]


@pytest.mark.parametrize("query", ['"unfinished', '(foo', 'foo OR', 'foo)', '/[/', '/foo/z', 'content:', '[', '(' * 22 + 'a' + ')' * 22])
def test_bad_queries_are_rejected(query):
    with pytest.raises(SearchQueryError):
        search_documents([document("text")], query)


def test_regular_expression_work_is_bounded():
    with pytest.raises(SearchQueryError, match="time budget"):
        search_documents([document("a" * 100000 + "!")], '/(a+)+$/')


def test_pagination_is_stable_and_counts_all_hits():
    pages = [document("matching", id=str(index), title=f"Page {index:02}") for index in range(15)]
    first = search_documents(pages, "matching", limit=5)
    second = search_documents(pages, "matching", offset=5, limit=5)
    assert first.total == second.total == 15
    assert {hit.id for hit in first.results}.isdisjoint(hit.id for hit in second.results)


def test_route_validates_query_and_uses_request_vault(tmp_path, monkeypatch):
    roots: list[Path] = []

    def inventory(root: Path):
        roots.append(root)
        return [document(root.name)]

    monkeypatch.setattr(api, "active_documents", inventory)
    app = FastAPI()
    router = APIRouter()
    api.register_routes(router)
    app.include_router(router, prefix="/api/vault")
    with TestClient(app) as client:
        token = active_vault_path.set(tmp_path / "first")
        try:
            assert client.get('/api/vault/search', params={"q": "first"}).json()["total"] == 1
            assert client.get('/api/vault/search', params={"q": "first", "limit": 101}).status_code == 422
            assert client.get('/api/vault/search', params={"q": "("}).status_code == 422
        finally:
            active_vault_path.reset(token)
        token = active_vault_path.set(tmp_path / "second")
        try:
            assert client.get('/api/vault/search', params={"q": "first"}).json()["total"] == 0
        finally:
            active_vault_path.reset(token)
    assert roots == [tmp_path / "first", tmp_path / "first", tmp_path / "second"]


def test_inventory_excludes_hidden_foreign_symlink_missing_and_dashboard_documents(tmp_path, monkeypatch, isolated_validation_runtime):
    from importlib import import_module

    # Initialize the legacy facade in its production order, in a disposable runtime.
    import_module("backend.api.vault_routes")
    from backend.domains.vault.links import runtime
    from backend.domains.vault.pages import foundation, tags

    root = tmp_path / "vault"
    root.mkdir()
    included = root / "visible.md"
    included.write_text("visible body")
    hidden = root / ".trash" / "deleted.md"
    hidden.parent.mkdir()
    hidden.write_text("hidden body")
    outside = tmp_path / "private.md"
    outside.write_text("other vault")
    link = root / "linked.md"
    link.symlink_to(outside)
    dashboard = root / "dashboard.md"
    dashboard.write_text("dashboard body")
    rows = [(path, {"id": path.stem, "tags": ["own"]}, path.stem, path == dashboard)
            for path in (included, hidden, outside, link, dashboard, root / "missing.md")]
    monkeypatch.setattr(runtime, "_iter_linkable_page_documents", lambda: rows)
    monkeypatch.setattr(foundation, "_query_page_title", lambda metadata, path: path.stem)
    monkeypatch.setattr(foundation, "_resolve_page_context_from_path", lambda metadata, path: ("", None))
    monkeypatch.setattr(tags, "_table_tag_fields", lambda: {})
    docs = list(api.active_documents(root))
    assert [(doc.id, doc.path, doc.body) for doc in docs] == [("visible", "visible.md", "visible")]
