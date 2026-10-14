"""Synthetic-only transactions, conflicts and Markdown fidelity for Note Composer."""

import asyncio
from pathlib import Path
from urllib.parse import quote

import pytest
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from markdown_it import MarkdownIt

from backend.domains.vault.composer import api
from backend.domains.vault.composer.markdown import rewrite_links, select
from backend.domains.vault.composer.schemas import ComposerApplyRequest, ComposerRequest
from backend.domains.vault.composer.service import ComposerDependencies, apply_plan, build_plan
from backend.domains.vault.pages.cache import get_page_write_lock
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


def parse(text: str, _path: Path):
    if text.startswith("---\n"):
        _, front, body = text.split("---\n", 2)
        return yaml.safe_load(front), body
    return {}, text


def save(path, metadata, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n" + yaml.safe_dump(metadata, allow_unicode=True) + "---\n" + body, encoding="utf-8"
    )


def make(root, page_id, body, **metadata):
    path = root / "Wiki" / f"{page_id}.md"
    save(path, {"id": page_id, "title": page_id.title(), **metadata}, body)
    return path


def deps(**overrides):
    return ComposerDependencies(
        parse=parse,
        save=overrides.get("save", save),
        refresh=lambda *_: None,
        unsupported_bodies=overrides.get("unsupported_bodies", lambda: []),
    )


def request(**overrides):
    return ComposerRequest(source_id="source", mode="extract", title="New note", **overrides)


def apply(root, preview, dependencies=None):
    return asyncio.run(
        apply_plan(
            root,
            ComposerApplyRequest(request=preview.request, token=preview.token),
            dependencies or deps(),
        )
    )


def rendered_references(markdown):
    def walk(tokens):
        for token in tokens:
            if token.type in {"link_open", "image"}:
                yield (
                    token.type,
                    token.attrGet("href") or token.attrGet("src"),
                    token.attrGet("title"),
                )
            yield from walk(token.children or [])

    return list(walk(MarkdownIt("commonmark").parse(markdown)))


def test_extract_heading_preserves_rich_markdown_metadata_links_and_history(tmp_path):
    source_body = (
        "Intro\n\n## Move\n\n**Bold** and $x$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nParagraph "
        "^block\n\n### Child\n\n[[#Stay]]\n\n## Stay\n\nText\n"
    )
    source = make(tmp_path, "source", source_body, tags=["keep"], custom={"a": 2})
    make(
        tmp_path,
        "back",
        (
            "[[source#Move|alias]] ![[source#^block]] [child](source#Child)\n\n`[[source#Move]]`\n"
            "\n```md\n[[source#Move]]\n```\n\n[[source#Stay]]"
        ),
    )
    preview = build_plan(tmp_path, request(selection="heading", heading="Move"), deps()).preview
    assert source.read_text().endswith(source_body)  # A preview never writes.
    result = apply(tmp_path, preview)
    changes = {c.id: c.after for c in result.changes}
    assert "**Bold** and $x$" in changes[result.target_id]
    assert "[[source#Stay]]" in changes[result.target_id]
    assert f"![[{result.target_id}#Move]]" in changes["source"]
    assert f"[[{result.target_id}#Move|alias]]" in changes["back"]
    assert f"![[{result.target_id}#^block]]" in changes["back"]
    assert f"[child]({result.target_id}#Child)" in changes["back"]
    assert "`[[source#Move]]`" in changes["back"]
    assert "```md\n[[source#Move]]\n```" in changes["back"]
    assert parse(source.read_text(), source)[0]["custom"] == {"a": 2}
    assert next((tmp_path / ".history" / "source").glob("*.md")).read_text().endswith(source_body)


def test_merge_retains_source_identity_and_destination_metadata(tmp_path):
    source = make(tmp_path, "source", "Source body", tags=["source"])
    target = make(tmp_path, "target", "Target body", custom="target")
    make(tmp_path, "links", "[[Source|name]] [source](source) ![[source]]")
    preview = build_plan(
        tmp_path, ComposerRequest(source_id="source", mode="merge", target_id="target"), deps()
    ).preview
    apply(tmp_path, preview)
    assert parse(source.read_text(), source) == (
        {"id": "source", "title": "Source", "tags": ["source"]},
        "![[target]]\n",
    )
    metadata, body = parse(target.read_text(), target)
    assert body == "Target body\n\nSource body\n"
    assert metadata["custom"] == "target"
    assert (
        "[[target|name]] [source](target) ![[target]]"
        in (tmp_path / "Wiki" / "links.md").read_text()
    )
    assert len(list((tmp_path / ".history").glob("*/*.md"))) == 3


