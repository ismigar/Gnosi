"""Contract summaries without recursively splitting summaries into more calls."""
from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import groups
from backend.domains.llm_wiki.semantic_map_windows import MapOutputLimit

if TYPE_CHECKING:
    from backend.domains.llm_wiki.semantic_reading import SemanticReader


REDUCTION_VERSION = 1


def map_limit(budget: int) -> int:
    return max(350, min(2000, budget // 24))


def reduction_groups(summaries: list[str], count: Callable[[str], int], allowance: int) -> list[list[str]]:
    """Compact an oversized saved map alone; never split or cut its text."""
    batches: list[list[str]] = []
    pending: list[str] = []
    for summary in summaries:
        if count(encoded([summary])) > allowance:
            if pending:
                batches.extend(groups(pending, count, allowance))
                pending = []
            batches.append([summary])
        else:
            pending.append(summary)
    if pending:
        batches.extend(groups(pending, count, allowance))
    return batches


class MapSizeLimit(ValueError):
    """A complete draft can be compressed without sending the source again."""
    def __init__(self, text: str) -> None:
        self.text = text
        super().__init__("The argument-map synthesis must fit its requested estimated token limit")


def compact(engine: SemanticReader, key: str, material: list[Any]) -> str:
    """At most two calls; retain complete drafts and reject truncated ones."""
    from backend.domains.llm_wiki.contextual_reading import fingerprint
    contract = fingerprint([REDUCTION_VERSION, engine.deps.execution_revision,
                            engine.reader.title, engine.reader.language, material, map_limit(engine.reader.budget)])
    for job in [engine.reader.job_id, *engine.resume_map_jobs]:
        result = engine.deps.load_checkpoint(job, key + "-result")
        if (isinstance(result, dict) and result.get("identity") == contract and result.get("complete") is True
                and engine.deps.count_tokens(str(result.get("summary", ""))) <= map_limit(engine.reader.budget)
                and str(result.get("summary", "")).strip()):
            if result.get("model"):
                engine.reader.models.append(str(result["model"]))
            return str(result["summary"])
    draft_key = key + "-draft"
    cached = next((value for job in [engine.reader.job_id, *engine.resume_map_jobs]
                   if isinstance(value := engine.deps.load_checkpoint(job, draft_key), dict)
                   and value.get("identity") == contract and value.get("complete") is True), None)
    candidate = [str(cached["summary"])] if isinstance(cached, dict) else material
    for attempt in range(1 if isinstance(cached, dict) else 0, 2):
        try:
            summary = engine.summarize(key + f"-attempt-{attempt}", candidate, bounded=True,
                                       maximum=max(350, map_limit(engine.reader.budget) // 2) if attempt else None)
            if engine.reader.job_id:
                engine.deps.save_checkpoint(engine.reader.job_id, key + "-result",
                    {"identity": contract, "summary": summary, "complete": True, "model": engine.reader.models[-1]})
            return summary
        except MapSizeLimit as error:
            # Never cut a draft, lose attribution, or re-read the book merely
            # to shorten a navigation map. A second model call sees only this
            # complete draft and retains its caveats and attributed voices.
            candidate = [error.text]
            if engine.reader.job_id:
                engine.deps.save_checkpoint(engine.reader.job_id, draft_key,
                    {"identity": contract, "summary": error.text, "complete": True})
        except MapOutputLimit:
            # A clipped response is not evidence. Retry once from the complete
            # input maps, rather than recursively expanding the synthesis tree.
            candidate = material
    raise RuntimeError("reading_map_synthesis_incomplete: saved maps are retained")


def reduce_maps(engine: SemanticReader, key: str, summaries: list[str]) -> str:
    if not summaries:
        return "No proposed reading notes."
    limit = map_limit(engine.reader.budget)
    level = 0
    while len(summaries) > 1 or engine.deps.count_tokens(summaries[0]) > limit:
        # Reuse the source-window grouping allowance. Each output must be a
        # single bounded summary, even when an old complete map is oversized.
        batches = reduction_groups(summaries, engine.deps.count_tokens, engine.reader.budget // 3)
        before = engine.deps.count_tokens(encoded(summaries))
        following = [compact(engine, f"{key}-bounded-v{REDUCTION_VERSION}-{level}-{index}", batch)
                     for index, batch in enumerate(batches)]
        if (level >= 8 or (len(following) >= len(summaries)
                          and engine.deps.count_tokens(encoded(following)) >= before)):
            raise RuntimeError("Global argument-map reduction made no progress; saved maps are retained")
        summaries = following
        level += 1
    return summaries[0]
