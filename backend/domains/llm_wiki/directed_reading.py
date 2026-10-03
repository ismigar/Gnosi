"""Durable JSON actions over immutable source passages and validated draft notes."""
from __future__ import annotations

from typing import Any, cast

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.reading_contracts import validate_notes
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.reading_action_contracts import ACTION_SCHEMA as ACTION_SCHEMA, action_schemas


def _chunk_status(state: dict[str, Any], key: str) -> dict[str, object]:
    plan = state["plans"].get(key, {})
    return {"read": key in state["read"], "saved": key in state["plans"],
            "reviewed": plan.get("reviewed") is True, "note_count": len(records(plan.get("notes")))}


def run_directed(reader: Any) -> tuple[dict[str, object], list[str]]:
    from backend.services.agent_execution_trace import record
    deps = reader.dependencies
    output_schema, _ = action_schemas(reader.dimensions)
    chunks = {str(chunk["id"]): chunk for chunk in reader.chunks}
    identity = fingerprint([deps.execution_revision, reader.chunks, reader.dimensions, reader.brain_index])
    saved = deps.load_checkpoint(reader.resume_job_id, "agent-state") if reader.resume_job_id else None
    state: dict[str, Any] = saved if isinstance(saved, dict) and saved.get("identity") == identity else {
        "identity": identity, "step": 0, "read": [], "plans": {}, "memory": "", "last_result": {},
    }
    if not chunks:
        raise RuntimeError("No readable source segments were extracted")
    complete = list(chunks.values())
    if state["step"] == 0 and deps.count_tokens(encoded([complete, reader.dimensions, reader.title, reader.language, output_schema])) + 2048 <= reader.budget:
        state["read"] = list(chunks)
        state["last_result"] = {"sources": complete, "delivery": "complete"}

    def checkpoint() -> None:
        if reader.job_id:
            deps.save_checkpoint(reader.job_id, "agent-state", state)
            deps.update_job(reader.job_id, chunks_done=len(state["plans"]), phase="planning")

    def checked(answer: dict[str, object]) -> None:
        validate_action(reader, state, chunks, answer)

    # Carry resumed plans into the new job before a provider call can fail.
    checkpoint()

    # A per-resume execution allowance, not a prescribed intellectual sequence.
    # Reading, saving and reviewing remain finite, but the allowance must
    # grow with the number of bounded source chunks rather than stop a long
    # book after the fixed short-document allowance.
    action_steps = deps.max_action_steps
    if action_steps == 64:
        action_steps = max(action_steps, 4 * len(chunks) + 16)
    for _ in range(action_steps):
        request = {
            "task": "knowledge.process-source.actions", "resource": reader.title,
            "step": state["step"],
            "language": reader.language, "output_schema": output_schema,
            "source_count": len(chunks), "read_count": len(state["read"]),
            "saved_plan_count": len(state["plans"]), "memory": state["memory"],
            "memory_step": state.get("memory_step"), "last_action": state.get("last_action"),
            "state_contract": (
                "The index and counts report the current persisted state, after evidence and coverage validation. "
                "reviewed is the saved reader-declared review flag, not a guarantee of correct interpretation. "
                "These current progress facts supersede conflicting progress claims in model-authored memory, "
                "which may describe an earlier step. last_action identifies the operation that produced last_result."
            ),
            "last_result": state["last_result"], "dimensions": reader.dimensions,
            "available_actions": {
                "index": {"offset": "integer", "limit": "integer, maximum 100"},
                "read": {"chunk_id": "string"}, "search": {"query": "string", "offset": "integer"},
                "remember": {"text": "string"},
                "save_plan": {"chunk_id": "string", "plan": "notes, coverage, warnings, reviewed"},
                "recall": {"chunk_id": "string"}, "finish": {"summary": "string"},
            },
        }
        request["index"] = [{"id": key, "label": chunk.get("origin_label"), "section": chunk.get("section"),
                             **_chunk_status(state, key),
                             "primary_segment_count": len(records(chunk.get("segments")))} for key, chunk in list(chunks.items())[:100]]
        answer = reader.ask(f"action-{state['step']}", "agent-actions", request, checked, contract=output_schema)
        action, args = str(answer["action"]), answer["arguments"]
        record("reading.action", {"step": state["step"], **answer})
        result: Any = {}
        try:
            if action != "finish":
                result = _apply_action(reader, state, chunks, action, args)
            else:
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
        state["last_action"] = {"name": action, "chunk_id": args.get("chunk_id"), "step": state["step"]}
        state["step"] += 1
        checkpoint()
    raise RuntimeError("agent_reading_incomplete_resume_required")


def validate_action(reader: Any, state: dict[str, Any], chunks: dict[str, Any], answer: dict[str, object]) -> None:
    import jsonschema
    output_schema, argument_schemas = action_schemas(reader.dimensions)
    try:
        jsonschema.validate(answer, output_schema)
        jsonschema.validate(answer["arguments"], argument_schemas[str(answer["action"])])
    except jsonschema.ValidationError as error:
        raise ValueError(error.message) from error
    action, args = str(answer["action"]), cast(dict[str, Any], answer["arguments"])
    if action in {"read", "recall", "save_plan"} and args["chunk_id"] not in chunks:
        raise ValueError("unknown_chunk_id: use an exact chunk id from the supplied index")
    if action == "recall" and args["chunk_id"] not in state["plans"]:
        raise ValueError("plan_not_saved: read the original chunk before drafting a plan")
    if action == "finish":
        if set(state["plans"]) != set(chunks) or set(state["read"]) != set(chunks):
            raise ValueError("source_coverage_incomplete")
    else:
        # Keep invalid answers out of checkpoints and retain original evidence
        # in the executor's bounded repair conversation. Preview changes only.
        preview = {**state, "read": list(state["read"]), "plans": dict(state["plans"])}
        _apply_action(reader, preview, chunks, action, args)


def _apply_action(reader: Any, state: dict[str, Any], chunks: dict[str, Any], action: str, args: dict[str, Any]) -> Any:
    deps = reader.dependencies
    result: Any = {}
    if action == "index":
        offset = max(0, int(args.get("offset", 0)))
        limit = max(1, min(100, int(args.get("limit", 100))))
        keys = list(chunks)[offset:offset + limit]
        result = {"chunks": [{"id": key, **_chunk_status(state, key)} for key in keys], "next_offset": offset + len(keys), "total": len(chunks)}
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
        state["memory_step"] = state["step"]
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
    return result
