"""Source-wide understanding, evidence boundaries and durable skill execution."""

from __future__ import annotations

import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.domains.llm_wiki.chunking import encoded, reading_chunks
from backend.domains.llm_wiki.contextual_reading import ContextualReader
from backend.domains.llm_wiki.origins import finalize_origin
from backend.services.llm_wiki_reading_runtime import token_bound


def source():
    return finalize_origin(
        {
            "kind": "text",
            "label": "Argument",
            "input_order": 0,
            "segments": [
                {
                    "text": "The opponent claims all knowledge is innate.",
                    "locator": {"section": "Opening"},
                },
                {
                    "text": "I reject that claim: experience is necessary.",
                    "locator": {"section": "Conclusion"},
                },
            ],
        }
    )


def note_answer(request):
    segments = request["primary_segments"]
    return {
        "summary": "A qualified reading",
        "notes": [
            {
                "title": segment["text"],
                "body_md": segment["text"],
                "type": "concepte",
                "source_segment_id": segment["id"],
                "dimensions": {},
                "citations": [{"segment_id": segment["id"], "quote": segment["text"]}],
            }
            for segment in segments
        ],
        "coverage": [{"segment_id": segment["id"], "reason": "extracted"} for segment in segments],
        "warnings": [],
    }


def setup_reader(*, revision="v1", resume="", checkpoints=None, generate=None):
    origin = source()
    chunks = reading_chunks([origin], budget=1500, count=token_bound)
    calls = []
    checkpoints = checkpoints if checkpoints is not None else {}

    def default_generate(prompt, **kwargs):
        request = json.loads(prompt)
        calls.append(request)
        answer = (
            generate(request)
            if generate
            else {"summary": "The opponent's claim is refuted in the Conclusion."}
            if request["phase"] in {"overview", "synthesis"}
            else note_answer(request)
        )
        return json.dumps(answer), "test-model"

    deps = SimpleNamespace(
        input_budget=24000,
        count_tokens=token_bound,
        execution_revision=revision,
        generate_text=default_generate,
        update_job=Mock(),
        save_checkpoint=lambda job, key, value: checkpoints.__setitem__(
            (job, key), deepcopy(value)
        ),
        load_checkpoint=lambda job, key: checkpoints.get((job, key)),
        reduce_plans=lambda plans, *_: ([note for _, p in plans for note in p["notes"]], []),
    )
    reader = ContextualReader(deps, chunks, [origin], "Book", "Catalan", [], [], "current", resume)
    return reader, calls, checkpoints


def test_all_fragments_receive_global_map_and_all_notes_are_reviewed():
    reader, calls, _ = setup_reader()
    result, _ = reader.run()
    phases = [call["phase"] for call in calls]
    assert phases.index("extract") > max(i for i, p in enumerate(phases) if p == "overview")
    assert phases.count("review") == len(reader.chunks)
    for call in calls:
        if call["phase"] in {"extract", "review"}:
            assert "refuted" in call["global_map"]
            assert call["context_only_segments"]
        if call["phase"] == "review":
            assert call["all_notes_map"] and call["proposed_notes"]
    assert result["reviewed"] is True
    assert len(result["coverage"]) == 2


def test_distant_original_can_be_requested_and_cited_without_extracting_it_twice():
    reader, _, _ = setup_reader()
    first, last = reader.chunks[0]["segments"][0], reader.chunks[-1]["segments"][0]
    reader.chunks[0]["context_segments"] = []

    def generate(request):
        if request["phase"] in {"overview", "synthesis"}:
            return {"summary": "The initial claim is later refuted."}
        if request["phase"] == "extract" and request["primary_segments"][0]["id"] == first["id"]:
            if "retrieved_original_segments" not in request:
                return {"requests": {"segment_ids": [last["id"]], "queries": []}}
            assert last["id"] in [s["id"] for s in request["retrieved_original_segments"]]
            answer = note_answer(request)
            answer["notes"][0]["citations"].append(
                {"segment_id": last["id"], "quote": last["text"]}
            )
            return answer
        return note_answer(request)

    reader, calls, _ = setup_reader(generate=generate)
    reader.chunks[0]["context_segments"] = []
    result, _ = reader.run()
    assert len(result["notes"]) == 2
    assert any("retrieved_original_segments" in call for call in calls)


