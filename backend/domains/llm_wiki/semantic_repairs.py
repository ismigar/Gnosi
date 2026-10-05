"""One bounded repair of invalid passage interpretations; preserve valid work."""
from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from backend.domains.llm_wiki.chunking import encoded, record, records
from backend.domains.llm_wiki.semantic_contracts import obj, validate_schema
from backend.services.agent_output_repair import OutputRepair


def build_semantic_repair(prompt: str, text: str) -> OutputRepair | None:
    try:
        request, answer = json.loads(prompt), json.loads(text)
        if request.get("phase") != "interpret":
            return None
        primary, passages = request["primary_passages"], answer["passages"]
        if not isinstance(passages, list) or len(primary) != len(passages):
            return None
        schema = request["output_schema"]["properties"]["passages"]["items"]
        context = [*request.get("neighbours", []), *request.get("retrieved_originals", [])]
        bad = [i for i, passage in enumerate(passages) if not _valid(passage, schema, primary[i], context)]
        if not bad:
            return None
    except (ValueError, TypeError, KeyError):
        return None
    patch_schema = obj({"repairs": {"type": "array", "minItems": len(bad), "maxItems": len(bad),
        "items": obj({"passage": {"type": "integer", "enum": [i + 1 for i in bad]}, "value": schema})}})
    payload = {"reading_engine": "semantic", "phase": "repair_interpretation",
               "instruction": "Correct only the supplied passage interpretations. Preserve substantive ideas and caveats. Each note needs an exact quote from its own primary passage; other quotes must identify one supplied original. Return one repair for every listed passage. Valid passages are retained by Gnosi.",
               "global_map": request.get("global_map"), "properties": request.get("properties"),
               "context_originals": context,
               "passages": [{"passage": i + 1, "primary": primary[i], "interpretation": passages[i]} for i in bad],
               "output_schema": patch_schema}
    def restore(raw: str) -> str:
        patch = json.loads(raw)
        validate_schema(patch, patch_schema)
        repairs = records(patch["repairs"])
        if sorted(int(str(row["passage"])) - 1 for row in repairs) != bad:
            raise ValueError("Repair every invalid passage exactly once")
        result = deepcopy(answer)
        for row in repairs:
            result["passages"][int(str(row["passage"])) - 1] = row["value"]
        return json.dumps(result, ensure_ascii=False)
    return OutputRepair(encoded(payload), patch_schema, restore)


def _valid(passage: Any, schema: dict[str, Any], primary: dict[str, Any], context: list[dict[str, Any]]) -> bool:
    try:
        validate_schema(record(passage), schema)
    except ValueError:
        return False
    for note in records(passage.get("notes")):
        quotes = note["quotes"]
        if not isinstance(quotes, list) or not any(q in primary["text"] for q in quotes):
            return False
        for quote in quotes:
            if quote not in primary["text"] and len({encoded(s) for s in context if quote in s["text"]}) != 1:
                return False
    return True
