"""Native PDF bookmarks and media chapter metadata, without inferred divisions."""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Sequence
from pathlib import Path

from backend.domains.llm_wiki.source_structure import HeadingContext


def timed_sections(segments: list[dict[str, object]], chapters: object) -> list[dict[str, object]]:
    if not isinstance(chapters, list):
        return segments
    entries: list[tuple[float, float, dict[str, object]]] = []
    for index, chapter in enumerate(chapters):
        if not isinstance(chapter, dict):
            continue
        tags = chapter.get("tags")
        title = str(chapter.get("title") or (tags.get("title") if isinstance(tags, dict) else "") or "").strip()
        try:
            start = float(chapter.get("start_time", 0))
            end = float(chapter.get("end_time", float("inf")))
        except (TypeError, ValueError):
            continue
        if title and 0 <= start < end:
            entries.append((start, end, {"key": f"media-chapter-{index + 1}",
                                        "title": title, "order": index + 1}))
    output = []
    for segment in segments:
        raw = segment.get("locator")
        locator = dict(raw) if isinstance(raw, dict) else {}
        try:
            position = float(locator.get("start", 0))
        except (TypeError, ValueError):
            output.append(segment)
            continue
        node = next((node for start, end, node in entries if start <= position < end), None)
        output.append({**segment, "locator": {**locator, "section": node["title"],
                                               "section_path": [node]}} if node else segment)
    return output


def file_chapters(path: Path) -> object:
    binary = shutil.which("ffprobe")
    if not binary:
        return []
    try:
        result = subprocess.run([binary, "-v", "error", "-show_chapters", "-of", "json", str(path)],
                                capture_output=True, text=True, timeout=30, check=False)
        data = json.loads(result.stdout) if result.returncode == 0 else {}
        return data.get("chapters", []) if isinstance(data, dict) else []
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []


def pdf_sections(reader: object) -> dict[int, dict[str, object]]:
    """Expose only unambiguous page-level bookmarks; repeated-page headings need text."""
    from pypdf import PdfReader
    from pypdf.generic import Destination
    if not isinstance(reader, PdfReader):
        return {}
    paths: dict[int, dict[str, object]] = {}
    ambiguous: set[int] = set()
    structure = HeadingContext(prefix="pdf:")

    def visit(items: Sequence[object], level: int) -> None:
        for item in items:
            if isinstance(item, list):
                visit(item, level + 1)
            elif isinstance(item, Destination) and item.get("/Title"):
                structure.push(level, str(item["/Title"]))
                page = reader.get_destination_page_number(item)
                if page is None or page < 0:
                    continue
                current = structure.locator()
                previous = paths.get(page + 1, {})
                previous_path = previous.get("section_path", [])
                current_path = current.get("section_path", [])
                if previous_path and isinstance(current_path, list) and isinstance(previous_path, list):
                    if previous_path != current_path[:len(previous_path)]:
                        ambiguous.add(page + 1)
                paths[page + 1] = current

    try:
        visit(reader.outline, 1)
    except (ValueError, TypeError, KeyError):
        return {}
    # Parent/child bookmarks sharing a page retain the deepest path. Distinct
    # sibling headings sharing a page cannot locate a paragraph reliably.
    for page in ambiguous:
        paths[page] = {}
    return paths
