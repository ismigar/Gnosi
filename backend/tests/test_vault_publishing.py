"""Publication behavior against disposable notes and a disposable database."""

from pathlib import Path
import re

import pytest
import yaml
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.testclient import TestClient
from markdown_it import MarkdownIt
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.domains.vault.publishing import api, service
from backend.domains.vault.publishing.markdown import SelectedNote, SnapshotMarkdown
from backend.domains.vault.publishing.models import (
    PublicationPreview,
    PublicationRevision,
    PublicationSite,
)
from backend.domains.vault.publishing.schemas import PublicationSelection
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


def parse(text: str, _path: Path):
    if text.startswith("---\n"):
        _, front, body = text.split("---\n", 2)
        return yaml.safe_load(front), body
    return {}, text


def note(root, identity, body, **metadata):
    path = root / "Wiki" / f"{identity}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        + yaml.safe_dump({"id": identity, "title": identity.title(), **metadata})
        + "---\n"
        + body
    )
    return path


@pytest.fixture
def state(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'management.sqlite'}", connect_args={"check_same_thread": False}
    )
    for model in (PublicationPreview, PublicationSite, PublicationRevision):
        model.__table__.create(engine)
    root = tmp_path / "vault"
    note(
        root,
        "one",
        "# Welcome\n\n**Visible body** [[Two#Topic]]\n\n![[private]]\n\n![private asset](/api/vault/assets/secret.png)",
    )
    note(root, "two", "## Topic\n\nSecond selected note")
    note(root, "private", "NEVER-PUBLISHED-BODY", private_metadata="NEVER-PUBLISHED-METADATA")
    context = WorkspaceContext("workspace-one", "owner-one", "editor", root)
    dependencies = service.PublicationDependencies(parse=parse)
    with Session(engine) as db:
        yield (
            db,
            root,
            service.PublicationScope.from_context(context),
            dependencies,
            context,
            engine,
        )
    engine.dispose()


def make_preview(state, **options):
    db, root, scope, dependencies, *_ = state
    request = PublicationSelection(title="Selected notes", page_ids=["one", "two"], **options)
    return service.preview(db, scope, root, request, dependencies, now=100)


def test_exact_preview_is_immutable_and_only_selected_snapshots_are_public(state):
    db, root, scope, *_ = state
    preview = make_preview(state)
    note(root, "one", "CHANGED-AFTER-PREVIEW")
    site = service.commit(db, scope, preview.preview_id, now=101)
    for path in root.rglob("*.md"):
        path.unlink()
    bundle = service.published(db, site.token, now=102)
    assert bundle == preview.bundle
    encoded = bundle.model_dump_json()
    assert "Visible body" in encoded and "gnosi-published:p2#Topic" in encoded
    assert "NEVER-PUBLISHED" not in encoded and "CHANGED-AFTER" not in encoded
    assert "/api/" not in encoded and "secret.png" not in encoded
    assert "owner-one" not in encoded and "workspace-one" not in encoded
    assert [page.id for page in bundle.pages] == ["p1", "p2"]
    assert bundle.pages[0].omissions == 2
    with pytest.raises(HTTPException, match="404"):
        service.commit(db, scope, preview.preview_id, now=102)


@pytest.mark.parametrize("part", ["owner_id", "workspace_id", "vault_key"])
def test_other_account_workspace_or_vault_cannot_list_commit_update_or_revoke(state, part):
    db, root, scope, dependencies, *_ = state
    preview = make_preview(state)
    values = {
        "owner_id": scope.owner_id,
        "workspace_id": scope.workspace_id,
        "vault_key": scope.vault_key,
        part: "other",
    }
    other = service.PublicationScope(**values)
    assert service.list_sites(db, other) == []
    with pytest.raises(HTTPException, match="404"):
        service.commit(db, other, preview.preview_id, now=101)
    site = service.commit(db, scope, preview.preview_id, now=101)
    assert service.list_sites(db, other) == []
    with pytest.raises(HTTPException, match="404"):
        service.preview(
            db,
            other,
            root,
            PublicationSelection(
                title="Hijack", page_ids=["one"], site_id=site.id, expected_revision=site.revision
            ),
            dependencies,
            now=102,
        )
    with pytest.raises(HTTPException, match="404"):
        service.revoke(db, other, site.id, site.revision)
    assert service.published(db, site.token, now=102)


