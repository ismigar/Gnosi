"""Durable JSON actions over immutable source passages and validated draft notes."""
from __future__ import annotations

from typing import Any

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.reading_contracts import validate_notes
from backend.domains.llm_wiki.contextual_reading import fingerprint

ACTION_SCHEMA = {
    "type": "object", "required": ["action", "arguments"],
    "properties": {"action": {"enum": ["index", "read", "search", "remember", "save_plan", "recall", "finish"]},
                   "arguments": {"type": "object"}}, "additionalProperties": False,
}


def run_directed(reader: Any) -> tuple[dict[str, object], list[str]]:
    from backend.services.agent_execution_trace import record
    deps = reader.dependencies
    chunks = {str(chunk["id"]): chunk for chunk in reader.chunks}
    identity = fingerprint([deps.execution_revision, reader.chunks, reader.dimensions, reader.brain_index])
    saved = deps.load_checkpoint(reader.resume_job_id, "agent-state") if reader.resume_job_id else None
    state: dict[str, Any] = saved if isinstance(saved, dict) and saved.get("identity") == identity else {
        "identity": identity, "step": 0, "read": [], "plans": {}, "memory": "", "last_result": {},
    }
    if not chunks:
        raise RuntimeError("No readable source segments were extracted")
    complete = list(chunks.values())
    if state["step"] == 0 and deps.count_tokens(encoded([complete, reader.dimensions, reader.title, reader.language, ACTION_SCHEMA])) + 2048 <= reader.budget:
        state["read"] = list(chunks)
        state["last_result"] = {"sources": complete, "delivery": "complete"}

    def checkpoint() -> None:
        if reader.job_id:
            deps.save_checkpoint(reader.job_id, "agent-state", state)
            deps.update_job(reader.job_id, chunks_done=len(state["plans"]), phase="planning")

    def checked(answer: dict[str, object]) -> None:
        import jsonschema  # type: ignore[import-untyped]
        jsonschema.validate(answer, ACTION_SCHEMA)

    # A per-resume execution allowance, not a prescribed intellectual sequence.
    for _ in range(deps.max_action_steps):
        request = {
            "task": "knowledge.process-source.actions", "resource": reader.title,
            "language": reader.language, "output_schema": ACTION_SCHEMA,
            "source_count": len(chunks), "read_count": len(state["read"]),
            "saved_plan_count": len(state["plans"]), "memory": state["memory"],
            "last_result": state["last_result"], "dimensions": reader.dimensions,
            "available_actions": {
                "index": {"offset": "integer", "limit": "integer, maximum 100"},
                "read": {"chunk_id": "string"}, "search": {"query": "string", "offset": "integer"},
                "remember": {"text": "string"},
                "save_plan": {"chunk_id": "string", "plan": "notes, coverage, warnings, reviewed"},
                "recall": {"chunk_id": "string"}, "finish": {"summary": "string"},
            },
        }
        if state["step"] == 0:
            request["index"] = [{"id": key, "label": chunk.get("origin_label"), "section": chunk.get("section")} for key, chunk in list(chunks.items())[:100]]
        answer = reader.ask(f"action-{state['step']}", "agent-actions", request, checked, contract=ACTION_SCHEMA)
        action, args = str(answer["action"]), answer["arguments"]
        record("reading.action", {"step": state["step"], **answer})
        result: Any = {}
        try:
            if action == "index":
                offset = max(0, int(args.get("offset", 0)))
                limit = max(1, min(100, int(args.get("limit", 100))))
                keys = list(chunks)[offset:offset + limit]
                result = {"chunks": [{"id": key, "read": key in state["read"], "saved": key in state["plans"]} for key in keys], "next_offset": offset + len(keys), "total": len(chunks)}
            elif action == "read":
                key = str(args["chunk_id"])
                result = chunks[key]
                if key not in state["read"]:
                    state["read"].append(key)
            elif action == "search":
                query = str(args["query"]).casefold()
                if not query.strip():
                    raise ValueError("query_required")
                found = [key for key, chunk in chunks.items() if any(query in str(segment.get("text", "")).casefold() for segment in records(chunk.get("segments")))]
                offset = max(0, int(args.get("offset", 0)))
                result = {"chunk_ids": found[offset:offset + 100], "total": len(found), "next_offset": offset + min(100, len(found[offset:]))}
            elif action == "remember":
                memory = str(args["text"])
                if deps.count_tokens(memory) > reader.budget // 8:
                    raise ValueError("memory_budget_exceeded")
                state["memory"] = memory
                result = {"saved": True}
            elif action == "recall":
                result = state["plans"][str(args["chunk_id"]) ]
            elif action == "save_plan":
                key = str(args["chunk_id"])
                if key not in state["read"]:
                    raise ValueError("read_original_before_saving")
                plan = args["plan"]
                if not isinstance(plan, dict) or "requests" in plan:
                    raise ValueError("plan_required")
                evidence = [segment for chunk_id in state["read"] for segment in records(chunks[chunk_id].get("segments"))]
                validate_notes(plan, records(chunks[key].get("segments")), evidence)
                if deps.count_tokens(encoded(plan)) > reader.budget // 3:
                    raise ValueError("plan_budget_exceeded")
                state["plans"][key] = plan
                result = {"saved": key, "remaining": len(chunks) - len(state["plans"])}
            elif action == "finish":
                if set(state["plans"]) != set(chunks) or set(state["read"]) != set(chunks):
                    raise ValueError("source_coverage_incomplete")
                evidence = [segment for key in state["read"] for segment in records(chunks[key].get("segments"))]
                plans = [({**chunks[key], "evidence_segments": evidence}, plan) for key, plan in state["plans"].items()]
                notes, warnings = deps.reduce_plans(plans, reader.origins, reader.dimensions)
                checkpoint()
                record("reading.complete", {"source_count": len(chunks), "read": state["read"], "note_count": len(notes), "warnings": warnings})
                return {"summary": str(args.get("summary", "")), "notes": notes, "warnings": [*reader.warnings, *warnings],
                        "coverage": [{**row, "chunk_id": key} for key, plan in state["plans"].items() for row in records(plan.get("coverage"))],
                        "reviewed": all(plan.get("reviewed") is True for plan in state["plans"].values())}, reader.models
        except (KeyError, ValueError, TypeError) as error:
            result = {"error": str(error)}
        record("reading.action.result", {"step": state["step"], "result": result})
        if deps.count_tokens(encoded(result)) > reader.budget // 2:
            raise RuntimeError("agent_action_result_context_exceeded")
        state["last_result"] = result
        state["step"] += 1
        checkpoint()
    raise RuntimeError("agent_reading_incomplete_resume_required")
