"""Original heading paths, independent of note order and evidence locators."""

from __future__ import annotations

import hashlib
import json
from uuid import NAMESPACE_URL, uuid5


class HeadingContext:
    """Keep native heading levels and occurrence keys, including repeated titles."""

    def __init__(self, prefix: str = "") -> None:
        self.prefix = prefix
        self.count = 0
        self.stack: list[tuple[int, dict[str, object]]] = []
        self.occurrences: dict[tuple[str, str], int] = {}

    def push(self, level: int, title: str) -> None:
        self.count += 1
        self.stack = [(depth, node) for depth, node in self.stack if depth < level]
        parent = str(self.stack[-1][1].get("identity") or "") if self.stack else self.prefix
        occurrence_key = (parent, title)
        self.occurrences[occurrence_key] = self.occurrences.get(occurrence_key, 0) + 1
        identity = hashlib.sha256(json.dumps([parent, title, self.occurrences[occurrence_key]],
                                             ensure_ascii=False).encode("utf-8")).hexdigest()[:24]
        self.stack.append((level, {"key": f"{self.prefix}heading-{self.count}",
                                  "identity": identity, "title": title, "order": self.count}))

    def locator(self) -> dict[str, object]:
        return {"section": self.stack[-1][1]["title"] if self.stack else "",
                **({"section_path": [dict(node) for _, node in self.stack]} if self.stack else {})}


def section_path(locator: object) -> list[dict[str, object]]:
    """Use native structure only; time ranges and page numbers are not sections."""
    if not isinstance(locator, dict):
        return []
    raw = locator.get("section_path")
    if isinstance(raw, list):
        return [dict(node) for node in raw if isinstance(node, dict)
                and node.get("key") and node.get("title")]
    # Compatibility for existing snapshots with a single, original heading.
    title = str(locator.get("section") or locator.get("chapter") or "").strip()
    if not title:
        return []
    key = str(locator.get("chapter_number") or title)
    return [{"key": key, "title": title, "order": locator.get("chapter_number", 0)}]


def document_key(origin: dict[str, object]) -> str:
    """A document identity survives content changes, unlike its snapshot hash."""
    kind = origin.get("kind")
    if origin.get("source_identity"):
        return str(origin["source_identity"])
    url = origin.get("source_url")
    label = "" if kind == "body" or url else origin.get("label")
    raw = json.dumps([kind, label, url, origin.get("input_order", 0)],
                     ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def section_id(brain_id: str, source_table_id: str, resource_id: str,
               document: str, key: str) -> str:
    raw = json.dumps([brain_id, source_table_id, resource_id, document, key])
    return str(uuid5(NAMESPACE_URL, "gnosi:source-section:" + raw))


def sections_table_id(brain_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, "gnosi:source-sections:" + brain_id))


def structure_catalog(origins: list[dict[str, object]]) -> list[dict[str, object]]:
    """Keep every observed original section, including sections yielding no notes."""
    catalog: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for origin in origins:
        document = document_key(origin)
        segments = origin.get("segments")
        for segment in segments if isinstance(segments, list) else []:
            if not isinstance(segment, dict):
                continue
            path = section_path(segment.get("locator"))
            if not path:
                continue
            key = (document, str(path[-1]["key"]))
            if key in seen:
                continue
            seen.add(key)
            catalog.append({"source_document_key": document, "source_section_path": path,
                            "source_document_label": origin.get("label", ""),
                            "origin_order": origin.get("input_order", 0),
                            "segment_order": segment.get("order", 0)})
    return catalog


def bind_note_structure(notes: list[dict[str, object]], origins: list[dict[str, object]]) -> None:
    """Rebind reviewed checkpoint notes to the currently verified original segments."""
    by_segment: dict[str, dict[str, object]] = {}
    for origin in origins:
        segments = origin.get("segments")
        for segment in segments if isinstance(segments, list) else []:
            if isinstance(segment, dict):
                by_segment[str(segment.get("id"))] = {
                    "source_section_path": section_path(segment.get("locator")),
                    "source_document_key": document_key(origin),
                    "source_document_label": origin.get("label", ""),
                }
    for note in notes:
        note.update(by_segment.get(str(note.get("source_segment_id")), {
            "source_section_path": [], "source_document_key": "", "source_document_label": "",
        }))