@pytest.mark.parametrize("mode", ["extract", "merge"])
@pytest.mark.parametrize(
    "literal",
    [
        "[Literal [[source]]](https://example.invalid/guide)\n",
        "[Literal **[[source]]**](https://example.invalid/guide)\n",
        "[Literal ![[source|Alias]]][manual]\n\n[manual]: https://example.invalid/guide\n",
        "![Literal [[source]]](https://example.invalid/image.png)\n",
        "<https://example.invalid/[[source]]>\n",
        "\\![[source]]\n",
        ">     [[source]]\n",
    ],
)
def test_composition_keeps_ordinary_link_labels_out_of_backlinks(tmp_path, mode, literal):
    make(tmp_path, "source", "Source body")
    make(tmp_path, "target", "Target body")
    back = make(tmp_path, "back", literal)
    original = back.read_bytes()
    operation = (
        request()
        if mode == "extract"
        else ComposerRequest(source_id="source", mode="merge", target_id="target")
    )
    preview = build_plan(tmp_path, operation, deps()).preview
    assert "back" not in {change.id for change in preview.changes}
    result = apply(tmp_path, preview)
    assert "back" not in {change.id for change in result.changes}
    assert back.read_bytes() == original
    assert not (tmp_path / ".history" / "back").exists()


@pytest.mark.parametrize("mode", ["extract", "merge"])
def test_composition_retargets_real_destinations_without_changing_nested_labels(tmp_path, mode):
    make(tmp_path, "source", "Source body")
    make(tmp_path, "target", "Target body")
    body = (
        "[Literal [[source]]](https://example.invalid/guide)\n\n"
        "[Local **[[source]]**](source)\n\n"
        "[Reference ![[source|Alias]]][manual]\n\n[manual]: source\n\n"
        "[[source|Real link]] ![[source]]\n"
    )
    back = make(tmp_path, "back", body)
    operation = (
        request()
        if mode == "extract"
        else ComposerRequest(source_id="source", mode="merge", target_id="target")
    )
    result = apply(tmp_path, build_plan(tmp_path, operation, deps()).preview)
    updated = parse(back.read_text(), back)[1]
    expected = (
        body.replace(
            "[Local **[[source]]**](source)", f"[Local **[[source]]**]({result.target_id})"
        )
        .replace("[manual]: source", f"[manual]: {result.target_id}")
        .replace(
            "[[source|Real link]] ![[source]]",
            f"[[{result.target_id}|Real link]] ![[{result.target_id}]]",
        )
    )
    assert updated == expected
    assert [item[1] for item in rendered_references(updated)] == [
        "https://example.invalid/guide",
        result.target_id,
        result.target_id,
    ]
    assert next((tmp_path / ".history" / "back").glob("*.md")).read_text().endswith(body)


def test_moving_nested_image_keeps_literal_alt_text_and_rebases_its_real_destination(tmp_path):
    source = tmp_path / "Imported" / "source.md"
    body = "[![Literal [[source]]](images/photo.png)](https://example.invalid/guide)\n"
    save(source, {"id": "source", "title": "Source"}, body)
    image = source.parent / "images" / "photo.png"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"synthetic image")
    result = apply(tmp_path, build_plan(tmp_path, request(), deps()).preview)
    moved = next(change.after for change in result.changes if change.id == result.target_id)
    assert moved == body.replace("images/photo.png", "/api/vault/raw/Imported/images/photo.png")
    assert [item[1] for item in rendered_references(moved)] == [
        "https://example.invalid/guide",
        "/api/vault/raw/Imported/images/photo.png",
    ]


