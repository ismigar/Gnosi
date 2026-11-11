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


def test_document_loading_does_not_spend_the_query_evaluation_budget(monkeypatch):
    from backend.domains.vault.search import service

    now = 0.0
    monkeypatch.setattr(service.time, "monotonic", lambda: now)

    def slow_documents():
        nonlocal now
        for index in range(3):
            # A cold/cloud-backed Vault can take longer to load than to search.
            now += 3.0
            yield document("matching body", id=str(index))

    result = search_documents(slow_documents(), "matching", budget_seconds=2.0)
    assert result.total == 3


def test_query_evaluation_budget_is_shared_across_documents(monkeypatch):
    from backend.domains.vault.search import service

    now = 0.0
    monkeypatch.setattr(service.time, "monotonic", lambda: now)
    original_evaluate = service.evaluate

    def expensive_evaluate(*args, **kwargs):
        nonlocal now
        result = original_evaluate(*args, **kwargs)
        now += 0.75
        return result

    monkeypatch.setattr(service, "evaluate", expensive_evaluate)
    with pytest.raises(SearchQueryError, match="time budget"):
        search_documents([document("matching")] * 3, "matching", budget_seconds=2.0)


@pytest.mark.parametrize("offset,limit", [(0, 50), (50, 10), (700, 50)])
def test_previews_are_built_only_for_the_returned_ranked_page(monkeypatch, offset, limit):
    from backend.domains.vault.search import service

    pages = [document(f"Opening\n**matching** note {index}.\n", id=str(index),
                      title=f"Note {index:04d}", tags=["research"])
             for index in reversed(range(600))]
    original = service.search_excerpt
    rendered = []

    def preview(body, position):
        rendered.append(body)
        return original(body, position)

    monkeypatch.setattr(service, "search_excerpt", preview)
    response = search_documents(pages, "matching", offset=offset, limit=limit)
    expected = sorted(pages, key=lambda page: (page.title.casefold(), page.id))[offset:offset + limit]
    assert response.total == 600
    assert [hit.id for hit in response.results] == [page.id for page in expected]
    assert rendered == [page.body for page in expected]
    assert all(hit.line == 2 and "matching" in hit.excerpt and "**" not in hit.excerpt
               and hit.tags == ["research"] for hit in response.results)


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


@pytest.mark.parametrize(
    "body",
    [
        ':::column-list\n:::column{width=50}\n## <span style="color:red">Research</span>\n- **Visible** [label](https://example.org)\n:::\n:::',
        '```gnosi-view\n{"view_id":"secret-id","section":{"filters":[]}}\n```\n# Research\nVisible label',
        '```json\n{"filters": ["private-config"]}\n```\n# Research\nVisible label',
    ],
)
def test_search_previews_expose_prose_instead_of_storage_syntax(body):
    hit = search_documents([document(body)], "Research").results[0]
    assert "Research" in hit.excerpt
    assert "Visible label" in hit.excerpt
    for syntax in (
        ":::",
        "##",
        "<span",
        "style=",
        "**",
        "](https",
        "view_id",
        "filters",
        "```",
    ):
        assert syntax not in hit.excerpt


def test_serialized_only_match_has_no_raw_json_preview():
    body = '```gnosi-view\n{"view_id":"secret-id"}\n```'
    hit = search_documents([document(body)], "secret-id").results[0]
    assert hit.excerpt == ""
    assert hit.line == 2


def test_preview_clips_after_removing_long_markup_attributes():
    body = (
        '## <span style="'
        + "color:red;" * 100
        + '">Research target</span>\nReadable context'
    )
    hit = search_documents([document(body)], "target").results[0]
    assert "Research target" in hit.excerpt
    assert "Readable context" in hit.excerpt
    assert "<span" not in hit.excerpt


@pytest.mark.parametrize(
    "body",
    [
        "| Name | Summary |\n| --- | --- |\n| Research | Visible prose |",
        "- [x] Research complete\n- [ ] Visible next step",
        ":::column-list\n\n:::column{width=50}\n\n# Research\nVisible prose\n:::\n:::",
    ],
)
def test_structured_prose_previews_hide_layout_and_task_markers(body):
    hit = search_documents([document(body)], "Research").results[0]
    assert "Research" in hit.excerpt
    assert "Visible" in hit.excerpt
    for marker in ("|", "---", "[x]", "[ ]", ":::", "#"):
        assert marker not in hit.excerpt
    assert hit.line == body[: body.index("Research")].count("\n") + 1


def test_long_link_destination_does_not_push_match_out_of_preview():
    body = (
        "[Label](https://example.org/"
        + "x" * 300
        + ") Research target "
        + "visible prose " * 40
    )
    hit = search_documents([document(body)], "Research").results[0]
    assert "Research target" in hit.excerpt
    assert "https://" not in hit.excerpt
    assert len(hit.excerpt) < 300


@pytest.mark.parametrize(
    "body", ["[1, 2, 3]", '{"view_id":"secret"}', '`{"view_id":"secret"}`']
)
def test_json_content_never_appears_as_raw_preview(body):
    hit = search_documents(
        [document(body, title="Research")], "title:Research"
    ).results[0]
    assert hit.excerpt == ""


@pytest.mark.parametrize(
    "directive",
    [
        ":::callout{type=info}",
        ":::toggle Research",
        ":::toggle-heading{level=2} Research",
    ],
)
def test_gnosi_container_previews_keep_prose_and_hide_directives(directive):
    body = directive + "\nResearch Visible prose\n:::"
    hit = search_documents([document(body)], "Research").results[0]
    assert "Research" in hit.excerpt
    assert "Visible prose" in hit.excerpt
    for marker in (":::", "type=", "level=", "toggle", "callout"):
        assert marker not in hit.excerpt
