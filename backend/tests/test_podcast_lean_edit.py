"""Length-only editing retains exact model structure without changing semantic gates."""
import copy
import hashlib
import json
from types import SimpleNamespace

import jsonschema
import pytest
from openai import ContentFilterFinishReasonError

from backend.services import podcast_automatic as automatic
from backend.tests.test_podcast_briefing import pipeline, tokenized, written  # noqa: F401


OPTIONS = {"min_words": 90, "max_words": 109, "target_words": 100}


def data():
    return {"briefs": [{"part_id": f"source:{i}", "summary": f"Original {i}"} for i in range(254)],
            "feedback": [{"kind": "omission", "detail": "Earlier semantic finding"}],
            "subject_groups": [{"topic": "Shared", "subjects": ["Main", "Minority"]},
                               {"topic": "Access", "subjects": ["Registration"]}],
            "composition_groups": [{"key": "group:0", "topic": "Shared"},
                                   {"key": "group:1", "topic": "Access"}]}


def response(words):
    return {"paragraphs": {"group:0": {"text": "  Àmbit\n" + "word " * (words - 1), "non_editorial": False},
                           "group:1": {"text": "", "non_editorial": True}}}


class Context:
    budget = 80000

    def __init__(self, responses, fit="lean"):
        self.responses, self.fit, self.sent = iter(responses), fit, []

    def request(self, task, value, schema):
        return SimpleNamespace(input=json.dumps(value), output_schema=schema,
                               model_copy=lambda update: SimpleNamespace(input=json.dumps(value),
                                   output_schema=schema, options=update["options"]))

    def cost(self, request):
        value = json.loads(request.input)
        prior = "previous_composition" in value
        if prior and (self.fit == "overflow" or self.fit == "lean" and "briefs" in value):
            return 81000
        return 100

    def stage(self, request, validate):
        assert self.cost(request) <= self.budget
        self.sent.append(json.loads(request.input))
        result = next(self.responses)
        if isinstance(result, Exception):
            raise result
        if "tokens" in request.output_schema["properties"] and "tokens" not in result:
            result = tokenized(result, json.loads(request.input)["composition_groups"])
        jsonschema.validate(result, request.output_schema)
        validate(result)
        return result


