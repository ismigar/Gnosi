"""Tests for offline operator publication of saved semantic reading checkpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.domains.llm_wiki import ingestion as llm_wiki_ingestion
from backend.domains.llm_wiki.chunking import reading_chunk_budget, reading_chunks
from backend.domains.llm_wiki.origins import finalize_origin
from backend.domains.llm_wiki.reading_quality import REVIEW_QUALITY_VERSION
from backend.services import llm_wiki_publish_saved, reading_estimate


@pytest.mark.parametrize(
    ("semantic", "remaining", "saved", "expected"),
    [
        (
            True,
            [],
            {
                "global_map": "Global overview.",
                "notes_map": "Notes overview.",
                "reviewed_groups": {"g1": {"warnings": []}},
                "pending_review_groups": {},
                "review_drafts": {},
                "pending_audits": {"p1": {"reason": "Check nuance"}},
            },
            True,
        ),
        (False, [], {"global_map": "a", "notes_map": "b", "reviewed_groups": {"g1": {}}, "pending_audits": {"p1": {}}}, False),
        (True, [{"id": "c1"}], {"global_map": "a", "notes_map": "b", "reviewed_groups": {"g1": {}}, "pending_audits": {"p1": {}}}, False),
        (True, [], {"global_map": "a", "notes_map": "b", "reviewed_groups": {"g1": {}}, "pending_review_groups": {"g2": {}}, "pending_audits": {"p1": {}}}, False),
        (True, [], {"global_map": "a", "notes_map": "b", "reviewed_groups": {"g1": {}}, "review_drafts": {"g1": {}}, "pending_audits": {"p1": {}}}, False),
        (True, [], {"global_map": "a", "notes_map": "b", "reviewed_groups": {"g1": {}}, "pending_audits": {}}, False),
    ],
)
def test_can_publish_saved_requires_completed_joint_review_and_pending_audits(
    semantic: bool,
    remaining: list[dict[str, object]],
    saved: dict[str, object],
    expected: bool,
) -> None:
    assert reading_estimate._can_publish_saved(semantic, remaining, saved) is expected


def test_resolve_plan_accepts_operator_published_checkpoint_without_rereading() -> None:
    origin = finalize_origin(
        {
            "kind": "text",
            "label": "Ethics",
            "input_order": 0,
            "segments": [{"text": "Moral autonomy requires universalizable maxims.", "locator": {"page": 1}}],
        }
    )
    chunks = reading_chunks([origin], budget=reading_chunk_budget(32000), count=len)
    deps = SimpleNamespace(
        semantic_reading=True,
        phases=SimpleNamespace(writing="writing"),
        update_job=Mock(),
    )
    sources = llm_wiki_ingestion._PreparedSources([origin], [], [], chunks)
    saved_plan: dict[str, object] = {
        "summary": "Overview",
        "notes": [],
        "warnings": ["Published from saved review"],
        "reviewed": False,
        "operator_published": True,
        "quality_review_version": REVIEW_QUALITY_VERSION,
        "coverage": [],
    }
    checkpoint: dict[str, object] = {
        "plan": saved_plan,
        "reading_revision": "rev-1",
        "origin_hashes": [origin["content_hash"]],
        "model": "gpt-5.6-luna",
    }
    plan, models = llm_wiki_ingestion._resolve_plan(
        "Ethics",
        "ca",
        sources,
        [],
        [],
        "rev-1",
        checkpoint,
        "job-1",
        "job-2",
        deps,  # type: ignore[arg-type]
    )
    assert plan is saved_plan
    assert models == ["gpt-5.6-luna"]
    deps.update_job.assert_called_once()


def test_build_offline_plan_applies_saved_audits_and_never_calls_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    origin = finalize_origin(
        {
            "kind": "text",
            "label": "Ethics",
            "input_order": 0,
            "segments": [{"text": "Moral autonomy requires universalizable maxims.", "locator": {"page": 1}}],
        }
    )
    chunks = reading_chunks([origin], budget=reading_chunk_budget(32000), count=len)
    segment = chunks[0]["segments"][0]
    chunk_id = str(chunks[0]["id"])
    seg_id = str(segment["id"])

    note = {
        "action": "create",
        "existing_id": "",
        "title": "Moral autonomy and universalizable maxims",
        "summary": "Autonomy grounds moral obligation in universalizable maxims.",
        "body": "Kant argues that moral autonomy requires acting only on universalizable maxims.",
        "relations": [],
        "dimensions": {},
        "source_segment_id": seg_id,
        "citations": [
            {
                "segment_id": seg_id,
                "quote": "Moral autonomy requires universalizable maxims.",
            }
        ],
    }
    chunk_plan = {
        "notes": [note],
        "warnings": [],
        "coverage": [{"segment_id": seg_id, "status": "covered", "reason": "Captured core argument."}],
        "evidence_segments": [segment],
    }

    fake_state: dict[str, object] = {
        "plans": {chunk_id: chunk_plan},
        "global_map": "Global map of Ethics.",
        "notes_map": "Notes map of Ethics.",
        "reviewed_groups": {"batch-1": {"warnings": []}},
        "pending_review_groups": {},
        "review_drafts": {},
        "independent_reviews": {},
        "pending_audits": {"p-1": {"reason": "Check phrasing"}, "p-2": {"reason": "Check nuance"}},
        "review_quality_version": REVIEW_QUALITY_VERSION,
    }

    class FakeContextualReader:
        def __init__(self, deps: object, *args: object) -> None:
            self.deps = deps
            self.chunks = chunks
            self.origins = [origin]
            self.dimensions: list[dict[str, object]] = []
            self.language = "en"
            self.warnings: list[str] = []

    class FakeSemanticReader:
        def __init__(self, creader: FakeContextualReader) -> None:
            self.reader = creader
            self.deps = creader.deps
            self.state = fake_state

    monkeypatch.setattr(llm_wiki_publish_saved, "ContextualReader", FakeContextualReader)
    monkeypatch.setattr(llm_wiki_publish_saved, "SemanticReader", FakeSemanticReader)
    monkeypatch.setattr(
        llm_wiki_publish_saved,
        "review_plans",
        lambda _sr, _gm, _nm, *, checkpoints_only: [(chunks[0], chunk_plan)] if checkpoints_only else [],
    )

    plan = llm_wiki_publish_saved._build_offline_plan(
        origins=[origin],
        chunks=chunks,
        source_title="Ethics",
        language="en",
        brain_index=[],
        ai_dimensions=[],
        resume_job_id="job-prev",
        execution_revision="exec-rev",
        input_budget=32000,
        count_tokens=len,
        reviewer=None,
        legacy_reader_revision=None,
    )

    assert plan["operator_published"] is True
    assert plan["reviewed"] is False
    assert plan["summary"] == "Global map of Ethics."
    notes = plan["notes"]
    assert isinstance(notes, list) and len(notes) == 1
    warnings = plan["warnings"]
    assert isinstance(warnings, list)
    assert any("2 pending independent-audit passage(s) skipped by operator" in str(w) for w in warnings)
