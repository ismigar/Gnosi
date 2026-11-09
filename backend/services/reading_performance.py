"""Lossless shared-prefix caching for direct Sol source-reading operations."""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

MODEL = "gpt-6.1-sol"
CACHE_OPTIONS = {"mode": "explicit", "ttl": "30m"}
_SHARED = ("reading_engine", "resource", "language", "phase", "global_map",
           "all_notes_map", "dimensions", "properties", "source_document", "instruction")


def eligible(provider: str, model: str) -> bool:
    return provider == "openai" and model == MODEL


def validate_route(selection: Any, *, enabled: bool) -> None:
    if enabled and (not eligible(selection.provider_name, str(selection.model_name or ""))
                    or selection.fallback_metadata):
        raise RuntimeError("reading_performance_route_changed")


def _block(text: str, *, cached: bool = False) -> dict[str, Any]:
    return {"type": "text", "text": text,
            **({"prompt_cache_breakpoint": {"mode": "explicit"}} if cached else {})}


def _shared_input(content: str) -> list[dict[str, Any]] | None:
    try:
        outer = json.loads(content)
        if not isinstance(outer, dict) or outer.get("operation") != "knowledge.process-source.phase":
            return None
        inner = json.loads(outer["input"])
        if not isinstance(inner, dict):
            return None
    except (ValueError, KeyError, TypeError):
        return None
    shared = {key: inner[key] for key in _SHARED if key in inner}
    rest = {key: value for key, value in inner.items() if key not in shared}
    if not shared or not rest:
        return None
    def encode(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    # Split only the representation. Concatenating the two blocks gives one
    # complete operation envelope with exactly the same parsed values.
    common = encode(shared)[:-1] + ","
    suffix = encode(rest)[1:]
    prefix = '{"operation":' + encode(outer["operation"]) + ',"input":"' + encode(common)[1:-1]
    tail = encode(suffix)[1:-1] + '"'
    tail += "".join("," + encode(key) + ":" + encode(value) for key, value in outer.items()
                    if key not in {"operation", "input"}) + "}"
    return [_block(prefix, cached=True), _block(tail)]


def prepare(model: Any, messages: list[BaseMessage], *, enabled: bool = True) -> tuple[Any, list[BaseMessage]]:
    """Keep the selected model/effort/contract and never fall back from Flex."""
    if not enabled:
        return model, messages
    base = getattr(model, "bound", model)
    url = urlsplit(str(getattr(base, "openai_api_base", None) or "https://api.openai.com/v1"))
    extra = getattr(base, "extra_body", None) or getattr(model, "kwargs", {}).get("extra_body")
    if url.scheme != "https" or url.netloc != "api.openai.com" or url.path.rstrip("/") != "/v1" or extra:
        raise ValueError("Reading Flex requires the direct OpenAI endpoint without body overrides")
    prepared = []
    marked_input = False
    for message in messages:
        if isinstance(message, SystemMessage) and isinstance(message.content, str):
            message = message.model_copy(update={"content": [_block(message.content, cached=True)]})
        elif isinstance(message, HumanMessage) and not marked_input and isinstance(message.content, str):
            blocks = _shared_input(message.content)
            if blocks is not None:
                message = message.model_copy(update={"content": blocks})
                marked_input = True
        prepared.append(message)
    from backend.services.reading_cache_transport import preserve_format_prefix
    return preserve_format_prefix(model).bind(service_tier="flex", prompt_cache_options=dict(CACHE_OPTIONS)), prepared