def test_expiry_preview_expiry_and_revoke_close_the_public_bundle(state):
    db, _, scope, *_ = state
    preview = make_preview(state, expires_in_days=1)
    with pytest.raises(HTTPException, match="404"):
        service.commit(db, scope, preview.preview_id, now=1000)
    site = service.commit(db, scope, preview.preview_id, now=101)
    assert service.published(db, site.token, now=86499)
    with pytest.raises(HTTPException, match="404"):
        service.published(db, site.token, now=86500)
    service.revoke(db, scope, site.id, site.revision)
    with pytest.raises(HTTPException, match="404"):
        service.published(db, site.token, now=102)


def test_update_retains_old_revision_and_refuses_stale_concurrent_preview(state):
    db, root, scope, *_ = state
    first = make_preview(state)
    site = service.commit(db, scope, first.preview_id, now=101)
    note(root, "one", "Next revision")
    update_one = make_preview(state, site_id=site.id, expected_revision=1)
    update_two = make_preview(state, site_id=site.id, expected_revision=1)
    updated = service.commit(db, scope, update_one.preview_id, now=102)
    assert updated.token == site.token and updated.revision == 2
    with pytest.raises(HTTPException, match="409"):
        service.commit(db, scope, update_two.preview_id, now=103)
    assert db.get(PublicationRevision, (site.id, 1)).payload == first.bundle.model_dump_json()
    assert service.published(db, site.token, now=103) == update_one.bundle
    with pytest.raises(HTTPException, match="409"):
        service.revoke(db, scope, site.id, 1)
    assert not db.get(PublicationSite, site.id).revoked


def test_revoked_site_cannot_be_revived_from_a_pending_preview(state):
    db, _, scope, *_ = state
    first = make_preview(state)
    site = service.commit(db, scope, first.preview_id, now=101)
    pending = make_preview(state, site_id=site.id, expected_revision=1)
    service.revoke(db, scope, site.id, 1)
    with pytest.raises(HTTPException, match="409"):
        service.commit(db, scope, pending.preview_id, now=102)
    with pytest.raises(HTTPException, match="404"):
        service.published(db, site.token, now=102)


def test_markdown_parser_closes_html_asset_reference_autolink_and_query_routes():
    raw = """# Rich note

<iframe src="/api/vault/raw/secret.pdf"></iframe>

[Download][asset]
![x][remote]
<https://gnosi.test/api/vault/raw/private.zip>
<https://example.org/guide>

[asset]: /api/vault/assets/private.png
[remote]: https://tracker.test/pixel.gif

![[private#secret]] [[Other|Read other]]

```query
path:secret
```

```python
print("safe code")
```

| Heading | Result |
| --- | --- |
| **Rich** | ~~old~~ |

> Quote

- item
"""
    pages = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "Wiki/one.md", (), raw),
            SelectedNote("two", "Other", "Wiki/two.md", (), "Text"),
        ]
    ).render()
    output = pages[0].markdown
    for secret in [
        "<iframe",
        "secret.pdf",
        "private.png",
        "pixel.gif",
        "private.zip",
        "path:secret",
        "private#secret",
    ]:
        assert secret not in output
    assert "https://example.org/guide" in output
    assert "gnosi-published:p2" in output
    assert 'print("safe code")' in output and "**Rich**" in output and "~~old~~" in output
    assert "| Heading | Result |" in output and "> Quote" in output and "- item" in output
    assert pages[0].omissions == 6


@pytest.mark.parametrize("slashes", [1, 2, 3, 4])
@pytest.mark.parametrize("embed", [False, True])
@pytest.mark.parametrize("selected", [False, True])
def test_escaped_wiki_prefix_parity_preserves_literals_and_selection_policy(
    slashes, embed, selected
):
    title = "Other" if selected else "Unselected"
    raw = "\\" * slashes + ("!" if embed else "") + f"[[{title}]]"
    page = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected body"),
        ]
    ).render()[0]
    parser = MarkdownIt("commonmark")
    if slashes % 2:
        assert parser.render(page.markdown) == parser.render(raw)
        assert page.omissions == 0
    else:
        hrefs = [
            child.attrGet("href")
            for token in parser.parse(page.markdown)
            for child in token.children or []
            if child.type == "link_open"
        ]
        expected = (
            "gnosi-published:p2" if selected else f"gnosi-omitted:{'embed' if embed else 'link'}"
        )
        assert hrefs == [expected]
        assert page.markdown.startswith("\\" * slashes)
        assert page.omissions == int(not selected)


