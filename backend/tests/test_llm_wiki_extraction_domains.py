"""Architecture contracts for the modular LLM Wiki extraction pipeline."""

from __future__ import annotations

from pathlib import Path

from backend.domains.llm_wiki import documents, origins
from backend.services import llm_wiki_extractors


def test_extraction_facade_preserves_origin_and_document_contracts(tmp_path: Path) -> None:
    text_path = tmp_path / "source.md"
    text_path.write_text("First paragraph.\n\nSecond paragraph.", encoding="utf-8")
    raw_origin = {
        "kind": "text",
        "label": "source.md",
        "source_url": "",
        "input_order": 0,
        "segments": documents.extract_text_file(text_path),
    }

    direct = origins.finalize_origin(raw_origin)
    compatible = llm_wiki_extractors._finalize_origin(raw_origin)  # noqa: SLF001

    assert compatible == direct
    assert llm_wiki_extractors._extract_text_file(  # noqa: SLF001
        text_path
    ) == documents.extract_text_file(text_path)


def test_extraction_modules_respect_source_guardrails() -> None:
    paths = [
        Path(llm_wiki_extractors.__file__ or ""),
        Path(documents.__file__ or ""),
        Path(origins.__file__ or ""),
    ]
    assert all(len(path.read_text(encoding="utf-8").splitlines()) <= 800 for path in paths)
    domain_sources = "\n".join(path.read_text(encoding="utf-8") for path in paths[1:])
    assert "backend.services.llm_wiki_extractors" not in domain_sources
