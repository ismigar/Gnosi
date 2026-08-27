"""Pandoc-backed Vault page export with resolved CSL citations."""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from fastapi import HTTPException
from fastapi.responses import Response


BIBLIOGRAPHY_MARKER_RE = r"\{\{bibliography(?::[a-z][a-z0-9-]*)?(?::[a-zA-Z-]+)?\}\}"
EXTENSIONS = {
    "docx": "docx",
    "odt": "odt",
    "html": "html",
    "pdf": "pdf",
    "tex": "tex",
    "markdown": "md",
}
MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "odt": "application/vnd.oasis.opendocument.text",
    "html": "text/html",
    "pdf": "application/pdf",
    "tex": "application/x-latex",
    "markdown": "text/markdown",
}


Metadata = dict[str, Any]


class ProcessResult(Protocol):
    """Result fields consumed from a completed Pandoc process."""

    returncode: int
    stderr: str


@dataclass(frozen=True)
class ExportDependencies:
    """Ports required by the page-export workflow."""

    find_page: Callable[[str], Path | None]
    active_vault_path: Callable[[], str | Path | None]
    ensure_citation_index: Callable[[str], dict[str, Metadata]]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    metadata_to_csl: Callable[[str, Metadata], Metadata | None]
    resolve_csl_path: Callable[[str], Path | None]
    pandoc_binary: Callable[[], str]
    temporary_directory: Callable[[str], AbstractContextManager[str]]
    run_process: Callable[[list[str], Path], ProcessResult]
    pandoc_missing_message: Callable[[], str]


def strip_frontmatter(markdown: str) -> str:
    """Remove one leading YAML frontmatter block from Markdown."""
    if not markdown.startswith("---"):
        return markdown
    match = re.match(r"^---\n.*?\n---\n", markdown, re.DOTALL)
    return markdown[match.end() :] if match else markdown


def citation_keys(markdown: str) -> set[str]:
    """Collect bracketed and naked Pandoc citation keys."""
    keys: set[str] = set()
    bracketed = re.finditer(
        r"\[@([a-z][a-z0-9_:-]*(?:\s*;\s*@[a-z][a-z0-9_:-]*)*)\]",
        markdown,
        re.IGNORECASE,
    )
    for match in bracketed:
        for raw_key in match.group(1).split(";"):
            key = raw_key.strip().lstrip("@").strip()
            if key:
                keys.add(key)
    naked = re.finditer(
        r"(?:^|[\s(])@([a-z][a-z0-9_:-]*)\b",
        markdown,
        re.IGNORECASE | re.MULTILINE,
    )
    keys.update(match.group(1) for match in naked)
    return keys


async def _load_csl_items(
    keys: set[str],
    dependencies: ExportDependencies,
) -> list[Metadata]:
    vault_path = dependencies.active_vault_path()
    if not keys or not vault_path:
        return []
    index = dependencies.ensure_citation_index(str(vault_path))
    items: list[Metadata] = []
    for key in keys:
        entry = index.get(key)
        if not entry:
            continue
        try:
            page_path = await asyncio.to_thread(
                dependencies.find_page,
                str(entry.get("id") or ""),
            )
            if not page_path:
                continue
            raw_page = page_path.read_text(encoding="utf-8")
            metadata, _body = dependencies.parse_frontmatter(raw_page, page_path)
            item = dependencies.metadata_to_csl(str(entry.get("title") or ""), metadata)
            if item:
                items.append(item)
        except OSError:
            continue
    return items


def _prepare_input(path: Path, body: str, csl_items: list[Metadata]) -> None:
    content = body
    if "{{bibliography}}" in content or re.search(BIBLIOGRAPHY_MARKER_RE, content):
        content = re.sub(
            BIBLIOGRAPHY_MARKER_RE,
            "## Bibliografia\n\n::: {#refs}\n:::",
            content,
        )
    (path / "input.md").write_text(content, encoding="utf-8")
    if csl_items:
        (path / "refs.json").write_text(
            json.dumps(csl_items, ensure_ascii=False),
            encoding="utf-8",
        )


def _pandoc_command(
    *,
    format: str,
    locale: str,
    output_name: str,
    csl_items: list[Metadata],
    csl_path: Path | None,
    dependencies: ExportDependencies,
) -> list[str]:
    command = [dependencies.pandoc_binary(), "input.md", "-o", output_name]
    if csl_items:
        command.extend(["--citeproc", "--bibliography", "refs.json"])
        if csl_path:
            command.extend(["--csl", str(csl_path)])
    if format in ("docx", "odt", "pdf"):
        command.append("--standalone")
    command.extend(["--metadata", f"lang={locale}"])
    return command


def _run_pandoc(
    command: list[str],
    working_directory: Path,
    dependencies: ExportDependencies,
) -> None:
    try:
        result = dependencies.run_process(command, working_directory)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=dependencies.pandoc_missing_message(),
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="pandoc timeout after 60s") from exc
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"pandoc failed: {result.stderr[:500]}",
        )


def _download_response(file_path: Path, format: str, data: bytes) -> Response:
    safe_title = re.sub(r"[^A-Za-z0-9._-]+", "_", file_path.stem)[:80] or "document"
    download_name = f"{safe_title}.{EXTENSIONS[format]}"
    return Response(
        content=data,
        media_type=MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


async def export_page(
    page_id: str,
    format: str,
    csl: str,
    locale: str,
    dependencies: ExportDependencies,
) -> Response:
    """Export one page and return the generated document as a download."""
    file_path = await asyncio.to_thread(dependencies.find_page, page_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Page not found")
    body = strip_frontmatter(file_path.read_text(encoding="utf-8"))
    csl_items = await _load_csl_items(citation_keys(body), dependencies)
    csl_path = dependencies.resolve_csl_path(csl)
    output_name = f"output.{EXTENSIONS[format]}"
    with dependencies.temporary_directory("gnosi_export_") as directory:
        temporary_path = Path(directory)
        _prepare_input(temporary_path, body, csl_items)
        command = _pandoc_command(
            format=format,
            locale=locale,
            output_name=output_name,
            csl_items=csl_items,
            csl_path=csl_path,
            dependencies=dependencies,
        )
        _run_pandoc(command, temporary_path, dependencies)
        output_path = temporary_path / output_name
        if not output_path.exists():
            raise HTTPException(status_code=500, detail="pandoc no ha generat sortida")
        data = output_path.read_bytes()
    return _download_response(file_path, format, data)


__all__ = [
    "ExportDependencies",
    "citation_keys",
    "export_page",
    "strip_frontmatter",
]
