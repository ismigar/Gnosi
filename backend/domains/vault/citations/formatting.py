"""CSL item construction and Pandoc formatting routes."""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from backend.domains.vault.citations.authors import (
    normalize_authors_field,
    recursos_metadata_to_csl,
)


PANDOC_MISSING_MSG = (
    "pandoc no disponible al host — instal·la'l (brew install pandoc) "
    "o defineix PANDOC_PATH amb la ruta del binari"
)


@dataclass(frozen=True)
class FormattingDependencies:
    active_vault_path: Callable[[], str | Path | None]
    resolve_ensure_index: Callable[[], Callable[[str], dict[str, dict[str, Any]]]]
    page_metadata_snapshot: Callable[[str], dict[object, dict[str, Any]]]
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[dict[str, Any], str]]
    resolve_csl_type: Callable[[object], str]


def resolve_csl_path(style: str) -> Path | None:
    style_map = {
        "apa": "apa.csl",
        "chicago-author-date": "chicago-author-date.csl",
        "mla": "modern-language-association.csl",
        "modern-language-association": "modern-language-association.csl",
        "ieee": "ieee.csl",
    }
    style_dirs = [
        Path("/app/frontend/public/csl/styles"),
        Path(__file__).resolve().parents[4] / "frontend" / "public" / "csl" / "styles",
    ]
    for style_file in (
        style_map.get(style, Path(f"{style}.csl").name),
        "apa.csl",
    ):
        for directory in style_dirs:
            candidate = directory / style_file
            if candidate.exists():
                return candidate
    return None


def build_csl_items_for_keys(
    keys: list[str],
    dependencies: FormattingDependencies,
) -> list[dict[str, Any]]:
    if not keys:
        return []
    vault_path = dependencies.active_vault_path()
    if not vault_path:
        return []
    vault_key = str(vault_path)
    index = dependencies.resolve_ensure_index()(vault_key)
    metadata_by_id = dependencies.page_metadata_snapshot(vault_key)
    result: list[dict[str, Any]] = []
    for key in keys:
        entry = index.get(key)
        if not entry:
            continue
        title = str(entry.get("title") or "")
        csl_item: dict[str, Any] | None = None
        metadata = metadata_by_id.get(entry.get("id"))
        if metadata:
            metadata_copy = dict(metadata)
            if metadata_copy.get("Authors") is not None:
                metadata_copy["Authors"] = normalize_authors_field(metadata_copy.get("Authors"))
            metadata_copy.setdefault("Citation Key", key)
            try:
                csl_item = recursos_metadata_to_csl(
                    title,
                    metadata_copy,
                    dependencies.resolve_csl_type,
                )
            except Exception:
                csl_item = None
        if not csl_item:
            try:
                page_id = entry.get("id")
                page_path = dependencies.find_page(str(page_id or ""))
                if page_path:
                    raw = page_path.read_text(encoding="utf-8")
                    fallback_metadata, _body = dependencies.parse_frontmatter(
                        raw,
                        page_path,
                    )
                    csl_item = recursos_metadata_to_csl(
                        title,
                        fallback_metadata,
                        dependencies.resolve_csl_type,
                    )
            except OSError:
                csl_item = None
        if csl_item:
            result.append(csl_item)
    return result


def pandoc_binary() -> str:
    configured = os.environ.get("PANDOC_PATH", "").strip()
    if configured and Path(configured).exists():
        return configured
    found = shutil.which("pandoc")
    if found:
        return found
    for candidate in ("/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc"):
        if Path(candidate).exists():
            return candidate
    return "pandoc"


def extract_csl_entries(html_output: str) -> list[str]:
    entries: list[str] = []
    for match in re.finditer(
        r'<div[^>]*class="[^"]*csl-entry[^"]*"[^>]*>',
        html_output,
    ):
        depth = 1
        position = match.end()
        for tag in re.finditer(r"<(/?)div\b[^>]*>", html_output[position:]):
            depth += -1 if tag.group(1) else 1
            if depth == 0:
                entries.append(html_output[position : position + tag.start()].strip())
                break
        else:
            entries.append(html_output[position:].strip())
    return entries


def _run_pandoc(
    command: list[str],
    working_directory: Path,
    timeout: int,
) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=working_directory,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=PANDOC_MISSING_MSG) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="pandoc timeout") from exc
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"pandoc failed: {result.stderr[:300]}",
        )
    return result.stdout