@pytest.mark.parametrize("raw", [r"!\[[Other]]", r"\[\[Other]]", r"\!\[[Unselected]]"])
def test_escaped_wiki_opening_delimiters_remain_literal(raw):
    page = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected body"),
        ]
    ).render()[0]
    parser = MarkdownIt("commonmark")
    assert parser.render(page.markdown) == parser.render(raw)
    assert page.omissions == 0


@pytest.mark.parametrize(
    "raw",
    [r"[\[Other]]", r"[[Other\]]", r"[[Other]\]", "&#91;[Other]]", "&excl;[[Other]]"],
)
def test_decoded_nonprefix_delimiters_keep_existing_app_wiki_semantics(raw):
    # The original VaultMarkdown renderer recognizes these decoded forms;
    # only source escapes on the leading wiki prefix make it literal.
    page = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected body"),
        ]
    ).render()[0]
    assert page.markdown == "[Other](gnosi-published:p2)\n"
    assert page.omissions == 0


def test_literal_and_genuine_wiki_references_coexist_with_escaped_alias_punctuation():
    raw = r"""\[[Other]] [[Other|A \*literal\* alias &amp; punctuation!]]
\![[Other]] ![[Other]] \[[Unselected]] [[Unselected]]
\![[Unselected]] ![[Unselected]]
"""
    page = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected body"),
        ]
    ).render()[0]
    rendered = MarkdownIt("commonmark").render(page.markdown)
    assert "[[Other]]" in rendered and "![[Other]]" in rendered
    assert "[[Unselected]]" in rendered and "![[Unselected]]" in rendered
    assert "A *literal* alias &amp; punctuation!" in rendered
    assert rendered.count('href="gnosi-published:p2"') == 2
    assert rendered.count('href="gnosi-omitted:') == 2
    assert page.omissions == 2


@pytest.mark.parametrize("destination", ["https://example.org/guide", "two.md#Topic"])
@pytest.mark.parametrize(
    "label",
    [
        "Literal [[Other]]",
        "Literal [[Unselected]]",
        "Literal ![[Other]] ![[Unselected]]",
        r"Literal \[\[Other\]\] and \![[Unselected]]",
        "Entity &#91;&#91;Other&#93;&#93; &excl;[[Unselected]]",
        r"Delimiter [\[Other\]] \[[Unselected]\] [\[Other]\]",
        r"Slashes \\[[Other]] \\\[[Unselected]\]",
        r"Read **[[Other]]** *![[Unselected]]* ~~old~~ `[[Other]]`",
        r"Read $\frac{a_1}{b^2}$ and [[Other]]",
    ],
)
def test_ordinary_link_labels_keep_literal_wiki_text_and_rich_children(label, destination):
    raw = f"[{label}]({destination})"
    page = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected body"),
        ]
    ).render()[0]
    parser = MarkdownIt("commonmark").enable("strikethrough")
    expected = parser.render(raw).replace('href="two.md#Topic"', 'href="gnosi-published:p2#Topic"')
    assert expected.count("<a ") == 1
    rendered = parser.render(page.markdown)
    assert rendered == expected
    assert rendered.count("<a ") == 1
    assert page.omissions == 0


@pytest.mark.parametrize(
    "raw",
    [
        "[Literal **[[Other]]** ![[Unselected]]][guide]\n\n[guide]: https://example.org/guide",
        "[Entity &#91;&#91;Other&#93;&#93;][]\n\n"
        "[Entity &#91;&#91;Other&#93;&#93;]: https://example.org/guide",
        "[Entity &excl;&#91;&#91;Unselected&#93;&#93;]\n\n"
        "[Entity &excl;&#91;&#91;Unselected&#93;&#93;]: https://example.org/guide",
    ],
)
def test_full_collapsed_and_shortcut_reference_links_keep_literal_labels(raw):
    page = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected body"),
        ]
    ).render()[0]
    parser = MarkdownIt("commonmark")
    original = parser.render(raw)
    assert original.count("<a ") == 1
    assert parser.render(page.markdown) == original
    assert page.omissions == 0