@pytest.mark.parametrize("bad", ["coverage", "citation", "primary"])
def test_invalid_evidence_or_missing_coverage_never_reaches_reduction(bad):
    def generate(request):
        if request["phase"] in {"overview", "synthesis"}:
            return {"summary": "Map"}
        answer = note_answer(request)
        if bad == "coverage":
            answer["coverage"] = []
        elif bad == "citation":
            answer["notes"][0]["citations"][0]["quote"] = "invented quote"
        else:
            answer["notes"][0]["source_segment_id"] = "another source"
        return answer

    reader, _, _ = setup_reader(generate=generate)
    reader.dependencies.reduce_plans = Mock()
    with pytest.raises(RuntimeError, match="invalid extract result"):
        reader.run()
    reader.dependencies.reduce_plans.assert_not_called()


def test_checkpoints_reuse_complete_phases_and_invalidate_changed_skill():
    reader, calls, checkpoints = setup_reader()
    reader.run()
    assert calls
    resumed, calls, _ = setup_reader(resume="current", checkpoints=checkpoints)
    resumed.run()
    assert calls == []
    changed, calls, _ = setup_reader(revision="v2", resume="current", checkpoints=checkpoints)
    changed.run()
    assert calls


def test_sentence_boundaries_coverage_structure_and_unicode_budget():
    text = "Una frase amb accents: experiència. " * 90
    origin = finalize_origin(
        {
            "kind": "text",
            "label": "Book",
            "segments": [
                {"text": text, "locator": {"section": "One"}},
                {"text": "Final conclusion.", "locator": {"section": "Two"}},
            ],
        }
    )
    chunks = reading_chunks([origin], budget=900, count=token_bound)
    all_primary = [s for chunk in chunks for s in chunk["segments"]]
    assert "".join(s["text"] for s in all_primary) == "".join(s["text"] for s in origin["segments"])
    assert all(token_bound(encoded(chunk["segments"])) < 900 for chunk in chunks)
    assert chunks[-1]["section"] == "Two"
    assert all(s["text"].endswith(". ") for s in all_primary[:-2])
    assert all(s["id"] == origin["segments"][0]["id"] for s in all_primary[:-1])
    assert chunks[1]["context_segments"]


def test_changed_global_map_invalidates_extraction_checkpoints():
    reader, _, checkpoints = setup_reader()
    reader.run()
    resumed, calls, _ = setup_reader(resume="current", checkpoints=checkpoints)
    # A different source-wide interpretation must never reuse the old extraction.
    resumed.notes(0, "extract", "Corrected global context", section_map="Opening")
    assert calls and calls[0]["global_map"] == "Corrected global context"


def test_final_review_corrects_attribution_using_later_conclusion():
    def generate(request):
        if request["phase"] in {"overview", "synthesis"}:
            return {
                "summary": "The opponent's innate-knowledge claim is refuted in the conclusion."
            }
        answer = note_answer(request)
        if request["phase"] == "extract":
            answer["notes"][0]["body_md"] = "The author says all knowledge is innate."
        else:
            assert "refuted" in request["global_map"]
            assert request["all_notes_map"]
            original = encoded(request["primary_segments"] + request["context_only_segments"])
            assert "I reject that claim" in original
            answer["notes"][0]["body_md"] = (
                "The author rejects the opponent's innate-knowledge claim."
            )
        return answer

    reader, _, _ = setup_reader(generate=generate)
    result, _ = reader.run()
    assert all("author rejects" in note["body_md"] for note in result["notes"])