@pytest.mark.parametrize("fit", ["full", "lean", "overflow"])
def test_exact_rejected_structure_scope_and_hash_or_clean_fallback(fit):
    rejected = response(160)
    context = Context([rejected, response(100)], fit)
    original = data()
    snapshot = copy.deepcopy(original)
    automatic._bounded_write(context, original, OPTIONS)
    assert original == snapshot
    repair = context.sent[1]
    if fit == "overflow":
        assert repair["briefs"] == original["briefs"]
        assert repair["length_repair"] == {"mode": "fresh_composition", **OPTIONS}
        assert "previous_composition" not in repair
        return
    assert repair["previous_composition"] == rejected
    encoded = json.dumps(rejected, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    assert repair["length_repair"]["composition_sha256"] == hashlib.sha256(encoded.encode()).hexdigest()
    assert repair["length_repair"]["current_words"] == 160
    assert repair["length_repair"]["paragraph_word_guidance"] == {
        "group:0": {"current": 160, "suggested": 100}, "group:1": {"current": 0, "suggested": 0}}
    assert repair["subject_groups"] == original["subject_groups"]
    assert repair["composition_groups"] == original["composition_groups"]
    if fit == "lean":
        assert repair["source_part_ids"] == [f"source:{i}" for i in range(254)]
        assert repair["length_repair"]["mode"] == "shorten_composition"
        assert not {"briefs", "digests", "feedback", "previous_draft"} & repair.keys()
    else:
        assert repair["briefs"] == original["briefs"] and repair["feedback"] == original["feedback"]


def test_length_stage_uses_the_latest_rejected_reply_when_length_direction_changes():
    class Replies(Context):
        def stage(self, request, validate):
            if not self.sent:
                self.sent.append(json.loads(request.input))
                for value in (response(160), response(40)):
                    jsonschema.validate(value, request.output_schema)
                    if value == response(160):
                        with pytest.raises(ValueError, match="podcast_word_budget"):
                            validate(value)
                    else:
                        validate(value)
            return super().stage(request, validate)
    context = Replies([response(100)], "full")
    automatic._bounded_write(context, data(), OPTIONS)
    assert len(context.sent) == 2
    repair = context.sent[1]
    assert repair["length_repair"]["current_words"] == 40
    assert repair["previous_composition"] == response(40)
    encoded = json.dumps(response(40), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    assert repair["length_repair"]["composition_sha256"] == hashlib.sha256(encoded.encode()).hexdigest()
    assert repair["composition_encoding"] == "word_tokens_v1"
    assert repair["briefs"] == data()["briefs"]


def test_underlength_repair_keeps_source_evidence_instead_of_lean_expansion():
    context = Context([response(40), response(100)])
    automatic._bounded_write(context, data(), OPTIONS)
    assert context.sent[1]["briefs"] == data()["briefs"]
    assert context.sent[1]["length_repair"]["mode"] == "fresh_composition"
    assert "previous_composition" not in context.sent[1]


def test_complete_digest_and_exact_prior_are_preferred_over_lean(monkeypatch):
    original = data()
    context = Context([response(160), response(100)], "full")
    ordinary_cost = context.cost
    context.cost = lambda request: 90000 if "briefs" in json.loads(request.input) else ordinary_cost(request)
    records = [{"part_ids": [b["part_id"] for b in original["briefs"]], "summary": "Complete digest"}]
    monkeypatch.setattr("backend.services.podcast_outline._digest", lambda *args: records)
    automatic._bounded_write(context, original, OPTIONS)
    repair = context.sent[1]
    assert repair["digests"] == records and repair["previous_composition"] == response(160)
    assert repair["length_repair"]["mode"] == "revise_draft"


@pytest.mark.parametrize("failure", [ContentFilterFinishReasonError(), ValueError("invalid shape")])
def test_terminal_failures_never_enter_another_length_stage(failure):
    context = Context([response(160), failure, response(100)])
    with pytest.raises(type(failure)):
        automatic._bounded_write(context, data(), OPTIONS)
    assert len(context.sent) == 2


def test_lean_success_still_audits_every_original_and_restores_evidence_for_semantic_revision(monkeypatch):
    evidence = [{**b, "source_id": b["part_id"]} for b in data()["briefs"]]
    outline = data()["subject_groups"]
    writes, audits = [], []
    original_write = automatic._write_episode
    def write(context, briefs, groups, budget, feedback, previous_draft):
        # write_day's broad-day target is 1380; force a lean length correction per semantic pass.
        ctx = Context([response(1600), response(1380)])
        result = original_write(ctx, briefs, groups, budget, feedback, previous_draft)
        writes.append(ctx.sent)
        return result
    def review(context, value, narration, subjects):
        audits.append(value)
        return [{"kind": "omission", "detail": "Minority"}] if len(audits) == 1 else []
    monkeypatch.setattr(automatic, "_write_episode", write)
    monkeypatch.setattr(automatic, "_review_theme", review)
    whole = []
    monkeypatch.setattr(automatic, "_audit", lambda context, value: whole.append(value) or [])
    sections, _, _ = automatic.write_day(None, evidence, outline, lambda _: None)
    assert len(sections[0]["narration"].split()) == 1380
    assert len(audits) == len(whole) == 2 and all(value == evidence for value in audits)
    assert all(value["subjects"] == [group["subjects"] for group in outline] for value in whole)
    assert all(pass_writes[0]["briefs"] == evidence for pass_writes in writes)
    assert writes[1][0]["feedback"] == [{"kind": "omission", "detail": "Minority"}]
    assert all(pass_writes[1]["length_repair"]["mode"] == "shorten_composition" for pass_writes in writes)


def test_provider_refusal_during_lean_edit_never_audits_or_publishes(pipeline):
    from backend.services.podcast_briefing import _Briefing
    calls = []
    ordinary_cost = _Briefing.cost
    def cost(context, request):
        value = json.loads(request.input).get("data", {})
        if "previous_composition" in value and "briefs" in value:
            return context.budget + 1
        return ordinary_cost(context, request)
    def model(request, **kwargs):
        if request.operation.endswith("audit"):
            pytest.fail("Refused composition must never reach semantic audit")
        if request.operation.endswith("write"):
            value = json.loads(request.input)["data"]
            calls.append(value)
            if len(calls) == 2:
                assert value["length_repair"]["mode"] == "shorten_composition"
                raise ContentFilterFinishReasonError()
            text = json.dumps(written(request, "word " * (request.options["max_words"] + 10)))
            kwargs["output_validator"](text)
            return SimpleNamespace(result=text)
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr(_Briefing, "cost", cost)
    pipeline.monkeypatch.setattr("backend.services.agent_execution.run_sync", model)
    with pytest.raises(ContentFilterFinishReasonError):
        pipeline.run([{"id": str(i), "title": f"Topic {i}", "text": "Original evidence"} for i in range(2)])
    assert len(calls) == 2 and "podcast-coverage-report" not in pipeline.saved


@pytest.mark.parametrize("invalid", [
    {"paragraphs": {"group:0": {"text": "word " * 100, "non_editorial": False}}},
    {"paragraphs": {"group:0": {"text": "word " * 100, "non_editorial": False},
                    "group:1": {"text": "", "non_editorial": False}}},
])
def test_lean_response_still_rejects_missing_group_or_invalid_exclusion(invalid):
    context = Context([response(160), invalid, response(100)])
    with pytest.raises((jsonschema.ValidationError, ValueError)):
        automatic._bounded_write(context, data(), OPTIONS)
    assert len(context.sent) == 2
