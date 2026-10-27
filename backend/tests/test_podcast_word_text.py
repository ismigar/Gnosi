"""Compact length repairs preserve every word and enforce one shared episode range."""
import copy
import json
import re

import jsonschema
import pytest

from backend.services.podcast_composition import WORD_TEXT, schema, spoken_text, word_guidance
from backend.tests.test_podcast_briefing import tokenized
from backend.tests.test_podcast_lean_edit import Context, OPTIONS, data, response
from backend.tests.test_podcast_word_tokens import DATA, PROSE


def compact(prose, groups):
    return tokenized(prose, groups, text=True)


def broad_day(words, groups=31, minimum=1242, maximum=1504):
    plan = [{"key": f"group:{i}", "topic": f"Subject {i}"} for i in range(groups)]
    counts = [max(1, words - groups + 1) if words else 0, *[int(i < words) for i in range(1, groups)]]
    prose = {"paragraphs": {group["key"]: {"text": " ".join(["notícia"] * count),
        "non_editorial": count == 0} for group, count in zip(plan, counts, strict=True)}}
    value = {"composition_groups": plan, "composition_encoding": WORD_TEXT,
             "composition_word_range": {"min_words": minimum, "max_words": maximum}}
    return value, compact(prose, plan)


def test_compact_stream_preserves_legacy_spoken_words_qualifications_and_exclusions():
    original = copy.deepcopy(PROSE)
    value = {**DATA, "composition_encoding": WORD_TEXT}
    result = compact(original, value["composition_groups"])
    before = copy.deepcopy(result)
    jsonschema.validate(result, schema(value))
    legacy = tokenized(original, DATA["composition_groups"])
    assert spoken_text(result, value) == spoken_text(legacy, DATA)
    assert "encara pendents." in spoken_text(result, value)
    assert word_guidance(result, value, 8) == word_guidance(legacy, DATA, 8)
    assert result == before and original == PROSE
    assert len(json.dumps(result, ensure_ascii=False)) < len(json.dumps(legacy, ensure_ascii=False))
    assert "tokens" not in schema(value)["properties"]
    assert set(schema(value)["properties"]) == {"paragraphs", "token_text"}


@pytest.mark.parametrize("words", [1056, 1199, 1241, 1242, 1380, 1504, 1505, 1584, 1613, 1720, 1767])
def test_actual_day_global_boundaries_and_rejected_lengths_are_enforced_by_pattern(words):
    value, result = broad_day(words)
    contract = schema(value)
    pattern = contract["properties"]["token_text"]["pattern"]
    expected = 1242 <= words <= 1504
    assert bool(re.fullmatch(pattern, result["token_text"])) == expected
    assert len(spoken_text(result, value).split()) == words
    if expected:
        jsonschema.validate(result, contract)
    else:
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(result, contract)
    assert max(int(count) for bounds in re.findall(r"\{(\d+),(\d+)\}", pattern)
               for count in bounds) <= 999
    assert len(result["paragraphs"]) == 31


@pytest.mark.parametrize("minimum,maximum", [(1, 1), (5, 12), (90, 109), (999, 1001), (1990, 2030)])
def test_repeat_chunks_cover_exact_global_interval_without_a_topic_cap(minimum, maximum):
    for words in {max(0, minimum - 1), minimum, maximum, maximum + 1}:
        value, result = broad_day(words, groups=2, minimum=minimum, maximum=maximum)
        pattern = schema(value)["properties"]["token_text"]["pattern"]
        assert bool(re.fullmatch(pattern, result["token_text"])) == (minimum <= words <= maximum)


@pytest.mark.parametrize("mutate", [
    lambda xs: ["word", *xs],
    lambda xs: xs[:7],
    lambda xs: [*xs, "__gnosi_group__:group:1"],
    lambda xs: ["__gnosi_group__:group:1", *xs[1:]],
    lambda xs: [*xs, "__gnosi_group__:group:99"],
])
def test_compact_stream_never_voices_missing_reordered_duplicate_or_unknown_markers(mutate):
    value = {**DATA, "composition_encoding": WORD_TEXT}
    result = compact(PROSE, value["composition_groups"])
    result["token_text"] = " ".join(mutate(result["token_text"].split()))
    with pytest.raises(ValueError):
        spoken_text(result, value)


@pytest.mark.parametrize("bad", [None, [], {}, 7, True])
def test_invalid_or_ambiguous_compact_stream_is_rejected_before_speech(bad):
    value = {**DATA, "composition_encoding": WORD_TEXT}
    result = compact(PROSE, value["composition_groups"])
    result["token_text"] = bad
    with pytest.raises(ValueError, match="composition_tokens_invalid"):
        spoken_text(result, value)
    result = compact(PROSE, value["composition_groups"])
    result["tokens"] = []
    with pytest.raises(ValueError, match="composition_tokens_invalid"):
        spoken_text(result, value)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, schema(value))


@pytest.mark.parametrize("fit", ["full", "lean", "overflow"])
@pytest.mark.parametrize("rejected_words", [40, 160])
def test_existing_automatic_retry_uses_compact_wire_with_unchanged_scope_and_limits(fit, rejected_words):
    from backend.services.podcast_automatic import _bounded_write
    context = Context([response(rejected_words), response(100)], fit)
    original = data()
    snapshot = copy.deepcopy(original)
    result = _bounded_write(context, original, OPTIONS)
    assert original == snapshot and len(context.sent) == 2
    repair = context.sent[1]
    assert repair["composition_encoding"] == WORD_TEXT
    assert repair["composition_word_range"] == {"min_words": 90, "max_words": 109}
    assert repair["composition_groups"] == original["composition_groups"]
    assert repair["subject_groups"] == original["subject_groups"]
    assert len(result["narration"].split()) == 100
    assert "__gnosi_group__" not in result["narration"]
    if "previous_composition" in repair:
        assert repair["previous_composition"] == response(rejected_words)
    if repair["length_repair"]["mode"] == "shorten_composition":
        assert repair["source_part_ids"] == [brief["part_id"] for brief in original["briefs"]]