@pytest.mark.parametrize("mode", ["extract", "merge"])
@pytest.mark.parametrize("image_target", ["source", "https://example.invalid/image.png"])
def test_composition_retargets_the_enclosing_link_of_a_nested_image(tmp_path, mode, image_target):
    make(tmp_path, "source", "Source body")
    make(tmp_path, "target", "Target body")
    back = make(tmp_path, "back", f"[![Literal [[source]]]({image_target})](source)\n")
    operation = (
        request()
        if mode == "extract"
        else ComposerRequest(source_id="source", mode="merge", target_id="target")
    )
    result = apply(tmp_path, build_plan(tmp_path, operation, deps()).preview)
    nested_target = result.target_id if image_target == "source" else image_target
    updated = parse(back.read_text(), back)[1]
    assert updated == f"[![Literal [[source]]]({nested_target})]({result.target_id})\n"
    assert [item[1] for item in rendered_references(updated)] == [result.target_id, nested_target]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_retargeting_keeps_reference_container_prefixes_titles_and_line_endings(newline):
    body = newline.join(
        [
            "[Literal [[source]]][manual]",
            "",
            "> [manual]:",
            ">   <source#Content>",
            '>   "Literal [[source]]"',
            "",
        ]
    )
    rewritten, _ = rewrite_links(
        body, lambda value: "target#Content" if value == "source#Content" else None
    )
    assert rewritten == body.replace("<source#Content>", "<target#Content>")
    assert rendered_references(rewritten) == [("link_open", "target#Content", "Literal [[source]]")]


def test_retargeting_keeps_unicode_inline_separators_and_nested_literal_labels():
    body = "Text\u2028[Literal [[source]]](source)\n"
    rewritten, _ = rewrite_links(body, lambda value: "target" if value == "source" else None)
    assert rewritten == "Text\u2028[Literal [[source]]](target)\n"
    assert rendered_references(rewritten) == [("link_open", "target", None)]


@pytest.mark.parametrize("mode", ["extract", "merge"])
def test_composition_retargets_lazy_paragraph_continuation_but_keeps_indented_code(tmp_path, mode):
    make(tmp_path, "source", "Source body")
    make(tmp_path, "target", "Target body")
    body = "Paragraph\n    [[source]]\n\n    [[source]]\n"
    back = make(tmp_path, "back", body)
    operation = (
        request()
        if mode == "extract"
        else ComposerRequest(source_id="source", mode="merge", target_id="target")
    )
    result = apply(tmp_path, build_plan(tmp_path, operation, deps()).preview)
    assert (
        parse(back.read_text(), back)[1]
        == f"Paragraph\n    [[{result.target_id}]]\n\n    [[source]]\n"
    )
    assert next((tmp_path / ".history" / "back").glob("*.md")).read_text().endswith(body)


@pytest.mark.parametrize(
    "filename",
    ["photo space.png", "photo#draft.png", "photo?draft.png", "photo%23.png", "català.png"],
)
@pytest.mark.parametrize("syntax", ["bare", "angle", "reference"])
def test_composition_rebases_assets_without_changing_their_uri_semantics(
    tmp_path, filename, syntax
):
    asset = tmp_path / "Assets" / filename
    asset.parent.mkdir(parents=True)
    asset.write_bytes(b"synthetic image")
    destination = "../Assets/" + quote(filename, safe="")
    body = (
        f"![Photo][photo]\n\n[photo]: <{destination}>\n"
        if syntax == "reference"
        else f"![Photo]({'<' + destination + '>' if syntax == 'angle' else destination})\n"
    )
    source = tmp_path / "Imported" / "source.md"
    save(source, {"id": "source", "title": "Source"}, body)
    result = apply(tmp_path, build_plan(tmp_path, request(), deps()).preview)
    moved = next(change.after for change in result.changes if change.id == result.target_id)
    assert rendered_references(moved) == [("image", "Assets/" + quote(filename, safe=""), None)]
    assert asset.read_bytes() == b"synthetic image"


@pytest.mark.parametrize("mode", ["extract", "merge"])
@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("destination", ["source", "https://example.invalid/guide"])
def test_composition_preserves_partially_expanded_list_tabs(tmp_path, mode, newline, destination):
    make(tmp_path, "source", "Source body")
    make(tmp_path, "target", "Target body")
    body = f"1. Paragraph{newline}\t[Literal [[source]]]({destination}){newline}"
    back = make(tmp_path, "back", body)
    original = back.read_bytes()
    operation = (
        request()
        if mode == "extract"
        else ComposerRequest(source_id="source", mode="merge", target_id="target")
    )
    result = apply(tmp_path, build_plan(tmp_path, operation, deps()).preview)
    if destination == "source":
        updated = next(change.after for change in result.changes if change.id == "back")
        assert updated == body.replace(
            "[Literal [[source]]](source)", f"[Literal [[source]]]({result.target_id})"
        )
    else:
        assert "back" not in {change.id for change in result.changes}
        assert back.read_bytes() == original
        assert not (tmp_path / ".history" / "back").exists()


