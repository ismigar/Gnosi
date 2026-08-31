"""Negative technical-drift checks using only synthetic reviewed Markdown."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.skills.technical_documentation.scripts import localize
from pipeline.skills.technical_documentation.scripts.reviewed_contracts import (
    compare_reviewed,
    protected_values,
)

SOURCE = """---
status: partial
source_paths:
  - backend/example.py
---
# Source

Use `GNOSI_DATA_DIR` and ``a `code` span``.
See [the guide](../operations/runbook.md#data) and [API](https://example.invalid/a_(b)?x=1 "Title").

```bash
uv run --frozen --no-sync python example.py
```

```mermaid
flowchart LR
    A["Native runtime"] --> B["Owned process"]
```
"""
LOCALIZED = (
    SOURCE.replace("# Source", "# Origen")
    .replace(
        "Use ",
        "Utilitzeu ",
    )
    .replace("the guide", "la guia")
    .replace("#data)", "#dades)")
    .replace(
        '"Title"',
        '"Títol"',
    )
    .replace('"Native runtime"', '"Execució nativa"')
    .replace(
        '"Owned process"',
        '"Procés propi"',
    )
)


def test_translated_prose_titles_and_diagram_labels_preserve_contract() -> None:
    assert compare_reviewed(SOURCE, LOCALIZED) == []


def test_diagram_labels_accept_apostrophes_without_masking_changed_edges() -> None:
    source = """```mermaid\nflowchart LR\nA["API modules"] --> B["Users"]\n```"""
    translated = source.replace('"API modules"', '''"Catàlegs d'API"''')
    assert compare_reviewed(source, translated) == []
    assert compare_reviewed(source, translated.replace("--> B", "--> C")) == ["fenced examples"]


def test_state_transition_captions_translate_but_endpoints_and_arrows_do_not() -> None:
    source = (
        "```mermaid\nstateDiagram-v2\n  Idle --> Ready: backend ready\n  Ready --> [*]: end\n```"
    )
    translated = source.replace("backend ready", "backend llest").replace(": end", ": fi")
    assert compare_reviewed(source, translated) == []
    assert compare_reviewed(source, translated.replace("Idle --> Ready", "Idle --> Other")) == [
        "fenced examples"
    ]
    assert compare_reviewed(source, translated.replace("Idle --> Ready", "Ready --> Idle")) == [
        "fenced examples"
    ]


def test_sequence_participants_and_messages_preserve_their_structural_ids() -> None:
    source = (
        "```mermaid\nsequenceDiagram\n  participant API as API route\n"
        "  UI->>API: Request\n  API-->>UI: Response\n```"
    )
    translated = (
        source.replace("API route", "Ruta API")
        .replace("Request", "Petició")
        .replace("Response", "Resposta")
    )
    assert compare_reviewed(source, translated) == []
    assert compare_reviewed(source, translated.replace("UI->>API", "API->>UI")) == [
        "fenced examples"
    ]
    assert compare_reviewed(source, translated.replace("API-->>UI", "API->>UI")) == [
        "fenced examples"
    ]
    assert compare_reviewed(
        source, translated.replace("participant API as", "participant Other as")
    ) == ["fenced examples"]


def test_flow_edge_captions_translate_without_changing_the_graph() -> None:
    source = '```mermaid\nflowchart LR\nA["Client"] -->|Request| B["Server"]\n```'
    translated = source.replace("Request", "Petició").replace("Server", "Servidor")
    assert compare_reviewed(source, translated) == []
    assert compare_reviewed(source, translated.replace("-->|Petició| B", "-->|Petició| C")) == [
        "fenced examples"
    ]


@pytest.mark.parametrize(
    ("old", "new", "category"),
    [
        ("status: partial", "status: implemented", "front matter"),
        ("backend/example.py", "backend/exemple.py", "front matter"),
        ("GNOSI_DATA_DIR", "GNOSI_LOCAL_DATA", "inline code"),
        ("a `code` span", "a `codi` span", "inline code"),
        ("--frozen --no-sync", "--no-sync", "fenced examples"),
        ('A["Native runtime"] --> B', 'A["Native runtime"] --> C', "fenced examples"),
        ("../operations/runbook.md", "../operations/obsolete.md", "link targets"),
        ("https://example.invalid", "https://other.invalid", "URLs"),
    ],
)
def test_technical_changes_fail(old: str, new: str, category: str) -> None:
    assert category in compare_reviewed(SOURCE, SOURCE.replace(old, new))


def test_duplicate_and_missing_code_are_not_reduced_to_sets() -> None:
    assert compare_reviewed("Use `port` twice: `port`.", "Use `port`.") == ["inline code"]
    assert compare_reviewed("Use `port`.", "Use `port` twice: `port`.") == ["inline code"]


def test_inline_code_handles_reflow_delimiters_and_literal_backticks() -> None:
    assert compare_reviewed("`two\nwords`", "`two words`") == []
    assert compare_reviewed("`` `nested` ``", "`` `nested` ``") == []
    assert protected_values(r"Literal \`not code\`.")["inline code"] == {}
    assert protected_values("A lone ` marker.")["inline code"] == {}


def test_fences_preserve_nested_shorter_fences_and_tildes() -> None:
    source = "````markdown\n```bash\nrun example\n```\n````\n~~~text\ntext\n~~~\n"
    assert compare_reviewed(source, source) == []
    assert compare_reviewed(source, source.replace("run example", "run different")) == [
        "fenced examples"
    ]


def test_reordering_executable_steps_is_not_hidden_by_equal_block_counts() -> None:
    first = "```sh\nprepare-example\n```\n"
    second = "```sh\nrun-example\n```\n"
    assert compare_reviewed(first + second, second + first) == ["fenced examples"]


@pytest.mark.parametrize("source", ["---\nstatus: partial", "```bash\nrun example"])
def test_malformed_protected_blocks_fail_even_when_both_copies_match(source: str) -> None:
    assert compare_reviewed(source, source)


def test_code_like_links_do_not_become_prose_links() -> None:
    source = "Use `[label](fake.md)` but read [guide](real.md)."
    assert protected_values(source)["link targets"] == {"real.md": 1}


def test_balanced_escaped_and_angle_link_destinations() -> None:
    source = (
        r"""[guide](path_(part).md "Title") [file](<path with spaces.md>) [escaped](a\(b\).md)"""
    )
    values = protected_values(source)["link targets"]
    assert values == {"path_(part).md": 1, "path with spaces.md": 1, r"a\(b\).md": 1}


def test_reviewed_check_is_read_only_and_does_not_load_translator(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_root = tmp_path / "source"
    destination = tmp_path / "translated"
    source_root.mkdir()
    destination.mkdir()
    (source_root / "guide.md").write_text(SOURCE)
    output = destination / "guide.md"
    output.write_text(LOCALIZED)
    config = tmp_path / "mkdocs.yml"
    config.write_text("site_name: Synthetic")
    monkeypatch.setattr(localize, "SOURCE_ROOT", source_root)
    locale = localize.LOCALES["ca"].copy()
    locale["docs_root"] = destination
    locale["config"] = config
    monkeypatch.setattr(localize, "LOCALES", {"ca": locale})

    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Read-only check must not create a translation model")

    monkeypatch.setattr(localize, "OfflineTranslator", forbidden)
    assert localize.check_locale("ca", reviewed_only=True) == []
    output.write_text(LOCALIZED.replace("GNOSI_DATA_DIR", "different"))
    before = output.read_bytes(), output.stat().st_mtime_ns
    assert localize.check_locale("ca", reviewed_only=True) == [
        "reviewed technical drift guide.md: inline code"
    ]
    assert localize.main(["--locale", "ca", "--reviewed-only", "--check"]) == 1
    assert (output.read_bytes(), output.stat().st_mtime_ns) == before
    output.write_text(LOCALIZED)
    retired = destination / "retired.md"
    retired.write_text("# Removed from the source but still advertised locally")
    assert localize.check_locale("ca", reviewed_only=True) == [
        "unexpected reviewed page retired.md"
    ]
    assert localize.check_locale("ca", reviewed_only=True, selected_paths={Path("guide.md")}) == []
    assert retired.is_file()
