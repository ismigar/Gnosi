"""Tests for engineering-documentation validation helpers."""

from __future__ import annotations

from pathlib import Path

from pipeline.skills.technical_documentation.scripts.validate import (
    parse_metadata,
    validate_internal_links,
    validate_sensitive_content,
)


def test_metadata_parser_reads_traceability_lists(tmp_path: Path) -> None:
    """The required front-matter subset is parsed without a YAML dependency."""
    page = tmp_path / "page.md"
    page.write_text(
        "---\n"
        "status: implemented\n"
        "last_verified: 2026-08-02\n"
        "source_paths:\n"
        "  - backend/server.py\n"
        "tests: []\n"
        "---\n\n# Page\n",
        encoding="utf-8",
    )
    metadata = parse_metadata(page)
    assert metadata.status == "implemented"
    assert metadata.source_paths == ("backend/server.py",)
    assert metadata.tests == ()


def test_internal_link_validator_reports_missing_target(tmp_path: Path) -> None:
    """Broken relative Markdown links are rejected."""
    docs_root = tmp_path / "docs"
    docs_root.mkdir()
    page = docs_root / "page.md"
    page.write_text("[Missing](missing.md)\n", encoding="utf-8")
    assert validate_internal_links(page, docs_root)
    target = docs_root / "missing.md"
    target.write_text("# Target\n", encoding="utf-8")
    assert validate_internal_links(page, docs_root) == []


def test_sensitive_content_validator_rejects_local_home_paths(tmp_path: Path) -> None:
    """Generated or reviewed docs cannot expose a developer home path."""
    page = tmp_path / "page.md"
    page.write_text("Use /Users/example/private/file.md\n", encoding="utf-8")
    assert validate_sensitive_content(page)