def test_large_overview_uses_every_map_with_bounded_hierarchical_synthesis():
    reader, calls, _ = setup_reader()
    maps = [f"Section {index}: " + "argument and qualification " * 18 for index in range(100)]
    summary = reader.combine("global-map", maps)
    assert summary
    consumed = [item for call in calls for item in call["material"]]
    assert all(item in consumed for item in maps)
    assert len(calls) > 1
    assert all(token_bound(encoded(call)) <= reader.budget for call in calls)


def test_directed_reading_full_sources_and_model_selected_order():
    actions = []
    reader, calls, _ = setup_reader(generate=lambda request: actions.pop(0))
    reader.dependencies.agent_directed = True
    reader.dependencies.max_action_steps = 10
    actions.append({"action": "finish", "arguments": {"summary": "too early"}})
    for chunk in reversed(reader.chunks):
        plan = note_answer({"primary_segments": chunk["segments"]})
        plan["reviewed"] = True
        actions.append({"action": "save_plan", "arguments": {"chunk_id": chunk["id"], "plan": plan}})
    actions.append({"action": "finish", "arguments": {"summary": "All originals reviewed"}})
    result, _ = reader.run()
    assert calls[0]["last_result"]["delivery"] == "complete"
    assert calls[1]["correction"] == "source_coverage_incomplete"
    assert calls[1]["last_result"] == calls[0]["last_result"]
    assert len(result["coverage"]) == 2
    assert result["reviewed"] is True
    assert result["summary"] == "All originals reviewed"


def test_directed_reading_checkpoint_resumes_without_duplicate_notes():
    actions = []
    reader, calls, checkpoints = setup_reader(generate=lambda request: actions.pop(0))
    reader.dependencies.agent_directed = True
    reader.dependencies.max_action_steps = 1
    for chunk in reader.chunks:
        plan = note_answer({"primary_segments": chunk["segments"]})
        actions.append({"action": "save_plan", "arguments": {"chunk_id": chunk["id"], "plan": plan}})
    actions.append({"action": "finish", "arguments": {"summary": "Read"}})
    with pytest.raises(RuntimeError, match="resume_required"):
        reader.run()
    reader.resume_job_id = "current"
    reader.job_id = "resumed"
    reader.dependencies.max_action_steps = 10
    result, _ = reader.run()
    assert len(result["notes"]) == 2
    assert checkpoints[("resumed", "agent-state")]["plans"]
    assert [[(item["read"], item["saved"]) for item in request["index"]] for request in calls] == [
        [(True, False), (True, False)],
        [(True, True), (True, False)],
        [(True, True), (True, True)],
    ]


def test_directed_reading_keeps_saved_plans_when_the_first_resumed_call_fails():
    def generate(request):
        if request["saved_plan_count"]:
            raise RuntimeError("provider unavailable")
        chunk = reader.chunks[0]
        return {"action": "save_plan", "arguments": {
            "chunk_id": chunk["id"], "plan": note_answer({"primary_segments": chunk["segments"]}),
        }}

    reader, _, checkpoints = setup_reader(generate=generate)
    reader.dependencies.agent_directed = True
    reader.dependencies.max_action_steps = 10
    for current, previous in [("current", ""), ("resumed", "current"), ("resumed-again", "resumed")]:
        reader.job_id, reader.resume_job_id = current, previous
        with pytest.raises(RuntimeError, match="provider unavailable"):
            reader.run()
        assert len(checkpoints[(current, "agent-state")]["plans"]) == 1


