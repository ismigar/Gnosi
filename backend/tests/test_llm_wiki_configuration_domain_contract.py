"""Architecture contract for LLM Wiki configuration validation."""

from pathlib import Path

from backend.domains.configuration import llm_wiki, llm_wiki_records, llm_wiki_schema


def test_llm_wiki_configuration_domain_does_not_import_http_facade() -> None:
    for module in (llm_wiki, llm_wiki_records, llm_wiki_schema):
        source_path = Path(module.__file__ or "")
        assert source_path.is_file()
        assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
