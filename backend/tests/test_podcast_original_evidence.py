"""A lossy source note cannot hide the original from automatic review and repair."""
import json
from types import SimpleNamespace

import pytest

from backend.services.podcast_automatic import _review_theme
from backend.services.podcast_review import _validate
from backend.tests.test_podcast_briefing import pipeline as pipeline, written


def test_originals_restore_lost_legal_outcome_and_causal_condition_automatically(pipeline):
    pipeline.monkeypatch.setattr('backend.services.agent_context_budget.count_tokens',
                                lambda text, _: SimpleNamespace(tokens=len(text) // 4))
    court = 'Closing a criminal case does not automatically establish shared custody.'
    payment = 'The law prevents transmitting sales income to the author.'
    sources = [
        {'id': 'court', 'title': 'Custody ruling', 'text': court},
        {'id': 'publisher', 'title': 'Books withdrawn', 'text': 'Publisher and author agreed the withdrawal. ' + payment},
        *[{'id': str(i), 'title': f'Development {i}', 'text': f'Development {i} has a distinct outcome.'}
          for i in range(18)],
    ]
    wrong = 'Closing a criminal case automatically establishes shared custody.'
    writes, reviews = [], []
    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if request.operation.endswith('briefs'):
            result = {'briefs': {p['part_id']: {'topic': p['title'], 'summary': p['text'],
                                              'quote': p['text'][:20]} for p in data['sources']}}
            for pid, summary in [('court:0', 'The court discusses shared custody.'),
                                 ('publisher:0', 'The publisher withdrew books because the law,')]:
                if pid in result['briefs']:
                    result['briefs'][pid]['summary'] = summary
        elif request.operation.endswith('write'):
            writes.append(data)
            assert all('source_text' not in b for b in data.get('briefs', data.get('digests', [])))
            if data['feedback']:
                assert {f['evidence_quote'] for f in data['feedback']} == {court, payment}
                narration = court + ' Publisher and author agreed the withdrawal. ' + payment
            else:
                narration = wrong + ' The publisher withdrew books.'
            narration += ' ' + ' '.join(source['text'] for source in sources[2:])
            narration += ' Context.' * (request.options['target_words'] - len(narration.split()))
            result = written(request, narration)
        elif request.operation.endswith('audit'):
            reviews.append(data)
            issues = []
            for brief in data.get('briefs', []):
                original = next(p['text'] for p in sources if brief['part_id'] == p['id'] + ':0')
                assert brief['source_text'] == original
                if brief['part_id'] == 'court:0' and data.get('review_focus') == 'fidelity' and wrong in data['narration']:
                    issues.append({'kind': 'distortion', 'detail': 'Custody is not automatic after closure.',
                                   'narration_quotes': [wrong], 'source_part_ids': ['court:0'], 'evidence_quote': court})
                if brief['part_id'] == 'publisher:0' and data.get('review_focus') == 'coverage' and payment not in data['narration']:
                    issues.append({'kind': 'omission', 'detail': 'Include the agreed withdrawal and payment constraint.',
                                   'narration_quotes': [], 'source_part_ids': ['publisher:0'], 'evidence_quote': payment})
            result = {'issues': issues}
        else:
            return pipeline.model(request, **kwargs)
        pipeline.calls.append({'task': request.operation, 'data': data})
        text = json.dumps(result);kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    narration = pipeline.run(sources)
    assert len(writes) == 2 and len(narration.split()) == 1380
    assert court in narration and payment in narration and wrong not in narration
    assert any('candidate_findings' in data for data in reviews)
    for focus in ('fidelity', 'coverage'):
        assert {b['part_id'] for data in reviews if data.get('review_focus') == focus
                for b in data['briefs']} == {p['id'] + ':0' for p in sources}


def test_missing_original_cannot_silently_approve_local_review():
    context = SimpleNamespace(originals={})
    with pytest.raises(ValueError, match='podcast_original_evidence_missing'):
        _review_theme(context, [{'part_id': 'a:0'}], 'A complete draft.', [['A']])
    for source in ({'part_id': 'a:0'}, {'part_id': 'a:0', 'source_text': ' '}):
        with pytest.raises(ValueError, match='podcast_audit_original_evidence_missing'):
            _validate({'issues': []}, {'briefs': [source], 'narration': 'A complete draft.'})


@pytest.mark.parametrize('quote', ['Unsupported summary claim.', 'Other source condition.'])
def test_notes_and_foreign_originals_cannot_ground_a_source_finding(quote):
    data = {'narration': 'The complete narration.', 'briefs': [
        {'part_id': 'a:0', 'summary': 'Unsupported summary claim.', 'source_text': 'The original condition.'},
        {'part_id': 'b:0', 'source_text': 'Other source condition.'}]}
    finding = {'kind': 'omission', 'detail': 'A material condition.', 'narration_quotes': [],
               'source_part_ids': ['a:0'], 'evidence_quote': quote}
    with pytest.raises(ValueError, match='podcast_audit_invented_evidence_quote'):
        _validate({'issues': [finding]}, data)
