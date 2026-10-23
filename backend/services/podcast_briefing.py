"""Durable whole-day podcast coverage, independent of model conversation memory."""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, cast

import jsonschema

from backend.domains.llm_wiki.chunking import split_segment
from backend.services.agent_behavior import operation_input, resource, revision, snapshot_instruction_text, task_input
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def _brief_schema(parts: list[dict[str, Any]]) -> dict[str, Any]:
    entry = _object({"topic": {"type": "string", "minLength": 1, "maxLength": 100},
                     "summary": {"type": "string", "minLength": 1, "maxLength": 400},
                     "quote": {"type": "string", "minLength": 1, "maxLength": 160}})
    return _object({"briefs": _object({part["part_id"]: entry for part in parts})})


def _validate_briefs(result: dict[str, Any], parts: list[dict[str, Any]]) -> None:
    for part in parts:
        brief = result["briefs"][part["part_id"]]
        if not all(brief[key].strip() for key in ("topic", "summary", "quote")):
            raise ValueError("podcast_empty_source_brief")
        if brief["quote"] not in part["text"] and brief["quote"] not in str(part.get("title") or ""):
            raise ValueError(f"podcast_quote_not_in_original:{part['part_id']}")


def _section_schema(briefs: list[dict[str, Any]]) -> dict[str, Any]:
    return _object({"sections": {"type": "array", "minItems": 1, "items": _object({
        "topic": {"type": "string", "minLength": 1},
        "part_ids": {"type": "array", "minItems": 1, "items": {"type": "string", "enum": [b["part_id"] for b in briefs]}},
        "narration": {"type": "string", "minLength": 1},
    })}})


def _validate_sections(result: dict[str, Any], briefs: list[dict[str, Any]]) -> None:
    covered = [identifier for section in result["sections"] for identifier in section["part_ids"]]
    if len(covered) != len(set(covered)) or set(covered) != {b["part_id"] for b in briefs}:
        raise ValueError("podcast_day_coverage_incomplete_or_duplicate")
    if any(not section["narration"].strip() or not section["topic"].strip() for section in result["sections"]):
        raise ValueError("podcast_empty_spoken_section")


@dataclass
class _Briefing:
    snapshot: AgentExecutionSnapshot
    language: str
    budget: int
    count: Callable[[str], int]
    check_active: Callable[[], None]

    def request(self, task: str, data: dict[str, Any], schema: dict[str, Any]) -> AgentOperation:
        return AgentOperation(skill_id="core.gnosi-daily-briefing", operation=task,
            input=task_input(task, language=self.language, **data), origin=self.snapshot.origin,
            output_schema=schema, timeout_seconds=600 if task.endswith("narration") else 300,
            resume_requires_parent=True)

    def cost(self, request: AgentOperation) -> int:
        return self.count(operation_input(request)) + 1024

    def stage(self, request: AgentOperation, validate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        from backend.services.agent_execution import run_sync
        from backend.services.agent_execution_store import work_checkpoint
        self.check_active()
        if self.cost(request) > self.budget:
            raise RuntimeError("podcast_complete_briefing_context_insufficient")
        key = "podcast-coverage-v1:" + revision([self.snapshot.revision, request.model_dump()])
        parent = self.snapshot.parent_run_id
        schema = request.output_schema
        if schema is None:
            raise ValueError("podcast_result_schema_required")
        def checked(text: str) -> str:
            result = json.loads(text)
            jsonschema.validate(result, schema)
            validate(result)
            return text
        saved = work_checkpoint(self.snapshot.scope, parent, key) if parent else None
        if saved is not None:
            checked(json.dumps(saved["result"]))
            return cast(dict[str, Any], saved["result"])
        response = run_sync(request, snapshot=self.snapshot, output_validator=checked)
        checked(response.result)
        result: dict[str, Any] = json.loads(response.result)
        self.check_active()
        if parent:
            work_checkpoint(self.snapshot.scope, parent, key, {"result": result})
        return result

    def batches(self, parts: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        limit = min(40_000, self.budget // 2)
        batches: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        for part in parts:
            candidate = [*current, part]
            request = self.request("podcast.coverage.briefs", {"sources": candidate}, _brief_schema(candidate))
            if current and (len(candidate) > 8 or self.cost(request) > limit):
                batches.append(current)
                current = []
            current.append(part)
            if self.cost(self.request("podcast.coverage.briefs", {"sources": current}, _brief_schema(current))) > limit:
                raise RuntimeError("podcast_source_part_context_insufficient")
        if current:
            batches.append(current)
        return batches



def _parts(sources: list[dict[str, Any]], budget: int, count: Callable[[str], int]) -> list[dict[str, Any]]:
    result = []
    identifiers = [str(source["id"]) for source in sources]
    if not sources or len(identifiers) != len(set(identifiers)):
        raise ValueError("podcast_sources_empty_or_duplicate")
    for source in sources:
        if not str(source.get("text") or "").strip():
            raise ValueError("podcast_source_unreadable")
        for index, part in enumerate(split_segment(source, min(10_000, budget // 8), count)):
            result.append({**part, "source_id": str(source["id"]), "part_id": f"{source['id']}:{index}"})
    return result


def build_podcast_script(sources: list[dict[str, Any]], language: str, *, snapshot: AgentExecutionSnapshot,
                         check_active: Callable[[], None], progress: Callable[[str], None]) -> str:
    from backend.domains.agent.runtime_tools import _model_context_window
    from backend.services.agent_context_budget import count_tokens
    from backend.services.agent_execution_store import work_checkpoint
    model = str(snapshot.profile.get("model") or "")
    def count(text: str) -> int:
        return count_tokens(text, model).tokens
    window = _model_context_window(str(snapshot.profile.get("provider") or ""), model)
    budget = window - max(2048, window // 4) - count(snapshot_instruction_text(snapshot)) - 2048
    if budget < 8000:
        raise RuntimeError("podcast_complete_briefing_context_insufficient")
    context = _Briefing(snapshot, language, budget, count, check_active)
    parts = _parts(sources, budget, count)
    briefs: list[dict[str, Any]] = []
    for batch in context.batches(parts):
        progress(f"Preparing source briefs: {len(briefs)}/{len(parts)}")
        request = context.request("podcast.coverage.briefs", {"sources": batch}, _brief_schema(batch))
        result = context.stage(request, lambda value: _validate_briefs(value, batch))
        briefs.extend({"part_id": p["part_id"], "source_id": p["source_id"], "title": p.get("title", ""),
                       **result["briefs"][p["part_id"]]} for p in batch)
    from backend.services.podcast_outline import narrate_day
    sections, outline, word_budget = narrate_day(context, briefs, progress)
    _validate_sections({"sections": sections}, briefs)
    check_active()
    if snapshot.parent_run_id:
        work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-coverage-report", {
            "version": 4, "pipeline": "automatic-narration-v2", "narration_segments": len(sections), "outline": outline,
            "word_budget": word_budget, "spoken_words": sum(len(s["narration"].split()) for s in sections), "article_ids": sorted({p["source_id"] for p in parts}),
            "parts": len(parts), "briefs": briefs, "sections": sections,
        })
    return "\n\n".join(section["narration"].strip() for section in sections)
