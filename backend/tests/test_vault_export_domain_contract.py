"""Behavior and architecture contracts for Vault document export."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

from backend.domains.vault.citations import exporting


class SuccessfulProcess:
    returncode = 0
    stderr = ""


def test_export_resolves_citations_and_replaces_bibliography_marker(
    tmp_path: Path,
) -> None:
    source = tmp_path / "Source page.md"
    source.write_text(
        "---\nid: source\n---\nText [@smith2020; @doe] and @naked.\n"
        "{{bibliography:apa-6th-edition:ca-ES}}\n",
        encoding="utf-8",
    )
    citation_pages: dict[str, Path] = {}
    for page_id in ("smith", "doe", "naked"):
        path = tmp_path / f"{page_id}.md"
        path.write_text(f"---\nid: {page_id}\n---\n", encoding="utf-8")
        citation_pages[page_id] = path
    observed: dict[str, object] = {}

    def find_page(page_id: str) -> Path | None:
        return source if page_id == "source" else citation_pages.get(page_id)

    def run_process(command: list[str], working_directory: Path) -> SuccessfulProcess:
        observed["command"] = command
        observed["input"] = (working_directory / "input.md").read_text(encoding="utf-8")
        observed["references"] = json.loads(
            (working_directory / "refs.json").read_text(encoding="utf-8")
        )
        output_name = command[command.index("-o") + 1]
        (working_directory / output_name).write_bytes(b"document-bytes")
        return SuccessfulProcess()

    dependencies = exporting.ExportDependencies(
        find_page=find_page,
        active_vault_path=lambda: tmp_path,
        ensure_citation_index=lambda _vault: {
            "smith2020": {"id": "smith", "title": "Smith"},
            "doe": {"id": "doe", "title": "Doe"},
            "naked": {"id": "naked", "title": "Naked"},
        },
        parse_frontmatter=lambda _raw, path: ({"id": path.stem}, ""),
        metadata_to_csl=lambda title, metadata: {
            "id": metadata["id"],
            "title": title,
        },
        resolve_csl_path=lambda _style: Path("/styles/apa.csl"),
        pandoc_binary=lambda: "/usr/bin/pandoc",
        temporary_directory=lambda prefix: tempfile.TemporaryDirectory(prefix=prefix),
        run_process=run_process,
        pandoc_missing_message=lambda: "pandoc missing",
    )

    response = asyncio.run(exporting.export_page("source", "docx", "apa", "ca-ES", dependencies))

    assert response.body == b"document-bytes"
    assert response.media_type == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert response.headers["content-disposition"] == ('attachment; filename="Source_page.docx"')
    assert observed["input"] == (
        "Text [@smith2020; @doe] and @naked.\n## Bibliografia\n\n::: {#refs}\n:::\n"
    )
    references = observed["references"]
    assert isinstance(references, list)
    assert sorted(references, key=lambda item: str(item["id"])) == [
        {"id": "doe", "title": "Doe"},
        {"id": "naked", "title": "Naked"},
        {"id": "smith", "title": "Smith"},
    ]
    assert observed["command"] == [
        "/usr/bin/pandoc",
        "input.md",
        "-o",
        "output.docx",
        "--citeproc",
        "--bibliography",
        "refs.json",
        "--csl",
        "/styles/apa.csl",
        "--standalone",
        "--metadata",
        "lang=ca-ES",
    ]


def test_export_domain_does_not_import_http_facade() -> None:
    source_path = Path(exporting.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