def test_literal_link_labels_preserve_table_pipes_tasks_and_outside_wiki_policy():
    raw = r"""| Link |
| --- |
| [**[[Other]]** `left\|right` $x\|y$][guide] |

- [ ] [Literal ![[Unselected]]][guide] and [[Other]] [[Unselected]]

[guide]: https://example.org/guide
"""
    snapshot = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected body"),
        ]
    )
    page = snapshot.render()[0]
    tokens = snapshot.parser.parse(page.markdown)
    children = [child for token in tokens for child in token.children or []]
    assert [child.attrGet("href") for child in children if child.type == "link_open"] == [
        "https://example.org/guide",
        "https://example.org/guide",
        "gnosi-published:p2",
        "gnosi-omitted:link",
    ]
    assert [
        (child.type, child.content) for child in children if child.type.endswith("_inline")
    ] == [
        ("code_inline", "left|right"),
        ("math_inline", "x|y"),
    ]
    assert sum(token.type == "td_open" for token in tokens) == 1
    assert "- [ ] " in page.markdown
    assert page.omissions == 1


@pytest.mark.parametrize("destination", ["unselected.md", "/api/vault/assets/private.png"])
def test_literal_label_does_not_authorize_an_unselected_or_private_destination(destination):
    page = SnapshotMarkdown(
        [SelectedNote("one", "One", "one.md", (), f"[Literal [[Other]]]({destination})")]
    ).render()[0]
    assert page.markdown == "[omitted](gnosi-omitted:link)\n"
    assert page.omissions == 1


@pytest.mark.parametrize(
    ("label", "kind"),
    [
        ("![private](/api/vault/assets/private.png)", "asset"),
        ('<img src="/api/vault/assets/private.png">', "html"),
        (r"$\href{/api/vault/pages/private}{private}$", "math"),
    ],
)
def test_filtered_label_children_do_not_create_nested_links_or_leak_destinations(label, kind):
    raw = f"[Before {label} after [[Unselected]]](https://example.org/guide)"
    page = SnapshotMarkdown([SelectedNote("one", "One", "one.md", (), raw)]).render()[0]
    rendered = MarkdownIt("commonmark").render(page.markdown)
    assert rendered.count("<a ") == 1
    assert 'href="https://example.org/guide"' in rendered
    assert f' src="gnosi-omitted:{kind}"' in rendered
    assert "[[Unselected]]" in rendered
    assert "private" not in page.markdown
    assert page.omissions == 1


def test_snapshot_preserves_ordered_starts_nested_lists_and_task_states():
    raw = """3. Third step
   - [x] Completed nested task
   - [ ] Open nested task with [[Other]]
4. Fourth step

Separate zero-based list:

0. Zero-based step
1. Following step

- [X] Uppercase task
- \\[x] Literal marker
"""
    pages = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected"),
        ]
    ).render()
    output = pages[0].markdown
    tokens = MarkdownIt("commonmark").parse(output)
    assert [token.attrGet("start") for token in tokens if token.type == "ordered_list_open"] == [
        3,
        0,
    ]
    assert sum(token.type == "bullet_list_open" for token in tokens) == 2
    assert "- [x] Completed nested task" in output
    assert "- [ ] Open nested task with [Other](gnosi-published:p2)" in output
    assert "- [X] Uppercase task" in output
    assert r"- \[x\] Literal marker" in output
    assert pages[0].omissions == 0


def test_each_table_retains_its_own_columns_and_alignment_even_in_nested_blocks():
    raw = """| First | Value |
| :--- | ---: |
| A | B |

A separate paragraph.

| Second | Value | Extra |
| --- | :---: | ---: |
| C | D | E |

> | Quoted |
> | --- |
> | F |

- A nested table:

  | Inside | List |
  | :--- | ---: |
  | G | H |
"""
    parser = MarkdownIt("commonmark").enable("table")
    page = SnapshotMarkdown([SelectedNote("one", "One", "one.md", (), raw)]).render()[0]
    original_tables = re.findall(r"<table>.*?</table>", parser.render(raw), re.S)
    rendered_tables = re.findall(r"<table>.*?</table>", parser.render(page.markdown), re.S)
    assert len(original_tables) == 4
    assert rendered_tables == original_tables
    assert page.omissions == 0


