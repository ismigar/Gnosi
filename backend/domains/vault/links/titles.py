"""Readable reference labels without changing stored page identities."""
from __future__ import annotations

import re
from collections.abc import Callable

UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)


def readable_title(title: str, resolve_title: Callable[[str], str], fallback: str = "—") -> str:
    def replace(match: re.Match[str]) -> str:
        resolved = resolve_title(match.group()) or resolve_title(match.group().lower())
        return resolved if resolved and not UUID.search(resolved) else fallback
    return UUID.sub(replace, title.strip()) or fallback


def reference_title(value: object, resolve_title: Callable[[str], str]) -> str:
    if isinstance(value, dict):
        identifier = str(value.get("id") or "")
        label = str(value.get("title") or value.get("name") or "")
    else:
        raw = str(value or "").strip()
        parts = raw[2:-2].split("|") if raw.startswith("[[") and raw.endswith("]]") else [raw]
        identifier = next((p.strip() for p in parts if UUID.fullmatch(p.strip())), "")
        label = next((p.strip() for p in parts if p.strip() and not UUID.fullmatch(p.strip())), "")
    return readable_title(resolve_title(identifier) or label or identifier, resolve_title)
