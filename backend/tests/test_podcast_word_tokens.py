"""A shared bounded word stream preserves all groups without clipping prose."""
import copy

import jsonschema
import pytest

from backend.services.podcast_composition import schema, spoken_text, word_guidance
from backend.tests.test_podcast_briefing import tokenized
from backend.tests.test_podcast_lean_edit import Context, OPTIONS, data, response


DATA = {"composition_groups": [{"key": "group:0", "topic": "Housing", "target_words": 4},
                               {"key": "group:1", "topic": "Community", "target_words": 4}],
        "composition_encoding": "word_tokens_v1",
        "composition_word_range": {"min_words": 5, "max_words": 12}}
PROSE = {"paragraphs": {"group:0": {"text": "El govern proposa pisos; encara pendents.", "non_editorial": False},
                        "group:1": {"text": "Les voluntàries serveixen àpats.", "non_editorial": False}}}


def encoded(prose=PROSE):
    return tokenized(prose, DATA["composition_groups"])


def test_word_stream_preserves_every_word_qualification_and_plan_order():
    value = encoded()
    jsonschema.validate(value, schema(DATA))
    assert spoken_text(value, DATA) == "El govern proposa pisos; encara pendents.\n\nLes voluntàries serveixen àpats."
    assert len(spoken_text(value, DATA).split()) == 10
    assert schema(DATA)["properties"]["tokens"]["maxItems"] == 14
    assert schema(DATA)["properties"]["tokens"]["minItems"] == 7
    assert "__gnosi_group__" not in spoken_text(value, DATA)
    assert "non_editorial" not in spoken_text(value, DATA)


def test_no_per_group_cap_and_non_editorial_exclusion_remains_explicit():
    value = copy.deepcopy(PROSE)
    value["paragraphs"]["group:0"]["text"] += " L’acord continua pendent."
    value["paragraphs"]["group:1"] = {"text": "", "non_editorial": True}
    result = encoded(value)
    jsonschema.validate(result, schema(DATA))
    assert spoken_text(result, DATA) == value["paragraphs"]["group:0"]["text"]
    assert len(spoken_text(result, DATA).split()) > DATA["composition_groups"][0]["target_words"]
    result["paragraphs"]["group:1"]["non_editorial"] = False
    with pytest.raises(ValueError, match="requires_prose"):
        spoken_text(result, DATA)


@pytest.mark.parametrize("count", [1720, 1613, 1584, 1056, 1112, 1199])
def test_observed_out_of_range_lengths_are_schema_invalid_and_never_silently_clipped(count):
    candidate = copy.deepcopy(PROSE)
    candidate["paragraphs"]["group:0"]["text"] = "news " * (count - 4)
    result = encoded(candidate)
    broad = {**DATA, "composition_word_range": {"min_words": 1242, "max_words": 1504}}
    assert len(spoken_text(result, broad).split()) == count
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, schema(broad))


@pytest.mark.parametrize("mutate", [
    lambda xs: ["word", *xs],
    lambda xs: xs[:7],
    lambda xs: [*xs, "__gnosi_group__:group:1"],
    lambda xs: ["__gnosi_group__:group:1", *xs[1:]],
    lambda xs: [*xs, "__gnosi_group__:group:99"],
    lambda xs: [*xs, "two words"],
    lambda xs: [*xs, "tab\tword"],
    lambda xs: [*xs, "word\n"],
    lambda xs: [*xs, ""],
    lambda xs: [*xs, 7],
])
def test_bad_or_missing_structural_markers_and_multiword_items_cannot_be_voiced(mutate):
    result = encoded()
    result["tokens"] = mutate(result["tokens"])
    with pytest.raises(ValueError):
        spoken_text(result, DATA)


def test_token_counts_drive_guidance_without_reconstructing_the_stored_model_object():
    result = encoded()
    before = copy.deepcopy(result)
    assert word_guidance(result, DATA, 8)["paragraph_word_guidance"] == {
        "group:0": {"current": 6, "suggested": 5}, "group:1": {"current": 4, "suggested": 3}}
    assert result == before


@pytest.mark.parametrize("rejected_words", [40, 160])
@pytest.mark.parametrize("fit", ["full", "lean", "overflow"])
def test_existing_length_repair_uses_bounded_format_with_same_global_limits_and_scope(fit, rejected_words, monkeypatch):
    from backend.services.podcast_automatic import _bounded_write
    context = Context([response(rejected_words), response(100)], fit)
    original = data()
    if rejected_words < OPTIONS["min_words"] and fit != "full":
        records = [{"part_ids": [b["part_id"] for b in original["briefs"]], "summary": "Complete digest"}]
        monkeypatch.setattr("backend.services.podcast_outline._digest", lambda ctx, evidence: records)
        if fit == "overflow":
            with pytest.raises(RuntimeError, match="podcast_feedback_context_insufficient"):
                _bounded_write(context, original, OPTIONS)
            assert len(context.sent) == 1
            return
    result = _bounded_write(context, original, OPTIONS)
    repair = context.sent[-1]
    assert len(context.sent) == 2
    assert repair["composition_encoding"] == "word_text_v1"
    assert repair["composition_word_range"] == {"min_words": 90, "max_words": 109}
    assert repair["composition_groups"] == original["composition_groups"]
    assert repair["subject_groups"] == original["subject_groups"]
    assert len(result["narration"].split()) == 100
    if fit == "full" or rejected_words > OPTIONS["max_words"] and fit != "overflow":
        assert repair["previous_composition"] == response(rejected_words)
    if rejected_words < OPTIONS["min_words"]:
        if fit == "full":
            assert repair["briefs"] == original["briefs"]
        else:
            assert repair["digests"] == records
        assert repair["previous_composition"] == response(rejected_words)
        assert repair["length_repair"]["mode"] == "revise_draft"


@pytest.mark.parametrize("container", [None, "words", {}, 7, True])
@pytest.mark.parametrize("field", ["tokens", "paragraphs"])
def test_invalid_stream_or_paragraph_container_stops_before_speech(container, field):
    result = encoded()
    result[field] = container
    with pytest.raises(ValueError, match="composition_.*_invalid"):
        spoken_text(result, DATA)


@pytest.mark.parametrize("change", [
    lambda p: p.pop("group:1"),
    lambda p: p.update(other={"non_editorial": False}),
    lambda p: p.update({"group:0": None}),
    lambda p: p["group:0"].update(non_editorial="false"),
])
def test_incomplete_or_invalid_flag_map_is_rejected_explicitly(change):
    result = encoded()
    change(result["paragraphs"])
    with pytest.raises(ValueError, match="paragraphs_invalid"):
        spoken_text(result, DATA)