@pytest.mark.parametrize(
    "usage",
    ["[Guide][manual]", "[manual][]", "[manual]", "![Guide][manual]", "![manual][]", "![manual]"],
)
def test_extract_preserves_each_reference_form_with_outside_definitions(tmp_path, usage):
    body = f'## Move\n\n{usage}\n\n## Keep\n\n[manual]: https://example.invalid/manual "A guide"\n'
    make(tmp_path, "source", body)
    preview = build_plan(tmp_path, request(selection="heading", heading="Move"), deps()).preview
    result = apply(tmp_path, preview)
    moved = next(change.after for change in result.changes if change.id == result.target_id)
    assert rendered_references(moved) == rendered_references(body)
    assert "## Keep" not in moved


def test_extract_keeps_first_definition_when_a_later_duplicate_moves(tmp_path):
    body = (
        "[manual]: https://example.invalid/first\n\n## Move\n\n[manual][] ![manual] "
        "[Guide][manual]\n\n[MANUAL]: https://example.invalid/ignored\n\n## Keep\n\n[manual]\n"
    )
    make(tmp_path, "source", body)
    result = apply(
        tmp_path, build_plan(tmp_path, request(selection="heading", heading="Move"), deps()).preview
    )
    changes = {change.id: change.after for change in result.changes}
    assert [entry[1] for entry in rendered_references(changes[result.target_id])] == [
        "https://example.invalid/first"
    ] * 3
    assert rendered_references(changes["source"]) == [
        ("link_open", "https://example.invalid/first", None)
    ]


def test_moving_a_definition_keeps_remaining_source_links_and_duplicate_semantics(tmp_path):
    body = (
        '## Move\n\n[manual]: https://example.invalid/first "First"\n\n[manual][]\n\n## Keep\n\n'
        "[manual]\n\n[manual]: https://example.invalid/ignored\n"
    )
    source = make(tmp_path, "source", body)
    result = apply(
        tmp_path, build_plan(tmp_path, request(selection="heading", heading="Move"), deps()).preview
    )
    changes = {change.id: change.after for change in result.changes}
    expected = [("link_open", "https://example.invalid/first", "First")]
    assert rendered_references(changes[result.target_id]) == expected
    assert rendered_references(parse(source.read_text(), source)[1]) == expected


def test_merge_keeps_conflicting_reference_definitions_and_unresolved_text_independent(tmp_path):
    source = (
        "[Source][manual] ![manual][] [manual]\n\n[target-only]\n\n[manual]: "
        "https://example.invalid/source\n\n[source-only]: https://example.invalid/source-only\n"
    )
    target = (
        "[Target][manual] ![manual] [manual][]\n\n[source-only]\n\n[manual]: "
        "https://example.invalid/target\n\n[target-only]: https://example.invalid/target-only\n"
    )
    make(tmp_path, "source", source)
    target_path = make(tmp_path, "target", target)
    result = apply(
        tmp_path,
        build_plan(
            tmp_path, ComposerRequest(source_id="source", mode="merge", target_id="target"), deps()
        ).preview,
    )
    merged = next(change.after for change in result.changes if change.id == "target")
    assert rendered_references(merged) == rendered_references(target) + rendered_references(source)
    assert "[source-only]" in merged and "[target-only]" in merged
    assert parse(target_path.read_text(), target_path)[1] == merged


def test_reference_rewrite_uses_parser_context_for_nested_multiline_and_literal_syntax(tmp_path):
    literal = (
        "`[manual]` \\[manual]\n\n````md\n[manual]: https://example.invalid/code\n[manual]\n```\n"
        "````\n\n    [manual]: https://example.invalid/indented\n\n<!-- [manual] -->\n"
    )
    selection = (
        "> [Guide][manUAL]\n> ![Photo][photo]\n\n- [manual][] and [manual]\n\n"
        "[![photo]][manual]\n\n"
    ) + literal
    definitions = (
        '> [manual]:\n>   <https://example.invalid/manual?a=1&b=2>\n>   "Title &amp; \\"quote\\""\n'
        "\n[photo]: https://example.invalid/photo.png\n"
    )
    body = "## Move\n\n" + selection + "\n## Keep\n\n" + definitions
    make(tmp_path, "source", body)
    result = apply(
        tmp_path, build_plan(tmp_path, request(selection="heading", heading="Move"), deps()).preview
    )
    moved = next(change.after for change in result.changes if change.id == result.target_id)
    assert rendered_references(moved) == rendered_references(body)
    assert literal in moved


