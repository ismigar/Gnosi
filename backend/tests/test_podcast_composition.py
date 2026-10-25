"""A complete group map is mandatory, but never substitutes for semantic review."""
import json
from types import SimpleNamespace

import jsonschema
import pytest
from openai import ContentFilterFinishReasonError

from backend.services.podcast_composition import schema, spoken_text
from backend.tests.test_podcast_briefing import audited, pipeline, written  # noqa: F401


DATA = {"composition_groups": [{"key": "group:0", "topic": "Housing"},
                               {"key": "group:1", "topic": "Community"}]}


def test_group_response_cannot_silently_drop_minority_group_or_invent_keys():
    for paragraphs in ({"group:0": {"text": "Housing action.", "non_editorial": False}},
                       {"group:0": {"text": "Housing action.", "non_editorial": False},
                        "other": {"text": "Community service.", "non_editorial": False}}):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"paragraphs": paragraphs}, schema(DATA))


def test_speech_uses_plan_order_and_only_prose_without_keys_or_exclusion_metadata():
    result = {"paragraphs": {"group:1": {"text": "Community service.", "non_editorial": False},
                             "group:0": {"text": "Housing action.", "non_editorial": False}}}
    jsonschema.validate(result, schema(DATA))
    assert spoken_text(result, DATA) == "Housing action.\n\nCommunity service."
    result["paragraphs"]["group:1"] = {"text": "", "non_editorial": True}
    assert spoken_text(result, DATA) == "Housing action."
    result["paragraphs"]["group:1"]["non_editorial"] = False
    with pytest.raises(ValueError, match="requires_prose"):
        spoken_text(result, DATA)


def test_explicit_exclusion_of_editorial_theme_still_requires_automatic_semantic_repair(pipeline):
    writes = []
    def model(request, **kwargs):
        data = json.loads(request.input)["data"]
        if request.operation.endswith("write"):
            writes.append(data)
            groups = data["composition_groups"]
            prose = "Housing proposals remain pending. " + "Context. " * (request.options["min_words"] - 4)
            result = written(request, prose)
            if not data["feedback"]:
                result["paragraphs"][groups[0]["key"]]["text"] = prose.strip()
                result["paragraphs"][groups[1]["key"]] = {"text": "", "non_editorial": True}
            else:
                result["paragraphs"][groups[1]["key"]]["text"] += " Community volunteers provide meals."
        elif request.operation.endswith("audit") and data.get("review_focus") == "coverage":
            missing = "Community volunteers provide meals." not in data["narration"]
            evidence = next((b for b in data["briefs"] if b["source_id"] == "community"), None)
            result = {"issues": [{"kind": "omission", "detail": "Community service is an editorial theme.",
                "narration_quotes": [], "source_part_ids": [evidence["part_id"]],
                "evidence_quote": "Community volunteers provide meals."}] if missing and evidence else []}
        else:
            return pipeline.model(request, **kwargs)
        if request.operation.endswith('audit'):
            result = audited(request, result['issues'])
        text = json.dumps(result)
        kwargs["output_validator"](text)
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr("backend.services.agent_execution.run_sync", model)
    result = pipeline.run([{"id": "housing", "title": "Housing", "text": "Housing proposals remain pending."},
                           {"id": "community", "title": "Community", "text": "Community volunteers provide meals."}])
    assert len(writes) == 2 and writes[1]["feedback"]
    assert "Community volunteers provide meals." in result
    assert pipeline.saved["podcast-coverage-report"]["sections"][0]["narration"] == result


def test_sdk_filter_error_is_classified_as_provider_refusal():
    from backend.agent.model_reliability import classify_failure
    assert classify_failure(ContentFilterFinishReasonError()) == "content_filter"


@pytest.mark.parametrize("weights", [{"a": 1, "b": 1, "c": 1}, {"a": 40, "b": 1, "c": 0},
                                      {"a": 0, "b": 0, "c": 0}])
def test_advisory_shares_sum_exactly_to_one_global_budget(weights):
    from backend.services.podcast_composition import advisory_targets
    initial = advisory_targets(1380, weights, minimum=12)
    assert sum(initial.values()) == 1380 and min(initial.values()) >= 12
    retry = advisory_targets(1380, weights)
    assert sum(retry.values()) == 1380 and list(retry) == list(weights)
    if any(weights.values()):
        assert all(retry[key] == 0 for key, value in weights.items() if value == 0)


def test_latest_rejected_paragraphs_drive_proportional_guidance():
    from backend.services.podcast_composition import word_guidance
    result = {"paragraphs": {"group:0": {"text": "word " * 70, "non_editorial": False},
                             "group:1": {"text": "word " * 90, "non_editorial": False}}}
    guidance = word_guidance(result, DATA, 100)["paragraph_word_guidance"]
    assert guidance == {"group:0": {"current": 70, "suggested": 44},
                        "group:1": {"current": 90, "suggested": 56}}
    result["paragraphs"]["group:0"]["text"] = "word " * 20
    assert word_guidance(result, DATA, 100)["paragraph_word_guidance"]["group:0"]["current"] == 20


def test_advisory_shares_are_not_per_group_acceptance_caps():
    from backend.services.podcast_automatic import _bounded_write
    from backend.services.agent_execution_models import AgentOperation
    class Context:
        budget = 80000
        def request(self, task, data, contract):
            return AgentOperation(skill_id="core.gnosi-daily-briefing", operation=task,
                                  input=json.dumps(data), output_schema=contract)
        def cost(self, request):
            return 100
        def stage(self, request, validate):
            result = {"paragraphs": {"group:0": {"text": "word " * 100, "non_editorial": False},
                                     "group:1": {"text": "Minority subject.", "non_editorial": False}}}
            validate(result)
            return result
    data = {"briefs": [], "composition_groups": [{**group, "target_words": 50}
                                                  for group in DATA["composition_groups"]]}
    result = _bounded_write(Context(), data, {"min_words": 90, "max_words": 109, "target_words": 100})
    assert len(result["narration"].split()) == 102


def test_initial_composition_guidance_has_exact_global_sum(pipeline):
    pipeline.run([{"id": str(i), "title": f"Topic {i}", "text": "Evidence"} for i in range(20)])
    writes = [call for call in pipeline.calls if call["task"].endswith("write")]
    assert writes and sum(g["target_words"] for g in writes[0]["data"]["composition_groups"]) == 1380
