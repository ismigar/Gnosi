"""Keep every confirmed correction when a full daily rewrite exceeds context."""
from copy import deepcopy
import json
from types import SimpleNamespace

import jsonschema
import pytest

from backend.services.agent_behavior import operation_input, task_input
from backend.services.agent_execution_models import AgentOperation
from backend.services.podcast_automatic import _write_request, write_day
from backend.services.podcast_feedback import fit_feedback


class Context:
    budget = 80_000

    def __init__(self, guide='at_budget'):
        self.calls = []
        self.guide = guide
        self.snapshot = SimpleNamespace(skill_instructions={'core.gnosi-daily-briefing':
            '```json\n{"podcast_preferences":{"review_mode":"full"}}\n```'})

    def request(self, task, data, schema):
        return AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
            input=task_input(task, language='Catalan', **data), output_schema=schema)

    def cost(self, request):
        return len(operation_input(request).encode()) + 1024

    def stage(self, request, validate):
        assert self.cost(request) <= min(80_000, self.budget)
        data = json.loads(request.input)['data']
        self.calls.append((request, data))
        if 'confirmed_findings' in data:
            budget = data['guidance_byte_budget']
            guide = ('g' * budget if self.guide == 'at_budget' else
                     '🙂' * budget if self.guide == 'unicode' else
                     '\"' * budget if self.guide == 'escaped' else self.guide)
            value = {'guidance': {row['finding_id']: guide for row in data['confirmed_findings']}}
        elif request.operation.endswith('write'):
            groups = data['composition_groups']
            value = {'paragraphs': {group['key']: {'text': 'word ' * (1380 // len(groups)
                + (index < 1380 % len(groups))), 'non_editorial': False}
                for index, group in enumerate(groups)}}
        elif request.operation.endswith('digest'):
            value = {'topic': 'All domains', 'narration': 'Complete evidence and its qualifications.'}
        else:
            raise AssertionError('Unexpected model operation')
        jsonschema.validate(value, request.output_schema)
        validate(value)
        return value


def findings(count=176):
    return [{'kind': 'distortion' if index % 2 else 'omission',
        'detail': f'Correction {index}: ' + 'essential condition and substantive development. ' * 7,
        'narration_quotes': ['Exact current narration with an essential qualification.'] if index % 2 else [],
        'source_part_ids': [f'{index}:0'], 'evidence_quote': 'Exact original development and its scope. ' * 3}
        for index in range(count)]


def daily_data(feedback):
    return {'topic': 'Complete daily briefing', 'feedback': feedback,
        'subject_groups': [{'topic': f'Domain {i}', 'subjects': [f'Subject {i}-{j} ' + 'qualification ' * 3
            for j in range(8)]} for i in range(32)],
        'composition_groups': [{'key': f'group:{i}', 'topic': f'Domain {i}', 'target_words': 43}
            for i in range(32)],
        'digests': [{'topic': 'All domains', 'part_ids': [f'{i}:0' for i in range(254)],
            'summary': 'Complete evidence and qualifications. ' * 50}]}


OPTIONS = {'min_words': 1242, 'max_words': 1504, 'target_words': 1380}


def test_176_corrections_fit_without_dropping_ids_scopes_or_subjects():
    context = Context()
    data = daily_data(findings())
    original = deepcopy(data)
    request = _write_request(context, data, OPTIONS)
    assert context.cost(request) <= 80_000
    result = json.loads(request.input)['data']
    compact = result['feedback']
    assert compact['encoding'] == 'finding_guidance_v1'
    assert compact['columns'] == ['finding_id', 'kind', 'source_part_ids', 'guidance']
    guidance_calls = [(q, d) for q, d in context.calls if 'confirmed_findings' in d]
    budget = guidance_calls[0][1]['guidance_byte_budget']
    assert 1 <= budget <= 160
    assert compact['rows'] == [[f'finding:{i}', f['kind'], f['source_part_ids'], 'g' * budget]
                               for i, f in enumerate(original['feedback'])]
    assert result['subject_groups'] == original['subject_groups']
    assert result['composition_groups'] == original['composition_groups']
    assert {part for row in result['digests'] for part in row['part_ids']} == {part for row in original['digests'] for part in row['part_ids']}
    sent = [row for q, d in guidance_calls for row in d['confirmed_findings']]
    assert sent == [{'finding_id': f'finding:{i}', 'finding': f} for i, f in enumerate(original['feedback'])]
    assert all(len(d['confirmed_findings']) <= 8 and context.cost(q) <= 40_000 for q, d in guidance_calls)
    assert data == original


@pytest.mark.parametrize('feedback', [[], findings(1)])
def test_fitting_feedback_keeps_legacy_request_and_makes_no_digest(feedback):
    context = Context()
    data = daily_data(feedback)
    request = context.request('podcast.coverage.write', data, {'type': 'object'})
    revised, actual = fit_feedback(context, data, request, lambda _: pytest.fail('Unexpected rewrite'))
    assert revised is data and actual is request and context.calls == []


@pytest.mark.parametrize('guide', [' ', 'g' * 161, 'unicode', 'escaped'])
def test_invalid_guidance_cannot_reach_writer(guide):
    context = Context(guide)
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        _write_request(context, daily_data(findings()), OPTIONS)
    assert all(q.operation.endswith('digest') for q, _ in context.calls)