def _build_format_citation(
    dependencies: FormattingDependencies,
) -> Callable[..., object]:
    async def format_citation(
        key: str,
        style: str = Query("apa"),
        locale: str = Query("en-US"),
    ) -> dict[str, object]:
        """Renders an inline citation (a single citation key) as plain text.

        Designed for the Office Add-in (Gnosi Cite): the add-in wants to insert
        formatted text into the Word document. The backend invokes pandoc-citeproc
        with the minimal subset (a single element) and returns the inline text.

        Response: `{ formatted: "(Smith, 2020)", key: "smith2020" }`. If it can't
        be resolved, returns the citation key in parentheses as a fallback
        so the user can see the problem in the document.
        """
        key_norm = str(key or "").strip()
        if not key_norm:
            raise HTTPException(status_code=400, detail="key is required")
        csl_items = await asyncio.to_thread(
            build_csl_items_for_keys,
            [key_norm],
            dependencies,
        )
        if not csl_items:
            return {"key": key_norm, "formatted": f"(@{key_norm})", "resolved": False}
        csl_path = resolve_csl_path(style)
        with tempfile.TemporaryDirectory(prefix="gnosi_fmt_") as directory:
            temporary = Path(directory)
            (temporary / "input.md").write_text(f"[@{key_norm}]\n", encoding="utf-8")
            (temporary / "refs.json").write_text(
                json.dumps(csl_items, ensure_ascii=False),
                encoding="utf-8",
            )
            command = [
                pandoc_binary(),
                "input.md",
                "-t",
                "plain",
                "--wrap=none",
                "--citeproc",
                "--bibliography",
                "refs.json",
                "--metadata",
                f"lang={locale}",
            ]
            if csl_path:
                command += ["--csl", str(csl_path)]
            output = _run_pandoc(command, temporary, 20)
        formatted = output.split("\n\n", 1)[0].strip()
        return {"key": key_norm, "formatted": formatted, "resolved": True}

    return format_citation


def _build_format_citations(
    dependencies: FormattingDependencies,
) -> Callable[..., object]:
    async def format_citations(payload: dict[str, Any] = Body(...)) -> dict[str, object]:
        """Renders a set of inline citations TOGETHER — necessary to
        comply with APA and other context-sensitive styles.

        Why this batch variant is needed (not the singular `format-citation`):
          - APA disambiguates homonymous authors within a document (Smith, J. vs
            Smith, A.) by adding initials on first appearance
          - Same author + same year → automatic `2020a`, `2020b` suffixes
          - First appearance of a group with many authors → full names;
            subsequent ones → `et al.`
          - Citeproc can only make these decisions if it receives the ENTIRE subset
            that appears in the document in a single call

        Body: `{ keys: ["smith2020", "lee2021", "smith2020"], style, locale }`
        (duplicates are allowed — citeproc-js and pandoc-citeproc count
        occurrences to decide the appropriate format).

        Response: `{ items: [{key, formatted, ordinal}, ...], style, locale }`
        `ordinal` is the order of appearance (1, 2, 3…) — useful for knowing which
        Content Control in the document each formatted text corresponds to.
        """
        raw_keys = payload.get("keys") or []
        if not isinstance(raw_keys, list):
            raise HTTPException(status_code=400, detail="keys must be a list")
        keys = [str(key).strip().lstrip("@") for key in raw_keys if str(key).strip()]
        style = str(payload.get("style") or "apa").strip()
        locale = str(payload.get("locale") or "en-US").strip()
        if not keys:
            return {"items": [], "style": style, "locale": locale}
        unique_keys = list(dict.fromkeys(keys))
        csl_items = await asyncio.to_thread(
            build_csl_items_for_keys,
            unique_keys,
            dependencies,
        )
        resolved_keys = {str(item.get("id")) for item in csl_items}
        lines = [
            f"GCREF{ordinal}BEG [@{key}] GCREF{ordinal}FIN"
            if key in resolved_keys
            else f"GCREF{ordinal}BEG (\\@{key}) GCREF{ordinal}FIN"
            for ordinal, key in enumerate(keys, start=1)
        ]
        with tempfile.TemporaryDirectory(prefix="gnosi_fmts_") as directory:
            temporary = Path(directory)
            (temporary / "input.md").write_text("\n\n".join(lines) + "\n", encoding="utf-8")
            if csl_items:
                (temporary / "refs.json").write_text(
                    json.dumps(csl_items, ensure_ascii=False),
                    encoding="utf-8",
                )
            command = [
                pandoc_binary(),
                "input.md",
                "-t",
                "plain",
                "--wrap=none",
                "--metadata",
                f"lang={locale}",
            ]
            if csl_items:
                command += ["--citeproc", "--bibliography", "refs.json"]
            csl_path = resolve_csl_path(style)
            if csl_path:
                command += ["--csl", str(csl_path)]
            output = _run_pandoc(command, temporary, 30)
        items: list[dict[str, object]] = []
        for ordinal, key in enumerate(keys, start=1):
            pattern = re.compile(
                re.escape(f"GCREF{ordinal}BEG") + r"\s*(.*?)\s*" + re.escape(f"GCREF{ordinal}FIN"),
                re.DOTALL,
            )
            match = pattern.search(output)
            items.append(
                {
                    "key": key,
                    "ordinal": ordinal,
                    "formatted": match.group(1).strip() if match else f"(@{key})",
                    "resolved": key in resolved_keys,
                }
            )
        return {"items": items, "style": style, "locale": locale}

    return format_citations


