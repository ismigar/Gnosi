"""Durable whole-day podcast coverage, independent of model conversation memory."""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, cast

import jsonschema

from backend.domains.llm_wiki.chunking import split_segment
from backend.services.agent_behavior import operation_input, resource, revision, snapshot_instruction_text, task_input
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation
from backend.services.agent_output_repair import RepairBuilder
from backend.services.podcast_brief_repair import InvalidBriefQuotes, brief_quote_repair, invalid_quote_ids
from backend.services.podcast_policy import PodcastPreferences, preferences


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
    invalid = invalid_quote_ids(result, parts)
    if invalid:
        raise InvalidBriefQuotes(invalid)


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
    originals: dict[str, str] = field(default_factory=dict)
    editorial_policy: PodcastPreferences = field(init=False)

    def __post_init__(self) -> None:
        self.editorial_policy = preferences(self)

    def request(self, task: str, data: dict[str, Any], schema: dict[str, Any]) -> AgentOperation:
        return AgentOperation(skill_id="core.gnosi-daily-briefing", operation=task,
            input=task_input(task, language=self.language, **data), origin=self.snapshot.origin,
            output_schema=schema, timeout_seconds=600 if task.endswith("narration") else 300,
            resume_requires_parent=True)

    def cost(self, request: AgentOperation) -> int:
        return self.count(operation_input(request)) + 1024

    def _cache_key(self, request: AgentOperation) -> str:
        return "podcast-coverage-v1:" + revision([self.snapshot.revision, request.model_dump()])

    def has_saved(self, request: AgentOperation) -> bool:
        """Identify prior work without trusting it in place of stage validation."""
        from backend.services.agent_execution_store import work_checkpoint
        self.check_active()
        parent = self.snapshot.parent_run_id
        return bool(parent and work_checkpoint(self.snapshot.scope, parent, self._cache_key(request)) is not None)

    def audit_partition(self, request: AgentOperation, *, split: bool = False) -> bool:
        """Retain only the partition decision, bound to the exact frozen request."""
        from backend.services.agent_execution_store import work_checkpoint
        self.check_active()
        parent = self.snapshot.parent_run_id
        if not parent:
            return False
        key = 'podcast-audit-partition-v1:' + self._cache_key(request).removeprefix('podcast-coverage-v1:')
        saved = work_checkpoint(self.snapshot.scope, parent, key)
        if saved is not None and saved != {'split': True}:
            raise ValueError('podcast_invalid_audit_partition_state')
        if split and saved is None:
            self.check_active()
            work_checkpoint(self.snapshot.scope, parent, key, {'split': True})
        return split or saved is not None

    def stage(self, request: AgentOperation, validate: Callable[[dict[str, Any]], None],
              *, output_repair: RepairBuilder | None = None) -> dict[str, Any]:
        from backend.services.agent_execution import run_sync
        from backend.services.agent_execution_store import work_checkpoint
        self.check_active()
        if self.cost(request) > self.budget:
            raise RuntimeError("podcast_complete_briefing_context_insufficient")
        key = self._cache_key(request)
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
        if output_repair is None and request.operation == 'podcast.coverage.audit':
            from backend.services.podcast_audit_repair import audit_quote_repair
            output_repair = audit_quote_repair(json.loads(request.input)['data'], schema)
        if output_repair is None and request.operation == 'podcast.coverage.digest':
            from backend.services.podcast_feedback_repair import guidance_repair
            output_repair = guidance_repair(self, request, validate)
        response = run_sync(request, snapshot=self.snapshot, output_validator=checked, output_repair=output_repair)
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
    parts = _parts(sources, budget, count)
    context = _Briefing(snapshot, language, budget, count, check_active,
                        originals={part["part_id"]: part["text"] for part in parts})
    briefs: list[dict[str, Any]] = []
    for batch in context.batches(parts):
        progress(f"Preparing source briefs: {len(briefs)}/{len(parts)}")
        request = context.request("podcast.coverage.briefs", {"sources": batch}, _brief_schema(batch))
        result = context.stage(request, lambda value: _validate_briefs(value, batch),
                               output_repair=brief_quote_repair(batch, _brief_schema(batch)))
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
            "editorial_policy": context.editorial_policy.model_dump(),
        })
    return "\n\n".join(section["narration"].strip() for section in sections)
