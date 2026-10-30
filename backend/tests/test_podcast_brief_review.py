"""The normal generator performs one day-wide review and proceeds to speech."""
import copy
import json

import jsonschema
import pytest

from backend.services import podcast_automatic as automatic
from backend.services.podcast_policy import SKILL_ID
from backend.tests.test_podcast_briefing import diverse_sources, pipeline, written  # noqa: F401


def brief_mode(pipeline):
    pipeline.snapshot.skill_instructions = {SKILL_ID:
        '```json\n{"podcast_preferences":{"review_mode":"brief"}}\n```'}


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
    assert report['review'] == {'mode': 'brief', 'semantic_reviews': 1,
        'automatic_correction_applied': False, 'original_fragment_audit': False}


def test_brief_findings_trigger_one_corrective_write_without_more_reviews(pipeline):
    brief_mode(pipeline)
    seen = []

    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if request.operation.endswith('audit'):
            seen.append(copy.deepcopy(data))
            record = data['source_summaries'][0]
            result = {'issues': [{'kind': 'distortion', 'detail': 'Correct the inaccurate attribution.',
                'narration_quotes': ['Inaccurate attribution'], 'source_part_ids': [record['part_id']],
                'evidence_quote': record['quote']}]}
        elif request.operation.endswith('write'):
            if data.get('revision_encoding') == 'grounded_edits_v1':
                result = {'draft_sha256': data['draft_sha256'], 'edits': [{
                    'before': 'Inaccurate attribution.', 'after': 'Correct attribution.',
                    'finding_indices': [0]}]}
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
    assert len(seen) == 1
    report = pipeline.saved['podcast-coverage-report']
    assert report['review']['automatic_correction_applied'] is True
    assert report['review']['original_fragment_audit'] is False


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
