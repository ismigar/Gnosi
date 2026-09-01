"""Pure systematic-review workflow, PRISMA, and export logic."""

from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any
from xml.sax.saxutils import escape

from fastapi import HTTPException


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def decode(value: Any, fallback: Any) -> Any:
    if isinstance(value, type(fallback)):
        return value
    try:
        parsed = json.loads(str(value or ""))
        return parsed if isinstance(parsed, type(fallback)) else fallback
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def review_public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "question": row.get("Question") or "",
        "protocol": row.get("Protocol") or row.get("content") or "",
        "criteria": decode(row.get("Eligibility Criteria"), {}),
        "reviewer_mode": row.get("Reviewer Mode") or "single",
        "reviewers": decode(row.get("Reviewers"), []),
        "status": row.get("Status") or "draft",
        "configuration": decode(row.get("Configuration"), {}),
        "created_at": row.get("created_at"),
        "updated_at": row.get("last_edited_at"),
    }


def current_by_reviewer(decisions: list[dict[str, Any]], phase: str) -> dict[str, dict[str, Any]]:
    return {
        str(decision["reviewer_id"]): decision
        for decision in decisions
        if decision["phase"] == phase and not decision.get("resolution")
    }


def next_phase(phase: str, decision: str) -> str:
    """Return the deterministic next screening phase."""
    if decision == "exclude":
        return "excluded"
    if phase == "identified":
        return "title_abstract"
    if phase == "title_abstract":
        return "full_text_requested"
    if phase == "full_text_requested":
        return "full_text_assessed"
    if phase == "full_text_assessed":
        return "included"
    return phase


def verified_oa_location(work: dict[str, Any], requested_url: str) -> dict[str, Any] | None:
    """Return provider-asserted open-access evidence for an exact URL."""
    url = requested_url.strip()
    if not url.startswith(("https://", "http://")):
        return None
    open_access_value = work.get("open_access")
    open_access: dict[str, Any] = open_access_value if isinstance(open_access_value, dict) else {}
    locations_value = work.get("locations")
    locations: list[Any] = locations_value if isinstance(locations_value, list) else []
    best = open_access.get("best_location")
    if isinstance(best, dict):
        locations = [best, *locations]
    for location in locations:
        if not isinstance(location, dict):
            continue
        candidates = {
            str(location.get(field) or "").strip()
            for field in ("url", "landing_page_url", "pdf_url")
        }
        if url in candidates and (
            location.get("is_oa") is True or open_access.get("is_oa") is True
        ):
            return {
                "url": url,
                "license": str(location.get("license") or open_access.get("license") or "")[:500],
                "provider_asserted_oa": True,
            }
    return None