def _build_format_bibliography(
    dependencies: FormattingDependencies,
) -> Callable[..., object]:
    async def format_bibliography(
        payload: dict[str, Any] = Body(...),
    ) -> dict[str, object]:
        """Renders the bibliography (list of entries) for the given citation
        keys. Designed for the Office Add-in.

        Body: `{ keys: ["smith2020", "lee2021"], style: "apa", locale: "en-US" }`
        Response: `{ entries: ["Smith, J. (2020). ...", "Lee, A. (2021). ..."], style, locale }`

        Pandoc is invoked with `--nocite` so it generates the bibliography without
        needing to cite in the body. Each entry in the list is separated by
        a blank line (`plain` output), which we parse.
        """
        raw_keys = payload.get("keys") or []
        if not isinstance(raw_keys, list):
            raise HTTPException(status_code=400, detail="keys must be a list")
        keys = [str(key).strip().lstrip("@") for key in raw_keys if str(key).strip()]
        style = str(payload.get("style") or "apa").strip()
        locale = str(payload.get("locale") or "en-US").strip()
        csl_items = await asyncio.to_thread(
            build_csl_items_for_keys,
            keys,
            dependencies,
        )
        if not csl_items:
            return {
                "entries": [],
                "style": style,
                "locale": locale,
                "resolved": 0,
                "missing": keys,
            }
        resolved_keys = {str(item.get("id")) for item in csl_items}
        missing = [key for key in keys if key not in resolved_keys]
        nocite = " ".join(f"@{item['id']}" for item in csl_items)
        markdown = f"---\nnocite: |\n  {nocite}\n---\n\n::: {{#refs}}\n:::\n"
        with tempfile.TemporaryDirectory(prefix="gnosi_bib_") as directory:
            temporary = Path(directory)
            (temporary / "input.md").write_text(markdown, encoding="utf-8")
            (temporary / "refs.json").write_text(
                json.dumps(csl_items, ensure_ascii=False),
                encoding="utf-8",
            )
            command = [
                pandoc_binary(),
                "input.md",
                "-t",
                "html",
                "--citeproc",
                "--bibliography",
                "refs.json",
                "--metadata",
                f"lang={locale}",
                "--metadata",
                "link-bibliography=true",
                "--wrap=none",
            ]
            csl_path = resolve_csl_path(style)
            if csl_path:
                command += ["--csl", str(csl_path)]
            output = _run_pandoc(command, temporary, 30)
        entries_html = extract_csl_entries(output)
        if not entries_html:
            entries_html = [
                match.strip() for match in re.findall(r"<p>(.*?)</p>", output, re.DOTALL)
            ]
        entries = [html.unescape(re.sub(r"<[^>]+>", "", entry)).strip() for entry in entries_html]
        return {
            "entries": entries,
            "entries_html": entries_html,
            "style": style,
            "locale": locale,
            "resolved": len(csl_items),
            "missing": missing,
        }

    return format_bibliography


def register_routes(
    router: APIRouter,
    dependencies: FormattingDependencies,
) -> tuple[Callable[..., object], ...]:
    format_citation = _build_format_citation(dependencies)

    format_citations = _build_format_citations(dependencies)

    format_bibliography = _build_format_bibliography(dependencies)

    router.add_api_route(
        "/format-citation",
        format_citation,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/format-citations",
        format_citations,
        methods=["POST"],
        response_model=None,
    )
    router.add_api_route(
        "/format-bibliography",
        format_bibliography,
        methods=["POST"],
        response_model=None,
    )
    return format_citation, format_citations, format_bibliography


__all__ = [
    "FormattingDependencies",
    "PANDOC_MISSING_MSG",
    "build_csl_items_for_keys",
    "extract_csl_entries",
    "pandoc_binary",
    "register_routes",
    "resolve_csl_path",
]