def test_each_table_keeps_selected_links_and_omits_private_references():
    raw = """| Link | Asset |
| --- | --- |
| [[Other]] | ![Private][asset] |

Between the tables.

| Link | HTML |
| --- | --- |
| [Other][selected] | <img src="/api/private.png"> |

[asset]: /api/vault/assets/private.png
[selected]: two.md
"""
    page = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "Selected"),
        ]
    ).render()[0]
    html = MarkdownIt("commonmark").enable("table").render(page.markdown)
    assert html.count("<table>") == 2
    assert page.markdown.count("gnosi-published:p2") == 2
    assert "private.png" not in page.markdown
    assert "<img" not in page.markdown
    assert page.omissions == 2


def test_table_pipes_remain_inside_code_math_and_plain_text_cells():
    raw = r"""| `heading\|code` | Math\|heading | Plain |
| --- | --- | --- |
| `left\|right` | $x\|y$ | plain\|text |
| `left\\\|right` | $x\\\|y$ | slash\\\|text |
"""
    snapshot = SnapshotMarkdown([SelectedNote("one", "One", "one.md", (), raw)])
    page = snapshot.render()[0]
    original = snapshot.parser.parse(raw)
    normalized = snapshot.parser.parse(page.markdown)
    original_cells = [
        [(child.type, child.content) for child in token.children or []]
        for token in original
        if token.type == "inline"
    ]
    assert original_cells[3:6] == [
        [("code_inline", "left|right")],
        [("math_inline", "x|y")],
        [("text", "plain|text")],
    ]
    assert [
        [(child.type, child.content) for child in token.children or []]
        for token in normalized
        if token.type == "inline"
    ] == original_cells
    assert sum(token.type == "td_open" for token in normalized) == 6
    assert page.omissions == 0


@pytest.mark.parametrize(
    "raw",
    [
        r"1\. This is a literal paragraph.",
        r"2\) This is also a literal paragraph.",
        r"\- This is another literal paragraph.",
        r"\+ A literal plus prefix.",
        r"\---",
        "Literal heading underline\n\\===",
        "Continued paragraph\n1\\. Still prose\n\\- Still prose",
        r"Escaped entity \&amp; remains literal.",
    ],
)
def test_escaped_block_prefixes_and_entities_remain_literal_prose(raw):
    parser = MarkdownIt("commonmark")
    page = SnapshotMarkdown([SelectedNote("one", "One", "one.md", (), raw)]).render()[0]
    assert parser.render(page.markdown) == parser.render(raw)
    assert page.omissions == 0


def test_literal_prefixes_do_not_create_lists_alongside_real_nested_lists():
    raw = """1\\. Literal paragraph.

\\- Another literal paragraph.

3. Real numbered item
   - \\- Literal bullet inside a real list
"""
    page = SnapshotMarkdown([SelectedNote("one", "One", "one.md", (), raw)]).render()[0]
    parser = MarkdownIt("commonmark")
    original = parser.parse(raw)
    normalized = parser.parse(page.markdown)
    for kind in ["ordered_list_open", "bullet_list_open"]:
        assert [token.attrs for token in normalized if token.type == kind] == [
            token.attrs for token in original if token.type == kind
        ]
    assert [
        child.content
        for token in normalized
        for child in token.children or []
        if child.type == "text"
    ] == [
        child.content
        for token in original
        for child in token.children or []
        if child.type == "text"
    ]


def test_task_reparsing_keeps_document_reference_definitions_and_asset_filtering():
    raw = """- [ ] [Other][chosen] and ![private asset][asset]

[chosen]: two.md
[asset]: /api/vault/assets/private.png
"""
    pages = SnapshotMarkdown(
        [
            SelectedNote("one", "One", "one.md", (), raw),
            SelectedNote("two", "Other", "two.md", (), "- [ ] [Missing][chosen]"),
        ]
    ).render()
    assert (
        "[ ] [Other](<gnosi-published:p2>) and [omitted](gnosi-omitted:asset)" in pages[0].markdown
    )
    assert pages[0].omissions == 1
    assert "private.png" not in pages[0].markdown
    assert "gnosi-published" not in pages[1].markdown
    assert pages[1].omissions == 0


