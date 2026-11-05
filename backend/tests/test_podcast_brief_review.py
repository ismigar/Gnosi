"""Speech follows a successful review of the actual final narration."""
import copy
import json

import jsonschema
import pytest

from backend.services import podcast_automatic as automatic
from backend.services.podcast_policy import SKILL_ID
from backend.services.podcast_review import _schema
from backend.tests.test_podcast_briefing import diverse_sources, pipeline, written  # noqa: F401


def patch_response(request, before, after):
    data = json.loads(request.input)['data']
    if data.get('revision_encoding') == 'grounded_anchor_ids_v1':
        key = next(key for key, text in data['anchor_clauses'].items() if text == before)
        return {'draft_sha256': data['draft_sha256'],
            'finding_anchors': {'0': [key]},
            'changes': {anchor: after if anchor == key else None for anchor in data['anchor_clauses']}}
    return {'draft_sha256': data['draft_sha256'], 'edits': [
        {'before': before, 'after': after, 'finding_indices': [0]}]}


def brief_mode(pipeline):
    pipeline.snapshot.skill_instructions = {SKILL_ID:
        '```json\n{"podcast_preferences":{"review_mode":"brief"}}\n```'}


@pytest.mark.parametrize('kind', ['omission', 'distortion'])
def test_brief_finding_schema_requires_source_ids_and_evidence_before_quote_repair(kind):
    schema = _schema({'brief_review': True, 'briefs': [{'part_id': 's:0'}]})
    issue = {'kind': kind, 'detail': 'A material correction.', 'source_part_ids': ['s:0'],
             'evidence_quote': 'The original supporting text.',
             'narration_quotes': [] if kind == 'omission' else ['An actual narration passage.']}
    jsonschema.validate({'issues': [issue]}, schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({'issues': [{**issue, 'source_part_ids': []}]}, schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({'issues': [{**issue, 'evidence_quote': ''}]}, schema)


def test_brief_quote_repair_never_joins_different_source_fields():
    from backend.services.podcast_audit_repair import audit_quote_repair
    summary = 'The proposal remains conditional on a future decision.'
    quote = 'Exact separate wording from the author.'
    data = {'narration': 'An actual complete narration.', 'briefs': [{'part_id': 's:0',
        'title': 'Original source title.', 'source_text': summary, 'source_quote': quote}]}
    schema = _schema({'brief_review': True, 'briefs': data['briefs']})
    issue = {'kind': 'omission', 'detail': 'A qualified topic is missing.',
             'source_part_ids': ['s:0'], 'evidence_quote': 'Invented translated evidence.', 'narration_quotes': []}
    repair = audit_quote_repair(data, schema)(json.dumps({'issues': [issue]}),
        ValueError('podcast_audit_invented_evidence_quote'))
    payload = json.loads(repair.input)
    pool = payload['quote_pools']['evidence:0']
    assert all(any(option['text'] in text for text in (summary, quote, 'Original source title.'))
               for option in pool.values())
    selected = next(key for key, option in pool.items() if option['text'] == quote)
    restored = json.loads(repair.restore(json.dumps({'quote_ids': {'issue:0:evidence': selected}})))
    assert restored['issues'][0]['evidence_quote'] == quote


def test_brief_mode_reviews_all_sources_once_without_fragment_rounds(pipeline):
    brief_mode(pipeline)
    pipeline.monkeypatch.setattr(automatic, '_review_theme', lambda *a: pytest.fail('Fragment audit'))
    pipeline.monkeypatch.setattr(automatic, '_audit', lambda *a: pytest.fail('Repeated ledger audit'))
    script = pipeline.run(diverse_sources())
    audits = [c['data'] for c in pipeline.calls if c['task'].endswith('audit')]
    assert len(audits) == 1 and audits[0]['brief_review'] is True
    source_parts = {p['part_id'] for c in pipeline.calls if c['task'].endswith('briefs') for p in c['data']['sources']}
    supplied = {identifier for b in audits[0]['source_summaries'] for identifier in b.get('part_ids', [b.get('part_id')])}
    assert supplied == source_parts
    assert all(source['title'] in script for source in diverse_sources())
    report = pipeline.saved['podcast-coverage-report']
    from backend.services.podcast_brief_review import policy_revision
    assert report['review'] == {'mode': 'brief', 'semantic_reviews': 1,
        'automatic_correction_applied': False, 'original_fragment_audit': False,
        'final_narration_validated': True, 'policy_revision': policy_revision()}


def test_brief_findings_trigger_one_correction_and_review_of_the_corrected_text(pipeline):
    brief_mode(pipeline)
    seen = []

    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if request.operation.endswith('audit'):
            seen.append(copy.deepcopy(data))
            record = data['source_summaries'][0]
            result = {'issues': [] if data['narration'].startswith('Correct attribution.') else [
                {'kind': 'distortion', 'detail': 'Correct the inaccurate attribution.',
                'narration_quotes': ['Inaccurate attribution'], 'source_part_ids': [record['part_id']],
                'evidence_quote': record['quote']}]}
        elif request.operation.endswith('write'):
            if data.get('revision_encoding') in {'grounded_edits_v1', 'grounded_anchor_ids_v1'}:
                result = patch_response(request, 'Inaccurate attribution.', 'Correct attribution.')
            else:
                text = 'Inaccurate attribution.' + ' Context.' * request.options['min_words']
                result = written(request, text)
        else:
            return pipeline.model(request, **kwargs)
        text = json.dumps(result)
        kwargs['output_validator'](text)
        from types import SimpleNamespace
        return SimpleNamespace(result=text)

    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    script = pipeline.run([{'id': 'a', 'title': 'Source', 'text': 'The original attribution is clear.'}])
    assert script.startswith('Correct attribution.')
    assert len(seen) == 2 and seen[1]['narration'] == script
    report = pipeline.saved['podcast-coverage-report']
    assert report['review']['automatic_correction_applied'] is True
    assert report['review']['original_fragment_audit'] is False
    assert report['review']['semantic_reviews'] == 2
    assert report['review']['final_narration_validated'] is True


def test_new_error_introduced_by_a_correction_cannot_reach_speech(pipeline):
    from types import SimpleNamespace
    brief_mode(pipeline)
    reviews = []

    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if request.operation.endswith('audit'):
            reviews.append(data['narration'])
            record = data['source_summaries'][0]
            quote = 'Initial error.' if len(reviews) == 1 else 'New error.'
            result = {'issues': [{'kind': 'distortion', 'detail': 'A factual error remains.',
                'narration_quotes': [quote], 'source_part_ids': [record['part_id']],
                'evidence_quote': record['quote']}]}
        elif request.operation.endswith('write'):
            if data.get('revision_encoding') in {'grounded_edits_v1', 'grounded_anchor_ids_v1'}:
                result = patch_response(request, 'Initial error.', 'New error.')
            else:
                result = written(request, 'Initial error.' + ' Context.' * request.options['min_words'])
        else:
            return pipeline.model(request, **kwargs)
        text = json.dumps(result);kwargs['output_validator'](text)
        return SimpleNamespace(result=text)

    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(ValueError, match='podcast_final_narration_review_failed'):
        pipeline.run([{'id': 'a', 'title': 'Source', 'text': 'The original evidence is clear.'}])
    assert len(reviews) == 2 and reviews[1].startswith('New error.')
    assert 'podcast-coverage-report' not in pipeline.saved


def test_legacy_unchecked_script_is_revalidated_without_rewriting_prepared_work(pipeline):
    brief_mode(pipeline)
    sources = diverse_sources()
    script = pipeline.run(sources)
    pipeline.saved['podcast-coverage-report']['review'].pop('final_narration_validated')
    original = automatic.resource
    pipeline.monkeypatch.setattr(automatic, 'resource', lambda path:
        original(path) + ('\nUpdated final review.' if path.endswith('/brief-review-contract.md') else ''))
    before = len(pipeline.calls)
    assert pipeline.run(sources) == script
    fresh = pipeline.calls[before:]
    assert len(fresh) == 1 and fresh[0]['task'].endswith('audit')
    assert fresh[0]['data']['narration'] == script
    assert pipeline.saved['podcast-coverage-report']['review']['final_narration_validated'] is True


def test_model_change_reuses_only_briefs_bound_to_identical_complete_sources(pipeline):
    brief_mode(pipeline)
    sources = diverse_sources()
    script = pipeline.run(sources)
    original_briefs = copy.deepcopy(pipeline.saved['podcast-coverage-report']['briefs'])
    pipeline.saved['podcast-coverage-report']['review'].pop('final_narration_validated')
    pipeline.snapshot.profile['model'] = 'new-model'
    pipeline.snapshot.revision = 'new-model-revision'
    before = len(pipeline.calls)
    assert pipeline.run(sources) == script
    fresh = pipeline.calls[before:]
    assert len(fresh) == 1 and fresh[0]['task'].endswith('audit')
    assert fresh[0]['data']['source_summaries'] == original_briefs

    # Even when titles, part IDs and early literal quotations still match,
    # changed original content must invalidate the prepared summaries.
    changed = copy.deepcopy(sources)
    changed[0]['text'] += ' New material development.'
    before = len(pipeline.calls)
    pipeline.run(changed)
    assert any(c['task'].endswith('briefs') for c in pipeline.calls[before:])


@pytest.mark.parametrize('bad_quote', ['narration', 'evidence', 'source'])
def test_brief_review_rejects_invented_grounding_before_publication(pipeline, bad_quote):
    brief_mode(pipeline)

    def model(request, **kwargs):
        if not request.operation.endswith('audit'):
            return pipeline.model(request, **kwargs)
        data = json.loads(request.input)['data'];record = data['source_summaries'][0]
        result = {'issues': [{'kind': 'distortion', 'detail': 'A proposed correction',
            'narration_quotes': ['Invented narration' if bad_quote == 'narration' else data['narration'][:30]],
            'source_part_ids': ['foreign:0' if bad_quote == 'source' else record['part_id']],
            'evidence_quote': 'Invented evidence' if bad_quote == 'evidence' else record['quote']}]}
        text = json.dumps(result);kwargs['output_validator'](text)
        from types import SimpleNamespace
        return SimpleNamespace(result=text)

    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        pipeline.run([{'id': 'a', 'title': 'Source', 'text': 'The original attribution is clear.'}])
    assert 'podcast-coverage-report' not in pipeline.saved


def test_default_and_explicit_full_mode_remain_distinct(pipeline):
    from backend.services.podcast_policy import preferences
    assert preferences(None).review_mode == 'brief'
    assert preferences(pipeline).review_mode == 'full'


def test_updated_planning_and_review_policy_cannot_replay_cached_approval(pipeline):
    """Exercise policy cache boundaries, not a fake model's semantic judgment."""
    from backend.services import podcast_outline
    brief_mode(pipeline)
    sources = diverse_sources()
    pipeline.run(sources)
    before = copy.deepcopy(pipeline.calls)
    original = automatic.resource
    def changed(path):
        text = original(path)
        return text + '\nUpdated coverage policy.' if path.endswith((
            '/assignment-contract.md', '/brief-review-contract.md')) else text
    pipeline.monkeypatch.setattr(automatic, 'resource', changed)
    pipeline.monkeypatch.setattr(podcast_outline, 'resource', changed)
    pipeline.run(sources)
    fresh = pipeline.calls[len(before):]
    assert not any(call['task'].endswith('briefs') for call in fresh)
    assert sum(call['task'].endswith('plan') for call in fresh) == 1
    audits = [call for call in fresh if call['task'].endswith('audit')]
    assert len(audits) == 1
    previous = next(call for call in before if call['task'].endswith('audit'))
    assert audits[0]['data'] == previous['data']
    assert audits[0]['_options']['automatic_contract'] != previous['_options']['automatic_contract']
    assert audits[0]['_timeout'] == previous['_timeout'] == 300
    assert audits[0]['_schema'] == previous['_schema']


def test_initial_bound_repair_still_reviews_the_whole_original_day(pipeline):
    from types import SimpleNamespace
    brief_mode(pipeline)
    writes, audits = [], []
    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if request.operation.endswith('write'):
            writes.append(copy.deepcopy(data))
            rejected = written(request, ' '.join(['Context.'] * (request.options['max_words'] + 100)))
            with pytest.raises((ValueError, jsonschema.ValidationError)):
                kwargs['output_validator'](json.dumps(rejected))
            # Simulate the executor's ordinary schema repair with the same input.
            writes.append(copy.deepcopy(data))
            result = written(request, ' '.join(['Context.'] * request.options['min_words']))
        elif request.operation.endswith('audit'):
            audits.append(copy.deepcopy(data))
            result = {'issues': []}
        else:
            return pipeline.model(request, **kwargs)
        text = json.dumps(result);kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    pipeline.run(diverse_sources())
    assert len(writes) == 2 and writes[0] == writes[1]
    assert writes[0]['composition_encoding'] == 'bounded_narration_v1'
    assert 'length_repair' not in writes[0]
    assert len(audits) == 1 and audits[0]['brief_review'] is True
    assert audits[0]['source_summaries'] == writes[0]['briefs']
    assert audits[0]['subjects'] == [group['subjects'] for group in writes[0]['subject_groups']]
    report = pipeline.saved['podcast-coverage-report']
    assert report['review']['semantic_reviews'] == 1 and report['review']['mode'] == 'brief'
    assert {brief['part_id'] for brief in audits[0]['source_summaries']} == {
        brief['part_id'] for brief in report['briefs']}
