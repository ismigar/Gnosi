"""Constrain primary evidence before generation without duplicating field schemas."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any


def source_key(source: dict[str, Any]) -> str:
    """Bind a local choice to its complete supplied source view, not its text alone."""
    view = {"text": source["text"], "location": source.get("location", {}), "document": source.get("document", "")}
    return hashlib.sha256(json.dumps(view, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def shared_note_schema(original: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    note = deepcopy(original)
    definitions = {"reading_note_properties": note["properties"]["properties"]}
    note["properties"]["properties"] = {"$ref": "#/$defs/reading_note_properties"}
    return note, definitions


def primary_note_schema(note: dict[str, Any], primary_ids: list[int], quote_count: int) -> dict[str, Any]:
    result = deepcopy(note)
    result["properties"].pop("quotes")
    # Provenance is attached by the application after validating selected IDs.
    result["properties"].pop("quote_source_keys", None)
    result["properties"]["primary_quote_ids"] = {"type": "array", "minItems": 1,
        "items": {"type": "integer", "enum": primary_ids}}
    result["properties"]["context_quote_ids"] = {"type": "array",
        "items": {"type": "integer", "minimum": 1, "maximum": quote_count}}
    result["required"] = [key for field in result["required"]
                          for key in (["primary_quote_ids", "context_quote_ids"] if field == "quotes" else [field])]
    return result


def restore_note(note: dict[str, Any], quotes: dict[int, str], quote_sources: dict[int, str] | None = None) -> dict[str, Any]:
    value = deepcopy(note)
    identifiers = [*value.pop("primary_quote_ids"), *value.pop("context_quote_ids")]
    value["quotes"] = [quotes[number] for number in identifiers]
    if quote_sources:
        value["quote_source_keys"] = [quote_sources[number] for number in identifiers]
    return value


def select_note(note: dict[str, Any], quotes: dict[int, str], primary_ids: list[int],
                quote_sources: dict[int, str] | None = None) -> dict[str, Any]:
    """Invert validated literal choices; never guess, insert or substitute evidence."""
    value = deepcopy(note)
    primary = {quotes[number]: number for number in primary_ids}
    context = {text: number for number, text in quotes.items()}
    sources = value.pop("quote_source_keys", None)
    value["primary_quote_ids"], value["context_quote_ids"] = [], []
    literals = value.pop("quotes")
    if sources is not None and (not quote_sources or len(sources) != len(literals)):
        raise ValueError("Each selected quote must retain its supplied source")
    for index, quote in enumerate(literals):
        if sources is not None and quote_sources:
            candidates = [number for number, text in quotes.items()
                          if text == quote and quote_sources[number] == sources[index]]
            if not candidates:
                raise ValueError("Selected quote source is absent from the operation's evidence")
            primary_candidates = [number for number in candidates if number in primary_ids]
            key = "primary_quote_ids" if primary_candidates else "context_quote_ids"
            value[key].append((primary_candidates or candidates)[0])
            continue
        key, choices = ("primary_quote_ids", primary) if quote in primary else ("context_quote_ids", context)
        value[key].append(choices[quote])
    return value