def test_snapshot_preserves_math_tokens_without_reinterpreting_prose_or_code():
    raw = r"""Inline $\frac{a_1}{b^2}$ and $$\sqrt{x}$$.

$$
x = \frac{a}{b}
$$

> $$$
> y = \frac{c}{d}
> $$$

Escaped \$12 and \$15. `Literal $\frac{a}{b}$`.

```tex
$\frac{a}{b}$ [[private]]
```
"""
    snapshot = SnapshotMarkdown([SelectedNote("one", "One", "one.md", (), raw)])
    page = snapshot.render()[0]
    assert r"$\frac{a_1}{b^2}$" in page.markdown
    assert r"$$\sqrt{x}$$" in page.markdown
    assert "$$\nx = \\frac{a}{b}\n$$" in page.markdown
    assert "> $$$\n> y = \\frac{c}{d}\n> $$$" in page.markdown
    tokens = MarkdownIt("commonmark").parse(page.markdown)
    prose = next(token for token in tokens if token.content.startswith("Escaped "))
    assert [(child.type, child.content) for child in prose.children or []] == [
        ("text", "Escaped $12 and $15. "),
        ("code_inline", r"Literal $\frac{a}{b}$"),
        ("text", "."),
    ]
    code = [
        child.content
        for token in tokens
        for child in token.children or []
        if child.type == "code_inline"
    ]
    assert code == [r"Literal $\frac{a}{b}$"]
    assert (
        next(token.content for token in tokens if token.type == "fence")
        == "$\\frac{a}{b}$ [[private]]\n"
    )
    assert page.omissions == 0


@pytest.mark.parametrize(
    "math",
    [
        r"$\href{/api/vault/pages/private}{private}$",
        r"$\url{https://example.test/private}$",
        "$$\n\\includegraphics{/api/vault/assets/private.png}\n$$",
        r"$\htmlStyle{background:url(/api/private)}{x}$",
        '$<img src="/api/vault/assets/private.png">$',
    ],
)
def test_math_never_retains_resource_or_html_destinations(math):
    page = SnapshotMarkdown([SelectedNote("one", "One", "one.md", (), math)]).render()[0]
    assert page.markdown == "[omitted](gnosi-omitted:math)\n"
    assert page.omissions == 1


def test_limits_duplicates_symlinks_and_selected_missing_notes(state, tmp_path):
    db, root, scope, dependencies, *_ = state
    external = tmp_path / "outside.md"
    external.write_text("EXTERNAL")
    (root / "Wiki" / "outside.md").symlink_to(external)
    assert "outside" not in {candidate.id for candidate in service.candidates(root, dependencies)}
    with pytest.raises(HTTPException, match="404"):
        service.preview(
            db,
            scope,
            root,
            PublicationSelection(title="Missing", page_ids=["outside"]),
            dependencies,
        )
    note(root, "large", "x" * 256001)
    with pytest.raises(HTTPException, match="413"):
        service.preview(
            db, scope, root, PublicationSelection(title="Large", page_ids=["large"]), dependencies
        )
    with pytest.raises(ValueError):
        PublicationSelection(title="Duplicate", page_ids=["one", "one"])


def test_malformed_external_url_is_omitted_without_breaking_the_preview():
    note = SelectedNote(
        "one", "One", "one.md", (), "[[https://[|Malformed URL]]\n\nOrdinary content"
    )
    page = SnapshotMarkdown([note]).render()[0]
    assert "Ordinary content" in page.markdown
    assert "https://[" not in page.markdown
    assert page.omissions == 1


def test_routes_public_bundle_has_no_workspace_or_live_vault_dependency(state, monkeypatch):
    db, _, scope, dependencies, context, engine = state
    first = make_preview(state)
    site = service.commit(db, scope, first.preview_id, now=101)
    monkeypatch.setattr(api, "dependencies", lambda _context: dependencies)
    monkeypatch.setattr(api, "require_plugins", lambda *_: lambda: None)
    app = FastAPI()
    router = APIRouter()
    api.register_routes(router)
    app.include_router(router, prefix="/api/vault")
    app.include_router(api.public_router, prefix="/api")

    def database():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_mgmt_db] = database
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)
    assert client.get("/api/vault/publishing").json()[0]["id"] == site.id
    context.role = "viewer"
    assert (
        client.post(
            "/api/vault/publishing/preview", json={"title": "Unauthorized", "page_ids": ["one"]}
        ).status_code
        == 403
    )
    app.dependency_overrides[get_workspace_context] = lambda: (_ for _ in ()).throw(
        AssertionError("Private scope on public read")
    )
    result = client.get(f"/api/published/{site.token}")
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    assert result.headers["referrer-policy"] == "no-referrer"
    assert client.post(f"/api/published/{site.token}").status_code == 405
    assert client.get("/api/published/invalid-token").status_code == 422
    assert len(db.scalars(select(PublicationRevision)).all()) == 1