def test_line_extraction_rebases_reference_media_and_keeps_code_definitions_literal(tmp_path):
    source = tmp_path / "Imported" / "source.md"
    body = "![Photo][photo]\n\n[photo]: images/photo.png\n\n```md\n[photo]: literal.png\n```\n"
    save(source, {"id": "source", "title": "Source"}, body)
    asset = source.parent / "images" / "photo.png"
    asset.parent.mkdir(parents=True)
    asset.write_bytes(b"synthetic image")
    result = apply(
        tmp_path,
        build_plan(tmp_path, request(selection="lines", start_line=1, end_line=1), deps()).preview,
    )
    moved = next(change.after for change in result.changes if change.id == result.target_id)
    assert rendered_references(moved) == [
        ("image", "/api/vault/raw/Imported/images/photo.png", None)
    ]
    assert "[photo]: literal.png" in parse(source.read_text(), source)[1]


@pytest.mark.parametrize("changed", ["source", "target", "back", "sidecar", "new-backlink"])
def test_changed_preview_never_writes_any_notes(tmp_path, changed):
    make(tmp_path, "source", "## Move\n\nText")
    make(tmp_path, "target", "Target")
    make(tmp_path, "back", "[[source#Move]]")
    preview = build_plan(
        tmp_path, ComposerRequest(source_id="source", mode="merge", target_id="target"), deps()
    ).preview
    if changed == "sidecar":
        path = tmp_path / ".gnosi" / "page_meta" / "source.json"
        path.parent.mkdir(parents=True)
        path.write_text('{"is_template":true}')
    elif changed == "new-backlink":
        make(tmp_path, "new", "[[source#Move]]")
    else:
        make(tmp_path, changed, "Changed concurrently")
    originals = {p: p.read_bytes() for p in tmp_path.rglob("*.md")}
    with pytest.raises(HTTPException) as error:
        apply(tmp_path, preview)
    assert error.value.status_code == 409
    assert {p: p.read_bytes() for p in tmp_path.rglob("*.md")} == originals
    assert not (tmp_path / ".history").exists()


def test_waiting_for_page_lock_rechecks_etag(tmp_path):
    make(tmp_path, "source", "Original")
    preview = build_plan(tmp_path, request(), deps()).preview

    async def concurrent():
        lock = await get_page_write_lock("source")
        async with lock:
            pending = asyncio.create_task(
                apply_plan(
                    tmp_path,
                    ComposerApplyRequest(request=preview.request, token=preview.token),
                    deps(),
                )
            )
            await asyncio.sleep(0)
            make(tmp_path, "source", "Edited under the same lock")
        with pytest.raises(HTTPException) as error:
            await pending
        assert error.value.status_code == 409

    asyncio.run(concurrent())
    assert not (tmp_path / "Wiki" / f"{preview.request.target_id}.md").exists()


def test_writer_failure_rolls_back_all_files_and_sidecars(tmp_path):
    make(tmp_path, "source", "Original")
    make(tmp_path, "back", "[[source]]")
    originals = {p: p.read_bytes() for p in tmp_path.rglob("*.md")}
    preview = build_plan(tmp_path, request(), deps()).preview

    def fail(path, metadata, body):
        save(path, metadata, body)
        if metadata["id"] == "source":
            raise OSError("Synthetic storage failure")

    with pytest.raises(HTTPException) as error:
        apply(tmp_path, preview, deps(save=fail))
    assert error.value.status_code == 503
    assert {p: p.read_bytes() for p in (tmp_path / "Wiki").glob("*.md")} == originals


def test_duplicate_anchors_and_unsupported_dashboard_backlinks_conflict(tmp_path):
    make(tmp_path, "source", "## Same\n\nOriginal")
    make(tmp_path, "target", "## Same\n\nOther")
    with pytest.raises(HTTPException, match="409"):
        build_plan(
            tmp_path, ComposerRequest(source_id="source", mode="merge", target_id="target"), deps()
        )
    with pytest.raises(HTTPException, match="dashboard"):
        build_plan(tmp_path, request(), deps(unsupported_bodies=lambda: ["[[source#Same]]"]))