def prisma_counts(
    candidates: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    activities: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Calculate deterministic PRISMA counters from review records."""
    phases = Counter(candidate.get("phase") or "identified" for candidate in candidates)
    replaced_ids = {
        str(decision.get("replaces_decision_id"))
        for decision in decisions
        if decision.get("replaces_decision_id")
    }
    current = [
        decision for decision in decisions if str(decision.get("id") or "") not in replaced_ids
    ]
    reasons = Counter(
        decision.get("reason") or "No reason recorded"
        for decision in current
        if decision.get("decision") == "exclude"
        and decision.get("phase") in {"full_text_requested", "full_text_assessed"}
    )
    identified = 0
    duplicates = 0
    counted: set[str] = set()
    for activity in activities or []:
        if activity.get("activity_type") not in {
            "search_strategy",
            "scheduled_search",
            "snowball",
        }:
            continue
        value = activity.get("counts")
        counts: dict[str, Any] = value if isinstance(value, dict) else {}
        key = str(counts.get("search_id") or activity.get("id") or "")
        if key in counted:
            continue
        counted.add(key)
        identified += max(0, int(counts.get("raw_occurrences") or counts.get("identified") or 0))
        duplicates += max(0, int(counts.get("duplicates_removed") or 0))
    if not identified:
        identified = len(candidates) + duplicates
    sought = phases["full_text_requested"] + phases["full_text_assessed"] + phases["included"]
    sought += sum(
        1
        for candidate in candidates
        if candidate.get("phase") == "excluded"
        and candidate.get("full_text") not in {None, "", "not_requested"}
    )
    return {
        "identified": identified,
        "duplicates_removed": duplicates,
        "screened": len(candidates),
        "title_abstract_excluded": sum(
            1
            for candidate in candidates
            if candidate.get("phase") == "excluded"
            and candidate.get("full_text") in {None, "", "not_requested"}
        ),
        "reports_sought": sought,
        "reports_unavailable": sum(
            1 for candidate in candidates if candidate.get("full_text") == "unavailable"
        ),
        "full_text_assessed": phases["full_text_assessed"] + phases["included"],
        "included": phases["included"],
        "full_text_exclusions": dict(reasons),
    }


def render_export(audit: dict[str, Any], export_format: str) -> tuple[bytes, str, str]:
    """Render one review audit in a supported portable format."""
    safe_title = (
        re.sub(r"[^a-zA-Z0-9._-]+", "-", audit["review"]["title"]).strip("-")[:100]
        or "literature-review"
    )
    if export_format == "json":
        return (
            json.dumps(audit, ensure_ascii=False, indent=2).encode(),
            "application/json",
            f"{safe_title}-audit.json",
        )
    if export_format == "csv":
        output = io.StringIO()
        fields = ("candidate_id", "title", "phase", "resource_id", "sources", "identifiers")
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for candidate in audit["candidates"]:
            writer.writerow(
                {
                    "candidate_id": candidate["id"],
                    "title": candidate["title"],
                    "phase": candidate["phase"],
                    "resource_id": candidate.get("resource_id") or "",
                    "sources": json.dumps(
                        candidate.get("sources") or [], ensure_ascii=False, separators=(",", ":")
                    ),
                    "identifiers": json.dumps(
                        candidate.get("identifiers") or {},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                }
            )
        return (
            output.getvalue().encode("utf-8-sig"),
            "text/csv; charset=utf-8",
            f"{safe_title}-candidates.csv",
        )
    if export_format == "markdown":
        prisma = audit["prisma"]
        lines = [
            f"# {audit['review']['title']}",
            "",
            f"**Question:** {audit['review']['question']}",
            "",
            "## Protocol",
            "",
            audit["review"]["protocol"] or "No protocol recorded.",
            "",
            "## PRISMA summary",
            "",
            f"- Records identified: {prisma['identified']}",
            f"- Records screened: {prisma['screened']}",
            f"- Reports sought: {prisma['reports_sought']}",
            f"- Reports unavailable: {prisma['reports_unavailable']}",
            f"- Studies included: {prisma['included']}",
            "",
            "## Included studies",
            "",
        ]
        lines.extend(
            f"- {item['title']}" for item in audit["candidates"] if item["phase"] == "included"
        )
        return "\n".join(lines).encode(), "text/markdown; charset=utf-8", f"{safe_title}-report.md"
    if export_format == "prisma-svg":
        return _prisma_svg(audit).encode(), "image/svg+xml", f"{safe_title}-prisma.svg"
    raise HTTPException(
        status_code=400, detail="Export format must be csv, json, markdown, or prisma-svg."
    )


def _prisma_svg(audit: dict[str, Any]) -> str:
    counts = audit["prisma"]
    title = escape(str(audit["review"]["title"]))
    boxes = [
        (40, 90, "Identification", f"Records identified\n(n = {counts['identified']})"),
        (40, 220, "Screening", f"Records screened\n(n = {counts['screened']})"),
        (40, 350, "Eligibility", f"Reports sought\n(n = {counts['reports_sought']})"),
        (40, 480, "Included", f"Studies included\n(n = {counts['included']})"),
    ]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="650" viewBox="0 0 800 650" role="img" aria-labelledby="title desc">',
        f'<title id="title">PRISMA 2020 — {title}</title>',
        '<desc id="desc">Printable PRISMA 2020 flow diagram generated from the review audit.</desc>',
        "<style>text{font-family:Arial,sans-serif;fill:#172033}.box{fill:#fff;stroke:#334155;stroke-width:2}.label{font-size:16px;font-weight:700}.count{font-size:15px}.arrow{stroke:#64748b;stroke-width:2;marker-end:url(#a)}</style>",
        '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker></defs>',
        f'<text x="40" y="42" font-size="22" font-weight="700">{title}</text>',
    ]
    for index, (x, y, label, text) in enumerate(boxes):
        parts.extend(
            [
                f'<rect class="box" x="{x}" y="{y}" width="340" height="86" rx="8"/>',
                f'<text class="label" x="{x + 16}" y="{y + 28}">{escape(label)}</text>',
            ]
        )
        parts.extend(
            f'<text class="count" x="{x + 16}" y="{y + 52 + i * 20}">{escape(line)}</text>'
            for i, line in enumerate(text.split("\n"))
        )
        if index < len(boxes) - 1:
            parts.append(
                f'<line class="arrow" x1="210" y1="{y + 86}" x2="210" y2="{boxes[index + 1][1] - 8}"/>'
            )
    side = [
        (430, 90, f"Duplicate records removed\n(n = {counts['duplicates_removed']})"),
        (430, 220, f"Excluded before full text\n(n = {counts['title_abstract_excluded']})"),
        (430, 350, f"Reports unavailable\n(n = {counts['reports_unavailable']})"),
    ]
    for x, y, text in side:
        parts.append(f'<rect class="box" x="{x}" y="{y}" width="320" height="86" rx="8"/>')
        parts.extend(
            f'<text class="count" x="{x + 16}" y="{y + 32 + i * 22}">{escape(line)}</text>'
            for i, line in enumerate(text.split("\n"))
        )
        parts.append(f'<line class="arrow" x1="380" y1="{y + 43}" x2="{x - 8}" y2="{y + 43}"/>')
    parts.append("</svg>")
    return "".join(parts)
