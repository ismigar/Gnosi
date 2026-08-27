"""Architecture contract for LLM Wiki configuration validation."""

from pathlib import Path

from backend.domains.configuration import llm_wiki


def test_llm_wiki_configuration_domain_does_not_import_http_facade() -> None:
    source_path = Path(llm_wiki.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
