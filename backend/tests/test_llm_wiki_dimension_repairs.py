"""Classification errors cannot hide citations until the last paid attempt."""
from copy import deepcopy
import json
from types import SimpleNamespace

import jsonschema
import pytest

from backend.domains.llm_wiki.directed_reading import validate_action
from backend.domains.llm_wiki.reading_action_contracts import action_schemas
from backend.domains.llm_wiki.reading_contracts import ReadingPlanError
from backend.domains.llm_wiki.reading_dimension_repairs import build_dimension_repair


def fixture(batch=True, bad_reference=True):
    dimensions = [{"field_id": "area", "allowed_labels": ["History", "Ethics"], "multiple": True},
                  {"field_id": "kind", "allowed_labels": ["Idea"], "multiple": False}]
    chunks = {f"chunk-{i}": {"id": f"chunk-{i}", "segments": [{"id": f"p{i}", "text": f"Original colour {i}."}]}
              for i in range(2 if batch else 1)}
    plans = [{"chunk_id": key, "plan": {"notes": [
        {"title": "Unchanged title", "body_md": "Complete and unchanged idea.", "source_segment_id": f"p{i}",
         "citations": [{"segment_id": f"p{i}", "quote": f"Original color {i}." if bad_reference else f"Original colour {i}."}],
         "dimensions": {"area": ["Ética"], "kind": ["Idea"]}}],
        "coverage": [{"segment_id": f"p{i}", "reason": "Read the whole original"}], "reviewed": True}}
        for i, key in enumerate(chunks)]
    answer = ({"action": "save_batch", "arguments": {"plans": plans, "memory": "Global synthesis unchanged"}}
              if batch else {"action": "save_plan", "arguments": plans[0]})
    if not batch:
        answer["arguments"]["plan"]["memory"] = "Global synthesis unchanged"
    state = {"plans": {}, "read": list(chunks), "delivered": list(chunks), "memory": "Previous synthesis", "step": 0}
    reader = SimpleNamespace(dimensions=dimensions, budget=50_000, dependencies=SimpleNamespace(count_tokens=len))
    def validate(value):
        validate_action(reader, state, chunks, value)
    prompt = json.dumps({"dimensions": dimensions, "output_schema": action_schemas(dimensions)[0]})
    return answer, prompt, validate, state


def patch_for(repair):
    payload = json.loads(repair.input)
    patches = [{"path": row["path"], "value": ["Ethics"]} for row in payload["classification_fields"]]
    context = payload['reference_repair']
    for item in (context.get('repairs', [context]) if context else []):
        primary = item['primary_segment_ids'][0]
        quote = item['reference_passages'][0]['text']
        for path in item['allowed_paths']:
            value = primary if path.endswith('source_segment_id') else [{"segment_id": primary, "quote": quote}]
            patches.append({"path": 'references/' + path, "value": value})
    return {"patches": patches}


@pytest.mark.parametrize('batch', [False, True])
@pytest.mark.parametrize('bad_reference', [False, True])
def test_one_patch_repairs_classification_and_all_bad_citations_without_rewriting(batch, bad_reference):
    answer, prompt, validate, state = fixture(batch, bad_reference)
    original, before = deepcopy(answer), deepcopy(state)
    repair = build_dimension_repair(prompt, json.dumps(answer), validate)
    assert repair is not None
    restored = json.loads(repair.restore(json.dumps(patch_for(repair))))
    validate(restored)
    assert answer == original and state == before
    entries = restored['arguments']['plans'] if batch else [restored['arguments']]
    for entry in entries:
        note = entry['plan']['notes'][0]
        assert note['title'] == 'Unchanged title'
        assert note['body_md'] == 'Complete and unchanged idea.'
        assert note['dimensions'] == {'area': ['Ethics'], 'kind': ['Idea']}
        assert entry['plan']['coverage'][0]['reason'] == 'Read the whole original'
    assert ('Global synthesis unchanged' in json.dumps(restored))


@pytest.mark.parametrize('fault', ['body', 'valid_dimension', 'duplicate', 'missing', 'foreign_label', 'wrong_type'])
def test_combined_patch_rejects_unrelated_changes_and_invalid_classification(fault):
    answer, prompt, validate, _ = fixture()
    repair = build_dimension_repair(prompt, json.dumps(answer), validate)
    patch = patch_for(repair)
    if fault == 'body':
        patch['patches'][0]['path'] = 'arguments/plans/0/plan/notes/0/body_md'
    elif fault == 'valid_dimension':
        patch['patches'][0]['path'] = 'arguments/plans/0/plan/notes/0/dimensions/kind'
    elif fault == 'duplicate':
        patch['patches'][1] = deepcopy(patch['patches'][0])
    elif fault == 'missing':
        patch['patches'].pop(0)
    else:
        patch['patches'][0]['value'] = ['Invented'] if fault == 'foreign_label' else 'Ethics'
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps(patch))


def test_combined_patch_does_not_bypass_literal_quote_validation():
    answer, prompt, validate, _ = fixture()
    repair = build_dimension_repair(prompt, json.dumps(answer), validate)
    patch = patch_for(repair)
    next(row for row in patch['patches'] if row['path'].endswith('/citations'))['value'][0]['quote'] = 'Invented'
    with pytest.raises(ReadingPlanError):
        validate(json.loads(repair.restore(json.dumps(patch))))


@pytest.mark.parametrize('fault', ['syntax', 'missing_title', 'extra_dimension', 'missing_dimension', 'bad_memory'])
def test_unrelated_or_incomplete_structures_still_require_full_repair(fault):
    answer, prompt, validate, _ = fixture()
    note = answer['arguments']['plans'][0]['plan']['notes'][0]
    if fault == 'missing_title':
        note.pop('title')
    elif fault == 'extra_dimension':
        note['dimensions']['foreign'] = []
    elif fault == 'missing_dimension':
        note['dimensions'].pop('area')
    elif fault == 'bad_memory':
        answer['arguments'].pop('memory')
        answer['arguments']['memory_updates'] = [{'old': 'not in memory', 'new': 'replacement'}]
    text = '{"action":' if fault == 'syntax' else json.dumps(answer)
    assert build_dimension_repair(prompt, text, validate) is None


def test_valid_classification_does_not_trigger_combined_repair():
    answer, prompt, validate, _ = fixture()
    for entry in answer['arguments']['plans']:
        entry['plan']['notes'][0]['dimensions']['area'] = ['Ethics']
    assert build_dimension_repair(prompt, json.dumps(answer), validate) is None
