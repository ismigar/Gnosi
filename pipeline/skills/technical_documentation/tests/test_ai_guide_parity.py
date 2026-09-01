"""Protect reviewed AI-guide structure; human review still owns translation meaning."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
GUIDE = "domains/ai-agent.md"


@dataclass(frozen=True)
class Block:
    kind: str
    level: int
    text: str

    def technical_signature(self) -> tuple[str, int, tuple[str, ...]]:
        values = (
            (self.text,) if self.kind == "fence"
            else tuple(re.findall(r"`([^`\n]+)`", self.text))
        )
        return self.kind, self.level, values


def blocks(body: str) -> list[Block]:
    """Parse this guide's headings, prose, list items and triple-backtick fences."""
    result: list[Block] = []
    pending: list[str] = []
    kind = "paragraph"
    in_fence = False

    def flush() -> None:
        if pending:
            result.append(Block(kind, 0, " ".join(pending)))
            pending.clear()

    for line in body.splitlines():
        if in_fence:
            pending.append(line)
            if line == "```":
                result.append(Block("fence", 0, "\n".join(pending)))
                pending.clear()
                in_fence = False
            continue
        if line.startswith("```"):
            flush()
            pending.append(line)
            in_fence = True
            continue
        heading = re.fullmatch(r"(#{1,6}) (.+)", line)
        if heading:
            flush()
            result.append(Block("heading", len(heading[1]), heading[2]))
            kind = "paragraph"
        elif not line.strip():
            flush()
            kind = "paragraph"
        elif line.startswith("- "):
            flush()
            kind = "list"
            pending.append(line[2:].strip())
        else:
            pending.append(line.strip())
    assert not in_fence, "Unclosed guide fence"
    flush()
    return result


def assert_parity(reference: str, translated: str) -> None:
    """Require structural/technical parity, never infer semantic equivalence."""
    assert reference.startswith("---\n") and translated.startswith("---\n")
    reference_meta, reference_body = reference[4:].split("\n---\n", 1)
    translated_meta, translated_body = translated[4:].split("\n---\n", 1)
    assert translated_meta == reference_meta, "Source/test metadata drift"
    expected = blocks(reference_body)
    actual = blocks(translated_body)
    assert [item.technical_signature() for item in actual] == [
        item.technical_signature() for item in expected
    ], "Missing/reordered block or modified technical content"
    assert sum(item.kind == "heading" and item.level == 1 for item in actual) == 1
    for source, target in zip(expected, actual, strict=True):
        if source.kind != "fence":
            assert source.text != target.text, "Untranslated prose/heading/list item"


@pytest.mark.parametrize("locale", ["ca", "es", "fr"])
def test_complete_ai_guide_preserves_reviewed_structure(locale: str) -> None:
    reference = (ROOT / "docs/engineering" / GUIDE).read_text(encoding="utf-8")
    translated = (ROOT / f"docs/engineering-{locale}" / GUIDE).read_text(encoding="utf-8")
    assert_parity(reference, translated)


REFERENCE = """---
status: implemented
source_paths: [backend/example.py]
---

# Guide

## Contract

Read `/api/example`.

Keep the same scope.

- Never grant permission.
- Preserve `opaque_id`.

```mermaid
flowchart LR
A --> B
```
"""
TRANSLATED = REFERENCE.replace(
    "# Guide", "# Guia"
).replace(
    "## Contract", "## Contracte"
).replace(
    "Read ", "Llegeix "
).replace(
    "Keep the same scope.", "Mantén el mateix àmbit."
).replace(
    "Never grant permission.", "No concedeixis permisos."
).replace(
    "Preserve ", "Conserva "
)


def test_parity_accepts_translated_prose_and_different_line_wrapping() -> None:
    assert_parity(REFERENCE, TRANSLATED.replace("mateix àmbit", "mateix\nàmbit"))


@pytest.mark.parametrize(
    ("original", "replacement"),
    [
        ("Mantén el mateix àmbit.\n\n", ""),
        ("## Contracte", "### Contracte"),
        ("backend/example.py", "backend/translated.py"),
        ("/api/example", "/api/traduccio"),
        ("A --> B", "B --> A"),
        ("- No concedeixis permisos.\n", ""),
        ("Mantén el mateix àmbit.", "Keep the same scope."),
        ("Conserva `opaque_id`.", "Conserva `opaque_other`."),
        ("Mantén el mateix àmbit.", "Text nou.\n\nMantén el mateix àmbit."),
    ],
)
def test_parity_rejects_structural_drift(original: str, replacement: str) -> None:
    with pytest.raises(AssertionError):
        assert_parity(REFERENCE, TRANSLATED.replace(original, replacement))


def test_parity_rejects_unclosed_fence() -> None:
    with pytest.raises(AssertionError, match="Unclosed guide fence"):
        blocks("```mermaid\nflowchart LR\n")
