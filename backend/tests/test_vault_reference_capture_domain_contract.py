"""Behavior and architecture contracts for PDF fallback and web capture."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.domains.vault.citations import pdf_fallback, web_capture
from backend.platform import translation_server


def test_pdf_fallback_preserves_identifiers_and_normalizes_authors() -> None:
    observed: list[pdf_fallback.Metadata] = []

    def map_item(item: pdf_fallback.Metadata) -> pdf_fallback.Metadata:
        observed.append(item)
        return {"Title": item["title"]}

    dependencies = pdf_fallback.PdfFallbackDependencies(
        embedded_metadata=lambda _data: {
            "title": "Paper",
            "author": "Smith, Alice and Jones, Bob",
            "year": "2025",
        },
        title_from_filename=lambda _filename: "Filename",
        parse_authors=lambda value: [
            {
                "family": part.split(",", 1)[0].strip(),
                "given": part.split(",", 1)[1].strip(),
            }
            for part in value.split(";")
        ],
        map_zotero_item=map_item,
        inject_citation_key=lambda metadata: {**metadata, "Citation Key": "smith2025"},
    )

    result = pdf_fallback.pdf_fallback_metadata(
        b"pdf",
        "paper.pdf",
        {"doi": "10.1/example", "arxiv": "2501.00001"},
        dependencies,
    )

    assert result == {"Title": "Paper", "Citation Key": "smith2025"}
    assert observed[0]["DOI"] == "10.1/example"
    assert observed[0]["url"] == "https://arxiv.org/abs/2501.00001"
    assert observed[0]["creators"] == [
        {"creatorType": "author", "lastName": "Smith", "firstName": "Alice"},
        {"creatorType": "author", "lastName": "Jones", "firstName": "Bob"},
    ]


def test_web_capture_resolves_multiple_choices_and_limits_selection() -> None:
    calls: list[tuple[str, str, str]] = []
    choices = {str(index): f"Choice {index}" for index in range(55)}

    def post_web(server_url: str, body: str, content_type: str) -> tuple[int, str]:
        calls.append((server_url, body, content_type))
        if content_type == "text/plain":
            return 300, json.dumps({"items": choices, "session": "session-1"})
        return 200, json.dumps([{"title": "Captured"}, {"title": "Second"}])

    dependencies = web_capture.WebCaptureDependencies(
        server_url=lambda: "http://translation-server:1969/",
        post_web=post_web,
        map_zotero_item=lambda item: {"Title": item["title"]},
        inject_citation_key=lambda metadata: {**metadata, "Citation Key": "captured"},
        normalize_item_type=lambda metadata: metadata,
    )

    result = asyncio.run(
        web_capture.capture_url({"url": "https://example.test/article"}, dependencies)
    )

    assert result == {
        "source": "web",
        "identifier": "https://example.test/article",
        "suggested": {
            "Title": "Captured",
            "Citation Key": "captured",
            "URL": "https://example.test/article",
        },
        "count": 2,
        "error": None,
    }
    assert calls[0] == (
        "http://translation-server:1969",
        "https://example.test/article",
        "text/plain",
    )
    selected = json.loads(calls[1][1])
    assert len(selected["items"]) == 50
    assert calls[1][2] == "application/json"


def test_web_capture_reports_optional_service_unavailable() -> None:
    dependencies = web_capture.WebCaptureDependencies(
        server_url=lambda: "http://translation-server:1969",
        post_web=lambda _server, _body, _type: (None, None),
        map_zotero_item=lambda _item: {},
        inject_citation_key=lambda metadata: metadata,
        normalize_item_type=lambda metadata: metadata,
    )

    result = asyncio.run(web_capture.capture_url({"url": "https://example.test"}, dependencies))

    assert result["error"] == ("El servei de captura web (translation-server) no està disponible")


def test_reference_capture_domains_do_not_import_http_facade() -> None:
    for module in (pdf_fallback, web_capture, translation_server):
        source_path = Path(module.__file__ or "")
        assert source_path.is_file()
        assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
