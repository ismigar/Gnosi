"""Deterministic source locators and citation links for generated reading notes."""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlencode

from backend.utils.open_values import float_value


def parse_page(locator: str) -> Optional[int]:
    if not locator:
        return None
    match = re.search(r"(?:p{1,2}\.?|p[àa]g\.?|page|pl?\.?)\s*(\d{1,5})", locator, re.IGNORECASE)
    if not match:
        match = re.search(r"\b(\d{1,5})\b", locator)
    if not match:
        return None
    try:
        page = int(match.group(1))
        return page if page > 0 else None
    except ValueError:
        return None


def render_citations(
    citations: object,
    _source_title: str,
    source_id: str,
    source_table_id: str = "",
) -> str:
    if not isinstance(citations, list) or not citations:
        return ""
    lines = ["", "### Cites", ""]
    for citation in citations:
        if not isinstance(citation, dict):
            continue
        quote = str(citation.get("quote") or "").strip()
        if not quote:
            continue
        locator = citation.get("locator") or {}
        if isinstance(locator, str):
            page = parse_page(locator)
            locator = {"page": page} if page else {"label": locator}
        params = {
            "res": source_id,
            "table": source_table_id,
            "snapshot": citation.get("snapshot_id") or "",
            "segment": citation.get("segment_id") or "",
            "origin": citation.get("origin_id") or "",
        }
        for key in ("page", "chapter", "paragraph", "line_start", "line_end", "start", "end"):
            value = locator.get(key)
            if value not in (None, ""):
                params[key] = value
        jump = f"[{locator_label(locator)}](gnosi-cite:?{urlencode(params)})"
        lines.extend([f"> {quote} — {jump}", ""])
    return "\n".join(lines) if len(lines) > 3 else ""


def locator_label(locator: dict[str, object]) -> str:
    if locator.get("page"):
        label = f"p. {locator['page']}"
        if locator.get("paragraph"):
            label += f", ¶ {locator['paragraph']}"
        return label
    if locator.get("chapter"):
        label = str(locator["chapter"])
        if locator.get("paragraph"):
            label += f", ¶ {locator['paragraph']}"
        return label
    if locator.get("line_start"):
        end = locator.get("line_end") or locator["line_start"]
        return f"l. {locator['line_start']}–{end}"
    if locator.get("start") is not None:
        return format_timestamp(float_value(locator.get("start") or 0))
    if locator.get("image"):
        return str(locator["image"])
    return str(locator.get("label") or "fragment")


def format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"
