"""Keep variable reading schemas after the reusable native Responses prefix."""
from __future__ import annotations

import json
from typing import Any


def _without_repeated_contract(item: Any, output: dict[str, Any]) -> Any:
    """Keep one identical schema on the wire and every other envelope value."""
    if not isinstance(item, dict) or item.get("role") != "user":
        return item
    content = item.get("content")
    if not isinstance(content, list) or not all(
        isinstance(block, dict) and block.get("type") == "input_text"
        and set(block) <= {"type", "text", "prompt_cache_breakpoint"} for block in content
    ):
        return item
    try:
        envelope = json.loads("".join(block["text"] for block in content))
    except (ValueError, KeyError, TypeError):
        return item
    if (not isinstance(envelope, dict) or envelope.get("operation") != "knowledge.process-source.phase"
            or envelope.get("output_schema") != output.get("schema")):
        return item
    from backend.services.reading_performance import _shared_input
    reduced = {key: value for key, value in envelope.items() if key != "output_schema"}
    blocks = _shared_input(json.dumps(reduced, ensure_ascii=False))
    return {**item, "content": [{**block, "type": "input_text"} for block in blocks]} if blocks else item


def format_after_prefix(parameters: dict[str, Any]) -> dict[str, Any]:
    """Move, never relax, the exact strict schema using a native format update."""
    text = parameters.get("text")
    output = text.get("format") if isinstance(text, dict) else None
    items = parameters.get("input")
    if (not isinstance(text, dict)
            or parameters.get("model") != "gpt-6.1-sol" or parameters.get("service_tier") != "flex"
            or not isinstance(output, dict) or output.get("type") != "json_schema"
            or output.get("strict") is not True or not isinstance(items, list)):
        return parameters
    boundary = 0
    for item in items:
        if not isinstance(item, dict) or item.get("role") not in {"system", "developer"}:
            break
        boundary += 1
    if not boundary:
        return parameters
    return {**parameters, "text": {**text, "format": {"type": "text"}},
            "input": [*items[:boundary], {"type": "configuration_update", "text": {"format": output}},
                      *[_without_repeated_contract(item, output) for item in items[boundary:]]]}


class _Responses:
    def __init__(self, resource: Any) -> None:
        self.resource = resource

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self.resource, name)
        if name in {"with_raw_response", "with_streaming_response"}:
            return _Responses(attribute)
        if name not in {"create", "parse", "stream"} or not callable(attribute):
            return attribute

        def call(*args: Any, **kwargs: Any) -> Any:
            return attribute(*args, **format_after_prefix(kwargs))
        return call


class _Client:
    def __init__(self, client: Any) -> None:
        self.client = client
        self.responses = _Responses(client.responses)

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self.client, name)
        return _Client(attribute) if name in {"with_raw_response", "with_streaming_response"} else attribute


def preserve_format_prefix(model: Any) -> Any:
    """Copy only this reading model; never mutate shared SDK clients or settings."""
    base = getattr(model, "bound", model)
    if not callable(getattr(base, "model_copy", None)):
        return model
    updates = {name: _Client(client) for name in ("root_client", "root_async_client")
               if (client := getattr(base, name, None)) is not None and not isinstance(client, _Client)}
    if not updates:
        return model
    copied = base.model_copy(update=updates)
    return copied if model is base else model.model_copy(update={"bound": copied})
