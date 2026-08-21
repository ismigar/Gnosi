"""Bounded semantic taint analysis for untrusted agent evidence."""

from __future__ import annotations

import re
from typing import Any, Iterable, Mapping


PATTERNS = {
    "instruction_override": re.compile(r"\b(?:ignore|disregard|override)\b.{0,40}\b(?:instruction|policy|system)\b", re.I),
    "authority_spoofing": re.compile(r"\b(?:system|developer|administrator)\s*(?:message|instruction)?\s*:", re.I),
    "tool_coercion": re.compile(r"\b(?:call|invoke|execute|run)\b.{0,30}\b(?:tool|command|function)\b", re.I),
    "secret_exfiltration": re.compile(r"\b(?:reveal|send|copy|dump|exfiltrate)\b.{0,40}\b(?:secret|credential|token|api key|password|prompt)\b", re.I),
}
MAX_SCANNED_CHARS = 120_000


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for key, item in value.items():
            if str(key).lower() in {"password", "secret", "token", "api_key", "credential"}:
                continue
            yield from _strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value[:500]:
            yield from _strings(item)


def analyze_evidence(payloads: Iterable[Any]) -> dict[str, Any]:
    """Return categories and severity without copying source text."""
    categories: dict[str, int] = {}
    scanned = 0
    for payload in payloads:
        for text in _strings(payload):
            if scanned >= MAX_SCANNED_CHARS:
                break
            bounded = text[: min(len(text), MAX_SCANNED_CHARS - scanned)]
            scanned += len(bounded)
            for category, pattern in PATTERNS.items():
                count = len(pattern.findall(bounded))
                if count:
                    categories[category] = min(99, categories.get(category, 0) + count)
    severity = "high" if categories.get("secret_exfiltration") or categories.get("tool_coercion") else (
        "medium" if categories else "none"
    )
    return {
        "schema_version": 1,
        "status": "tainted" if categories else "clear",
        "severity": severity,
        "categories": [
            {"category": key, "count": value}
            for key, value in sorted(categories.items())
        ][:8],
        "scanned_char_bucket": min(120_000, (scanned // 10_000) * 10_000),
        "authorization_changed": False,
    }
