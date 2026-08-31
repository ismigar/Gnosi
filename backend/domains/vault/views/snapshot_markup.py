"""Markdown syntax for persisted saved-view definitions and snapshots."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Match, overload

SNAPSHOT_OPEN_PREFIX = "<!-- gnosi-view:result"
SNAPSHOT_BLOCK_RE = re.compile(
    r"[ \t]*<!--\s*gnosi-view:result\b[^>]*-->\n"
    r".*?"
    r"\n[ \t]*<!--\s*/gnosi-view:result\s*-->[ \t]*",
    re.DOTALL,
)
FENCE_RE = re.compile(
    r"```gnosi-view[ \t]*\n(?P<json>.*?)\n```[ \t]*",
    re.DOTALL,
)
DEFAULT_MAX_ITEMS = 500
DEF_COMMENT_RE = re.compile(r"[ \t]*<!--\s*gnosi-view:def\s+(?P<json>.*?)\s*-->[ \t]*")
FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)
RESULT_RENDER_RE = re.compile(
    r"[ \t]*<!--\s*gnosi-view:result\b[^>]*-->\n(?P<content>.*?)\n"
    r"[ \t]*<!--\s*/gnosi-view:result\s*-->[ \t]*",
    re.DOTALL,
)
RESULT_TRUNC_RE = re.compile(r"\n?[ \t]*<!--\s*gnosi-view:result-truncated\s+\d+\s*-->[ \t]*")
SNAPSHOT_WIKILINK_RE = re.compile(r"\[\[([^\[\]|\\]+)\\?\|[^\[\]]+\]\]")


@overload
def compact_view_fences(body: str) -> str: ...


@overload
def compact_view_fences(body: object) -> object: ...


def compact_view_fences(body: object) -> object:
    """Convert visible ``gnosi-view`` fences to compact hidden definitions."""
    if not isinstance(body, str) or "```gnosi-view" not in body:
        return body

    def replace(match: Match[str]) -> str:
        try:
            payload = json.loads(match.group("json"))
        except Exception:
            return match.group(0)
        compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return f"<!-- gnosi-view:def {compact} -->"

    return FENCE_RE.sub(replace, body)


@overload
def restore_view_fences(body: str) -> str: ...


@overload
def restore_view_fences(body: object) -> object: ...


def restore_view_fences(body: object) -> object:
    """Convert hidden definitions back to editor-facing view fences."""
    if not isinstance(body, str) or "gnosi-view:def" not in body:
        return body

    def replace(match: Match[str]) -> str:
        try:
            payload = json.loads((match.group("json") or "").strip())
        except Exception:
            return match.group(0)
        pretty = json.dumps(payload, ensure_ascii=False, indent=2)
        return f"```gnosi-view\n{pretty}\n```"

    return DEF_COMMENT_RE.sub(replace, body)


@overload
def strip_view_snapshots(body: str) -> str: ...


@overload
def strip_view_snapshots(body: object) -> object: ...


def strip_view_snapshots(body: object) -> object:
    """Remove every derived snapshot block from an editor-facing body."""
    if not isinstance(body, str) or SNAPSHOT_OPEN_PREFIX not in body:
        return body
    cleaned = re.sub(r"\n?\n" + SNAPSHOT_BLOCK_RE.pattern, "", body, flags=re.DOTALL)
    return SNAPSHOT_BLOCK_RE.sub("", cleaned)


@overload
def render_view_snapshots(body: str) -> str: ...


@overload
def render_view_snapshots(body: object) -> object: ...


def render_view_snapshots(body: object) -> object:
    """Render saved snapshot content while hiding its view definition."""
    if not isinstance(body, str) or "gnosi-view" not in body:
        return body

    def show(match: Match[str]) -> str:
        content = RESULT_TRUNC_RE.sub("", match.group("content"))
        content = SNAPSHOT_WIKILINK_RE.sub(r"[[\1]]", content)
        return content.strip("\n")

    rendered = RESULT_RENDER_RE.sub(show, body)
    return DEF_COMMENT_RE.sub("", rendered)


@overload
def flatten_view_columns(body: str) -> str: ...


@overload
def flatten_view_columns(body: object) -> object: ...


def flatten_view_columns(body: object) -> object:
    """Remove column directives and unindent their preview content."""
    if not isinstance(body, str) or ":::" not in body:
        return body
    output: list[str] = []
    in_columns = False
    for raw_line in body.split("\n"):
        line = raw_line
        stripped = line.strip()
        if stripped.startswith(":::column-list"):
            in_columns = True
            continue
        if stripped.startswith(":::column") or stripped == ":::":
            continue
        if in_columns and line and not line[:1].isspace():
            in_columns = False
        if in_columns and line.startswith("    "):
            line = line[4:]
        output.append(line)
    return "\n".join(output)


def build_list_block(view_id: str, items: Sequence[str], truncated: int = 0) -> str:
    open_tag = (
        f"<!-- gnosi-view:result view_id={view_id} -->" if view_id else "<!-- gnosi-view:result -->"
    )
    lines = [open_tag]
    lines.extend(f"- {item}" for item in items)
    if truncated > 0:
        lines.append(f"<!-- gnosi-view:result-truncated {truncated} -->")
    lines.append("<!-- /gnosi-view:result -->")
    return "\n".join(lines)


def markdown_cell(value: object) -> str:
    rendered = "" if value is None else str(value)
    return (
        rendered.replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r", " ")
        .replace("\n", " ")
        .strip()
    )


def build_table_block(
    view_id: str,
    headers: Sequence[str],
    rows: Sequence[Sequence[object]],
    truncated: int = 0,
) -> str:
    open_tag = (
        f"<!-- gnosi-view:result view_id={view_id} -->" if view_id else "<!-- gnosi-view:result -->"
    )
    lines = [open_tag]
    lines.append("| " + " | ".join(markdown_cell(header) for header in headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        lines.append("| " + " | ".join(markdown_cell(cell) for cell in row) + " |")
    if truncated > 0:
        lines.append(f"<!-- gnosi-view:result-truncated {truncated} -->")
    lines.append("<!-- /gnosi-view:result -->")
    return "\n".join(lines)


__all__ = [
    "DEFAULT_MAX_ITEMS",
    "DEF_COMMENT_RE",
    "FENCE_RE",
    "FRONTMATTER_RE",
    "RESULT_RENDER_RE",
    "RESULT_TRUNC_RE",
    "SNAPSHOT_BLOCK_RE",
    "SNAPSHOT_OPEN_PREFIX",
    "SNAPSHOT_WIKILINK_RE",
    "build_list_block",
    "build_table_block",
    "compact_view_fences",
    "flatten_view_columns",
    "markdown_cell",
    "render_view_snapshots",
    "restore_view_fences",
    "strip_view_snapshots",
]