@pytest.mark.parametrize('mode', ['missing', 'extra'])
def test_schema_requires_exactly_every_finding_id(mode):
    class Invalid(Context):
        def stage(self, request, validate):
            if 'confirmed_findings' not in json.loads(request.input)['data']:
                return super().stage(request, validate)
            ids = list(request.output_schema['properties']['guidance']['properties'])
            value = {'guidance': {identifier: 'A concrete correction.' for identifier in ids}}
            if mode == 'missing':
                del value['guidance'][ids[0]]
            else:
                value['guidance']['invented'] = 'Another correction.'
            jsonschema.validate(value, request.output_schema)
            pytest.fail('Invalid guidance passed the closed schema')
    with pytest.raises(jsonschema.ValidationError):
        _write_request(Invalid(), daily_data(findings()), OPTIONS)


def test_indivisible_feedback_fails_before_any_model_call():
    context = Context()
    context.budget = 100
    data = daily_data(findings(1))
    def request_for(value):
        return context.request('podcast.coverage.write', value, {'type': 'object'})
    with pytest.raises(RuntimeError, match='podcast_feedback_context_insufficient'):
        fit_feedback(context, data, request_for(data), request_for)
    assert context.calls == []


def test_rewrite_still_runs_complete_source_and_whole_episode_reviews(monkeypatch):
    from backend.services import podcast_automatic as automatic
    context = Context()
    originals = [{'part_id': f'{i}:0', 'source_id': str(i), 'topic': f'Domain {i % 32}',
        'summary': 'Evidence', 'quote': 'Original evidence'} for i in range(254)]
    ledger = daily_data([])['subject_groups']
    outline = [{**g, 'part_ids': [f'{i}:0' for i in range(254) if i % 32 == index]}
               for index, g in enumerate(ledger)]
    complete = deepcopy(originals)
    source_reviews, whole_reviews = [], []
    issues = findings()
    def source_review(actual_context, evidence, narration, subjects):
        assert actual_context is context and evidence == complete
        assert subjects == [g['subjects'] for g in outline]
        assert len(narration.split()) == 1380
        source_reviews.append(narration)
        return issues if len(source_reviews) == 1 else []
    def whole_review(actual_context, data):
        assert actual_context is context and data['whole_episode'] is True
        whole_reviews.append(data)
        return []
    monkeypatch.setattr(automatic, '_review_theme', source_review)
    monkeypatch.setattr(automatic, '_audit', whole_review)
    sections, actual_outline, budget = write_day(context, originals, outline, lambda _: None)
    assert len(source_reviews) == len(whole_reviews) == 2
    assert originals == complete and actual_outline is outline and budget == 1380
    assert set(sections[0]['part_ids']) == {p['part_id'] for p in complete}
    writes = [d for q, d in context.calls if q.operation.endswith('write')]
    assert len(writes) == 2 and len(writes[-1]['feedback']['rows']) == len(issues)


def test_only_compacted_writer_requests_receive_new_transport_contract():
    from backend.services.podcast_automatic import _request
    context = Context()
    schema = {'type': 'object'}
    for phase in ['write', 'audit']:
        legacy = _request(context, phase, {'feedback': []}, schema)
        assert 'feedback_transport_contract' not in legacy.options
    data = {'feedback': {'encoding': 'finding_guidance_v1', 'rows': []}}
    assert 'feedback_transport_contract' in _request(context, 'write', data, schema).options
    assert 'feedback_transport_contract' not in _request(context, 'audit', data, schema).options


def test_guidance_schema_matches_the_serialized_byte_budget_for_its_entire_alphabet():
    from backend.services.podcast_feedback import _guidance_request
    context = Context()
    for budget in [1, 2, 4, 37, 160]:
        request = _guidance_request(context, [{'finding_id': 'finding:0', 'finding': findings(1)[0]}], budget)
        for point in range(32, 127):
            if point in (34, 92):
                continue
            text = chr(point) * budget
            value = {'guidance': {'finding:0': text}}
            jsonschema.validate(value, request.output_schema)
            assert len(json.dumps(json.dumps(text, ensure_ascii=False), ensure_ascii=False).encode()) - 6 == budget


@pytest.mark.parametrize('text', ['a' * 159 + '²', 'a' * 159 + 'é', 'a' * 159 + '"',
                                'a' * 159 + '\\', 'a' * 158 + '\n', 'a' * 159 + '\n', 'a\n', 'a\t', 'a\r', 'a\x00'])
def test_guidance_rejects_character_valid_but_wire_unsafe_guides(text):
    assert len(text) <= 160
    context = Context(text)
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        _write_request(context, daily_data(findings()), OPTIONS)
    assert all(q.operation.endswith('digest') for q, _ in context.calls)


def test_provider_pattern_enforces_length_without_relying_on_max_length():
    import re
    from backend.services.podcast_feedback import _guidance_request
    for budget in (1, 2, 37, 133, 160):
        request = _guidance_request(Context(), [{'finding_id': 'finding:0', 'finding': findings(1)[0]}], budget)
        definition = request.output_schema['properties']['guidance']['properties']['finding:0']
        assert definition['maxLength'] == budget
        assert re.fullmatch(definition['pattern'], 'A' * budget)
        assert not re.fullmatch(definition['pattern'], 'A' * (budget + 1))
        for length in (175, 163, 168, 143, 152, 165, 220, 199):
            assert bool(re.fullmatch(definition['pattern'], 'A' * length)) == (length <= budget)