def test_heading_and_line_selection_respect_fences_and_complete_blocks():
    body = "````md\n## Pretend\n```\n````\n\nActual\n------\n\ntext\n\n## Last\n"
    start, end = select(body, request(selection="heading", heading="Actual"))
    assert body[start:end] == "Actual\n------\n\ntext\n\n"
    with pytest.raises(HTTPException):
        select(body, request(selection="heading", heading="Pretend"))
    with pytest.raises(HTTPException):
        select("one\ntwo\n\nthree", request(selection="lines", start_line=2, end_line=2))
    assert select("one\n\nthree", request(selection="lines", start_line=1, end_line=1)) == (0, 4)


def test_relative_media_links_and_canonical_page_links_survive_moving_folders(tmp_path):
    source = tmp_path / "Imported" / "source.md"
    save(
        source,
        {"id": "source", "title": "Source"},
        "## **Rich heading**\n\n![photo](images/photo.png)\n\nParagraph ^block_id\n",
    )
    asset = source.parent / "images" / "photo.png"
    asset.parent.mkdir(parents=True)
    asset.write_bytes(b"synthetic image")
    make(
        tmp_path,
        "back",
        (
            "[section](/@fixture/knowledge/page/source#rich-heading) ![[source#^block_id]]\n\n"
            "[relative](../Imported/source.md#Rich%20heading)"
        ),
    )
    dependencies = ComposerDependencies(
        parse=parse,
        save=save,
        refresh=lambda *_: None,
        local_prefixes=("/@fixture/knowledge/page/",),
    )
    preview = build_plan(
        tmp_path, request(selection="heading", heading="Rich heading"), dependencies
    ).preview
    changes = {c.id: c.after for c in preview.changes}
    target = preview.request.target_id
    assert f"[section](/@fixture/knowledge/page/{target}#rich-heading)" in changes["back"]
    assert f"![[{target}#^block_id]]" in changes["back"]
    assert f"[relative]({target}#Rich%20heading)" in changes["back"]
    assert "![photo](/api/vault/raw/Imported/images/photo.png)" in changes[target]


def test_ambiguous_unrelated_titles_do_not_block_but_ambiguous_source_links_do(tmp_path):
    make(tmp_path, "source", "Text")
    make(tmp_path, "one", "[[Common]]", title="Common")
    make(tmp_path, "two", "Text", title="Common")
    assert build_plan(tmp_path, request(), deps()).preview
    make(tmp_path, "alias", "[[Source]]", title="Source")
    with pytest.raises(HTTPException, match="ambiguous"):
        build_plan(tmp_path, request(), deps())


def test_live_collaborative_pages_are_rejected_before_any_history_or_writes(tmp_path):
    make(tmp_path, "source", "Original")

    def reject(_ids):
        raise HTTPException(409, "Close collaborative editors")

    dependencies = ComposerDependencies(
        parse=parse, save=save, refresh=lambda *_: None, validate_pages=reject
    )
    with pytest.raises(HTTPException, match="collaborative"):
        build_plan(tmp_path, request(), dependencies)
    assert not (tmp_path / ".history").exists()


def test_absolute_section_urls_require_an_explicit_local_link_before_moving(tmp_path):
    make(tmp_path, "source", "## Move\n\nText")
    make(tmp_path, "back", "[section](https://example.invalid/vault/page/source#Move)")
    with pytest.raises(HTTPException, match="absolute URL"):
        build_plan(tmp_path, request(), deps())


def test_routes_require_editor_role_and_validate_contract(tmp_path, monkeypatch):
    make(tmp_path, "source", "Text")
    app = FastAPI()
    api.register_routes(app)
    role = "viewer"
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext(
        "workspace", "user", role, tmp_path
    )
    monkeypatch.setattr(api, "dependencies", lambda _: deps())
    client = TestClient(app)
    payload = request().model_dump()
    assert client.post("/composer/preview", json=payload).status_code == 403
    assert (
        client.post("/composer/apply", json={"request": payload, "token": "a" * 64}).status_code
        == 403
    )
    role = "editor"
    preview = client.post("/composer/preview", json=payload)
    assert preview.status_code == 200
    data = preview.json()
    result = client.post(
        "/composer/apply", json={"request": data["request"], "token": data["token"]}
    )
    assert result.status_code == 200
    assert (
        client.post("/composer/preview", json={**payload, "source_id": "../secret"}).status_code
        == 422
    )
