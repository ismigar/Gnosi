"""Shared, replayable read-only action loop for complete source synthesis."""
from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, cast

import jsonschema  # type: ignore[import-untyped]

from backend.domains.llm_wiki.chunking import split_segment
from backend.services.agent_behavior import task_input, revision, snapshot_instruction_text
from backend.services.agent_execution_models import AgentOperation, AgentExecutionSnapshot
from backend.services.agent_operation_catalog import skill_id
from backend.services.agent_context_budget import count_tokens

ACTION_SCHEMA = {"type": "object", "required": ["action", "arguments"], "properties": {
    "action": {"enum": ["index", "read", "search", "remember", "finish"]},
    "arguments": {"type": "object"}}, "additionalProperties": False}


def synthesize(operation: str, sources: list[dict[str, Any]], request: str, *, snapshot: AgentExecutionSnapshot,
               output_schema: dict[str, Any], heartbeat: Callable[[], Any] | None = None,
               max_steps: int = 64) -> dict[str, Any]:
    from backend.services.agent_execution import run_sync
    from backend.services.agent_execution_trace import record
    from backend.domains.agent.runtime_tools import _model_context_window
    provider, model = str(snapshot.profile.get("provider") or ""), str(snapshot.profile.get("model") or "")
    def count(value: str) -> int:
        return count_tokens(value, model).tokens
    window = _model_context_window(provider, model)
    instructions = snapshot_instruction_text(snapshot)
    budget = window - max(2048, window // 4) - count(instructions) - 2048
    if budget < 2000:
        raise RuntimeError("agent_document_context_insufficient")
    parts: dict[str, dict[str, Any]] = {}
    for source in sources:
        identifier = str(source["id"])
        if not str(source.get("text") or "").strip():
            raise ValueError(f"agent_document_source_unreadable:{identifier}")
        for index, part in enumerate(split_segment({**source, "text": str(source.get("text") or "")}, budget // 3, count)):
            key = f"{identifier}:{index}"
            if key in parts:
                raise ValueError("agent_document_duplicate_source")
            parts[key] = {**part, "part_id": key, "source_id": identifier}
    if not parts:
        raise ValueError("agent_document_sources_empty")
    read: set[str] = set()
    memory = ""
    result: Any = {"parts": [{"part_id": key, "source_id": part["source_id"]} for key, part in list(parts.items())[:100]], "total": len(parts)}
    complete_delivery = {"delivery": "complete", "sources": list(parts.values())}
    initial_envelope = task_input(f"{operation}.analyze.actions", request=request, last_result=complete_delivery, result_schema=output_schema)
    if count(initial_envelope) + 1024 <= budget:
        result = complete_delivery
        read.update(parts)
    from backend.services.agent_execution_store import work_checkpoint
    checkpoint_key = "document:" + revision([operation, parts, request, snapshot.revision, output_schema])
    parent = snapshot.parent_run_id
    saved = work_checkpoint(snapshot.scope, parent, checkpoint_key) if parent else None
    start = 0
    if saved:
        if "completed" in saved:
            return cast(dict[str, Any], saved["completed"])
        read, memory, result, start = set(saved["read"]), saved["memory"], saved["result"], saved["step"]
    for step in range(start, start + max_steps):
        prompt = task_input(f"{operation}.analyze.actions", request=request, step=step, memory=memory,
                            last_result=result, total_parts=len(parts), read_parts=len(read),
                            result_schema=output_schema, available_actions={
                                "index": {"offset": "integer"}, "read": {"part_id": "string"},
                                "search": {"query": "string", "offset": "integer"}, "remember": {"text": "string"},
                                "finish": {"result": "result_schema", "citations": "list of source_id and exact quote", "reviewed": "boolean"}})
        response = run_sync(AgentOperation(skill_id=skill_id(operation), operation=f"{operation}.analyze.action",
                                          input=prompt, origin=snapshot.origin, output_schema=ACTION_SCHEMA,
                                          resume_requires_parent=True), snapshot=snapshot)
        answer = json.loads(response.result)
        args = answer["arguments"]
        record("document.action", {"operation": operation, "step": step, **answer})
        try:
            if answer["action"] == "index":
                offset = max(0, int(args.get("offset", 0)))
                result = {"parts": [{"part_id": key, "read": key in read} for key in list(parts)[offset:offset + 100]], "total": len(parts), "next_offset": offset + 100}
            elif answer["action"] == "read":
                key = str(args["part_id"])
                result = parts[key]
                read.add(key)
            elif answer["action"] == "search":
                query = str(args["query"]).casefold()
                if not query.strip():
                    raise ValueError("query_required")
                matches = [key for key, part in parts.items() if query in str(part["text"]).casefold()]
                offset = max(0, int(args.get("offset", 0)))
                result = {"part_ids": matches[offset:offset + 100], "total": len(matches), "next_offset": offset + 100}
            elif answer["action"] == "remember":
                replacement = str(args["text"])
                if count(replacement) > budget // 6:
                    raise ValueError("memory_budget_exceeded")
                memory, result = replacement, {"saved": True}
            elif answer["action"] == "finish":
                if read != set(parts):
                    raise ValueError("source_coverage_incomplete")
                final = args["result"]
                jsonschema.validate(final, output_schema)
                citations = args.get("citations")
                if not isinstance(citations, list) or not citations or args.get("reviewed") is not True:
                    raise ValueError("review_and_original_citations_required")
                for citation in citations:
                    if not isinstance(citation, dict) or not str(citation.get("quote") or "").strip() or not any(
                        citation.get("source_id") == part["source_id"] and str(citation["quote"]) in part["text"] for part in parts.values()
                    ):
                        raise ValueError("citation_not_in_original")
                completed = {"result": final, "citations": citations, "read_parts": sorted(read), "coverage_complete": True}
                if parent:
                    work_checkpoint(snapshot.scope, parent, checkpoint_key, {"completed": completed})
                record("document.result", completed)
                return completed
        except (KeyError, TypeError, ValueError, jsonschema.ValidationError) as error:
            result = {"error": str(error)}
        record("document.action.result", {"operation": operation, "step": step, "result": result})
        if heartbeat:
            heartbeat()
        if parent:
            work_checkpoint(snapshot.scope, parent, checkpoint_key, {"read": sorted(read), "memory": memory, "result": result, "step": step + 1})
    raise RuntimeError("agent_document_incomplete_resume_required")