def test_directed_large_source_is_delivered_in_full_with_a_longer_timeout():
    from backend.domains.llm_wiki import recovery
    calls = []
    def generate(prompt, **kwargs):
        calls.append((json.loads(prompt), kwargs["timeout"]))
        raise ValueError("stop after inspecting request")

    reader, _, _ = setup_reader()
    reader.dependencies.input_budget = 750_000
    reader.dependencies.generate_text = generate
    reader.dependencies.agent_directed = True
    reader.dependencies.max_action_steps = 64
    original = "Long source evidence. " * 16_000
    reader.origins = [finalize_origin({"kind": "text", "label": "Long source", "input_order": 0,
        "segments": [{"text": original, "locator": {}}]})]
    reader.chunks = reading_chunks(reader.origins, budget=reader.budget // 5, count=token_bound)
    with pytest.raises(ValueError, match="stop after inspecting request"):
        reader.run()
    request, timeout = calls[0]
    assert request["last_result"]["delivery"] == "complete"
    assert "".join(segment["text"] for chunk in request["last_result"]["sources"]
                   for segment in chunk["segments"]) == original.strip()
    assert timeout == recovery.LONG_REQUEST_TIMEOUT_SECONDS


def test_directed_steps_keep_exact_chunk_ids_and_distinct_cache_inputs():
    reader, calls, _ = setup_reader(generate=lambda _: {"action": "remember", "arguments": {"text": "Global context"}})
    reader.dependencies.agent_directed = True
    reader.dependencies.max_action_steps = 4
    with pytest.raises(RuntimeError, match="resume_required"):
        reader.run()
    assert [request["step"] for request in calls] == [0, 1, 2, 3]
    assert calls[2]["last_result"] == calls[3]["last_result"]
    assert calls[2] != calls[3]
    for request in calls:
        assert [item["id"] for item in request["index"]] == [chunk["id"] for chunk in reader.chunks]
        assert all(item["primary_segment_count"] == 1 for item in request["index"])


@pytest.mark.parametrize("source_size,expected_timeout", [(1_000, 240), (120_000, 900)])
def test_resumed_review_keeps_source_timeout_when_request_is_short(source_size, expected_timeout):
    reader, _, _ = setup_reader(resume="previous-job")
    reader.origins = [finalize_origin({"kind": "text", "label": "Source", "input_order": 0,
        "segments": [{"text": "A" * source_size, "locator": {}}]})]
    def generate(prompt, **kwargs):
        assert len(prompt.encode("utf-8")) < 96_000
        assert kwargs["timeout"] == expected_timeout
        return '{"summary":"Reviewed"}', "test-model"
    reader.dependencies.generate_text = generate
    assert reader.ask("review-saved", "agent-actions", {"saved_plan_count": 3}, lambda _: None)["summary"] == "Reviewed"


@pytest.mark.parametrize("action,arguments", [
    ("read", {}), ("read", {"text": "wrong action payload"}),
    ("index", {"offset": True}), ("index", {"limit": 101}),
    ("search", {"query": "  "}), ("remember", {"text": 12}),
])
def test_directed_action_contract_rejects_wrong_arguments(action, arguments):
    from backend.domains.llm_wiki.directed_reading import validate_action
    reader, _, _ = setup_reader()
    with pytest.raises(ValueError):
        validate_action(reader, {"read": [], "plans": {}}, {}, {"action": action, "arguments": arguments})


@pytest.mark.parametrize("action", ["read", "remember", "save_plan"])
def test_validating_an_action_does_not_mutate_live_state(action):
    from backend.domains.llm_wiki.directed_reading import validate_action
    reader, _, checkpoints = setup_reader()
    chunks = {chunk["id"]: chunk for chunk in reader.chunks}
    state = {"read": list(chunks) if action == "save_plan" else [], "plans": {}, "memory": "Original global map"}
    before = deepcopy(state)
    first = reader.chunks[0]
    arguments = {"read": {"chunk_id": first["id"]}, "remember": {"text": "New map"},
                 "save_plan": {"chunk_id": first["id"], "plan": note_answer({"primary_segments": first["segments"]})}}[action]
    validate_action(reader, state, chunks, {"action": action, "arguments": arguments})
    assert state == before
    assert not checkpoints
