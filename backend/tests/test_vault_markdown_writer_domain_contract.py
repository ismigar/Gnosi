"""Architecture contract for the canonical Vault Markdown writer."""

from pathlib import Path

from backend.domains.vault.pages import markdown_writer


def test_markdown_writer_domain_does_not_import_http_facade() -> None:
    source_path = Path(markdown_writer.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
