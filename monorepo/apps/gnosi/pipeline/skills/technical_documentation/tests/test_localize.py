"""Tests for structure-safe engineering-documentation localization."""

from __future__ import annotations

from pipeline.skills.technical_documentation.scripts.localize import (
    FragmentCollector,
    collect_markdown,
    split_front_matter,
)


def test_localization_collects_only_visible_prose() -> None:
    """Markdown syntax and evidence targets never reach the translator."""
    markdown = (
        "# System context\n\n"
        "Read the [domain guide](domains/vault-files.md) and use `VaultService`.\n\n"
        "| Component | Purpose |\n"
        "| --- | --- |\n"
        "| Backend | Serves the API |\n\n"
        "```python\nprint('never translate')\n```\n"
        "```mermaid\nflowchart LR\n  A[\"Product purpose\"] --> B[\"Source and tests\"]\n```\n"
    )
    collector = FragmentCollector()
    skeleton = collect_markdown(markdown, collector)
    translations = [f"TR:{fragment}" for fragment in collector.fragments]
    localized = collector.resolve(skeleton, translations)

    assert "domains/vault-files.md" in localized
    assert "`VaultService`" in localized
    assert "```python\nprint('never translate')\n```" in localized
    assert "A[\"TR:Product purpose\"] --> B[\"TR:Source and tests\"]" in localized
    assert "| --- | --- |" in localized
    assert "\ue000" not in localized
    assert all("domains/vault-files.md" not in fragment for fragment in collector.fragments)
    assert all("VaultService" not in fragment for fragment in collector.fragments)


def test_front_matter_is_preserved_exactly() -> None:
    """Traceability metadata is never translated."""
    front_matter, body = split_front_matter("---\nstatus: implemented\n---\n# Title\n")
    assert front_matter == "---\nstatus: implemented\n---\n"
    assert body == "# Title\n"
