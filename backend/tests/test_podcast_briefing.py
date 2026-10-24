"""Stateless-model regressions for retention, whole-day coverage and durable retries."""
import copy
import json
from types import SimpleNamespace

import pytest

from backend.services import podcast_briefing as briefing


def planned(cards, groups):
    from backend.services.podcast_outline import MAX_TOPICS
    limit = min(MAX_TOPICS, len(cards))
    labels = [g['topic'] for g in groups]
    labels.extend(f'Unused {i}' for i in range(limit - len(labels)))
    return {'topics': labels, 'assignments': {handle: index for index, group in enumerate(groups)
        for handle in group['part_ids']}}


@pytest.fixture
def pipeline(monkeypatch):
    saved, calls = {}, []
    snapshot = SimpleNamespace(profile={}, instructions=[], behavior_resources={}, origin='button',
                               parent_run_id='day', revision='new-contract', scope='owner')
    monkeypatch.setattr('backend.domains.agent.runtime_tools._model_context_window', lambda *_: 32000)
    monkeypatch.setattr('backend.services.agent_context_budget.count_tokens', lambda text, _: SimpleNamespace(tokens=len(text)))
    def checkpoint(scope, parent, key, value=None):
        assert scope == 'owner' and parent == 'day'
        if value is not None:
            saved[key] = copy.deepcopy(value)
        return copy.deepcopy(saved.get(key))
    monkeypatch.setattr('backend.services.agent_execution_store.work_checkpoint', checkpoint)
    def model(request, **kwargs):
        payload = json.loads(request.input)
        payload['_options'] = request.options
        payload['_timeout'] = request.timeout_seconds
        payload['_schema'] = request.output_schema
        calls.append(payload)
        data = payload['data']
        if payload['task'].endswith('briefs'):
            result = {'briefs': {p['part_id']: {'topic': p['title'],
                'summary': f"{p['title']}: {p['text'][-70:]}", 'quote': p['text'][:60]} for p in data['sources']}}
        elif payload['task'].endswith('plan'):
            groups = {}
            for index, card in enumerate(data['cards']):
                key = card['topic'] if len(data['cards']) <= 12 else str(index % 10)
                group = groups.setdefault(key, {'topic': key, 'part_ids': []})
                group['part_ids'].extend(card['part_ids'])
            result = planned(data['cards'], list(groups.values()))
        elif payload['task'].endswith('audit'):
            result = {'issues': []}
        elif payload['task'].endswith('digest'):
            ids = [identifier for r in data['briefs'] for identifier in r.get('part_ids', [r.get('part_id')])]
            text = ' '.join(r.get('summary', '') if 'part_ids' in r else r['title'] for r in data['briefs'])
            result = {'sections': [{'topic': 'Complete evidence', 'part_ids': ids, 'narration': text}]}
        else:
            briefs = data.get('briefs', data.get('digests', []))
            text = ' '.join(b['summary'] if 'part_ids' in b else f"{b['title']}: {b['summary'][-55:]}" for b in briefs)
            words = text.split()
            minimum = request.options.get('min_words', 0)
            text += ' Context.' * max(0, minimum - len(words))
            result = {'narration': text.strip()}
        text = json.dumps(result)
        kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    def run(sources, guard=lambda: None):
        return briefing.build_podcast_script(sources, 'Catalan', snapshot=snapshot,
                                             check_active=guard, progress=lambda _: None)
    return SimpleNamespace(run=run, model=model, calls=calls, saved=saved, monkeypatch=monkeypatch)


def diverse_sources():
    return [{'id': str(i), 'title': topic, 'text': f'{topic} original evidence. ' + 'Context ' * 500 + f' Final qualification {topic}.'}
            for i, topic in enumerate(['Habitatge', 'Clima', 'Salut', 'Religió', 'Cultura', 'Treball'])]


def test_stateless_model_sees_all_batches_again_in_final_briefing(pipeline):
    sources = diverse_sources()
    pipeline.saved['document:old-delivery-only'] = {'completed': {'result': {'narration': 'Last two topics'}}}
    narration = pipeline.run(sources)
    extraction = [c['data']['sources'] for c in pipeline.calls if c['task'].endswith('briefs')]
    assert len(extraction) > 1
    delivered = [p for batch in extraction for p in batch]
    for source in sources:
        assert ''.join(p['text'] for p in delivered if p['source_id'] == source['id']) == source['text']
    final = [b for c in pipeline.calls if c['task'].endswith('write') for b in c['data']['briefs']]
    assert {b['part_id'] for b in final} == {p['part_id'] for p in delivered}
    assert {b['source_id'] for b in final} == {s['id'] for s in sources}
    assert all(s['title'] in narration for s in sources)
    assert 'Final qualification Treball.' in narration
    assert 'INTERNAL' not in narration
    report = pipeline.saved['podcast-coverage-report']
    assert len(report['article_ids']) == 6
    assert report['parts'] == len(delivered) == len(final)
    count = len(pipeline.calls)
    assert pipeline.run(sources) == narration
    assert len(pipeline.calls) == count


def test_resume_reuses_validated_briefs_without_losing_early_topics(pipeline):
    def interrupted(request, **kwargs):
        if len(pipeline.calls) == 1:
            raise RuntimeError('interrupted')
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', interrupted)
    with pytest.raises(RuntimeError, match='interrupted'):
        pipeline.run(diverse_sources())
    first_batch = pipeline.calls[0]['data']['sources']
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', pipeline.model)
    narration = pipeline.run(diverse_sources())
    assert sum(c['data'].get('sources') == first_batch for c in pipeline.calls) == 1
    assert 'Habitatge' in narration and 'Treball' in narration


@pytest.mark.parametrize('invalid', ['missing', 'foreign', 'empty', 'invented_quote'])
def test_bad_briefs_never_reach_checkpoint_or_narration(pipeline, invalid):
    def model(request, **kwargs):
        part = json.loads(request.input)['data']['sources'][0]
        record = {'topic': 'Topic', 'summary': 'Actual evidence', 'quote': 'Actual evidence'}
        result = {part['part_id']: record}
        if invalid == 'missing':
            result = {}
        elif invalid == 'foreign':
            result['foreign:0'] = record
        elif invalid == 'empty':
            record['summary'] = ' '
        else:
            record['quote'] = 'Invented words'
        return SimpleNamespace(result=json.dumps({'briefs': result}))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises((ValueError, briefing.jsonschema.ValidationError)):
        pipeline.run([{'id': '1', 'title': 'Title', 'text': 'Actual evidence'}])
    assert pipeline.saved == {}


@pytest.mark.parametrize('ids', [['0:0'], ['0:0', '0:0', '1:0'], ['0:0', 'foreign:0']])
def test_final_sections_cannot_drop_duplicate_or_invent_sources(pipeline, ids):
    def model(request, **kwargs):
        if request.operation.endswith('briefs'):
            return pipeline.model(request, **kwargs)
        return SimpleNamespace(result=json.dumps({'sections': [{'topic': 'Only two themes',
            'part_ids': ids, 'narration': 'Narrow story.'}]}))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises((ValueError, briefing.jsonschema.ValidationError)):
        pipeline.run([{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(2)])
    assert 'podcast-coverage-report' not in pipeline.saved


def test_collection_exceeding_one_context_is_composed_from_bounded_complete_digests(pipeline):
    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if request.operation.endswith('briefs'):
            result = {'briefs': {p['part_id']: {'topic': p['title'], 'summary': 'Long summary ' * 30,
                'quote': p['text']} for p in data['sources']}}
            return SimpleNamespace(result=json.dumps(result))
        if request.operation.endswith(('plan', 'audit')):
            return pipeline.model(request, **kwargs)
        assert len(data.get('briefs', data.get('digests', []))) <= 16, 'Oversized request must not be sent'
        assert briefing._Briefing.cost(SimpleNamespace(count=len), request) <= 21952
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    narration = pipeline.run([{'id': str(i), 'title': f'Topic {i}.', 'text': f'Evidence {i}'} for i in range(70)])
    groups = [c for c in pipeline.calls if c['task'].endswith('write')]
    assert len(groups) == 1 and groups[0]['data']['digests']
    assert {p for d in groups[0]['data']['digests'] for p in d['part_ids']} == {f'{i}:0' for i in range(70)}
    assert all(f'Topic {i}.' in narration for i in range(70))
    assert pipeline.saved['podcast-coverage-report']['narration_segments'] == len(groups)


def test_interrupted_narration_resumes_every_segment_without_repeating_extraction(pipeline):
    sources = [{'id': str(i), 'title': f'Topic {i}.', 'text': f'Evidence {i}'} for i in range(40)]
    def interrupted(request, **kwargs):
        if request.operation.endswith('audit'):
            raise RuntimeError('narration interrupted')
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', interrupted)
    with pytest.raises(RuntimeError, match='narration interrupted'):
        pipeline.run(sources)
    assert len([c for c in pipeline.calls if c['task'].endswith('briefs')]) == 5
    assert len([c for c in pipeline.calls if c['task'].endswith('write')]) == 1
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', pipeline.model)
    narration = pipeline.run(sources)
    assert len([c for c in pipeline.calls if c['task'].endswith('briefs')]) == 5
    assert all(f'Topic {i}.' in narration for i in range(40))
    assert pipeline.saved['podcast-coverage-report']['narration_segments'] == 1


def test_resumed_old_snapshot_gets_explicit_segment_contract_and_continuity(pipeline):
    from backend.services.agent_behavior import frozen_resources
    token = frozen_resources.set({'operations/podcast/SKILL.md': 'Legacy global synthesis and short duration.'})
    try:
        pipeline.run([{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(40)])
    finally:
        frozen_resources.reset(token)
    groups = [c for c in pipeline.calls if c['task'].endswith('write')]
    assert [c['_options']['episode_opening'] for c in groups] == [True]
    assert [c['_options']['episode_closing'] for c in groups] == [True]
    assert all('server owns source membership' in c['_options']['automatic_contract'] for c in groups)
    assert all(c['_options']['max_words'] > c['_options']['min_words'] > 0 and c['_timeout'] == 300 for c in groups)
    assert all(c['_options'] == {} and c['_timeout'] == 300 for c in pipeline.calls if c['task'].endswith('briefs'))


def test_cancellation_is_checked_even_when_all_briefs_are_cached(pipeline):
    sources = [{'id': '1', 'title': 'Title', 'text': 'Actual evidence'}]
    pipeline.run(sources)
    def cancelled():
        raise PermissionError('scope changed or cancelled')
    with pytest.raises(PermissionError, match='scope changed'):
        pipeline.run(sources, cancelled)


def test_extraction_bounds_each_call_without_dropping_sources(pipeline):
    sources = [{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(25)]
    pipeline.run(sources)
    batches = [c['data']['sources'] for c in pipeline.calls if c['task'].endswith('briefs')]
    assert len(batches) == 4
    assert all(len(batch) <= 8 for batch in batches)
    assert [p['source_id'] for batch in batches for p in batch] == [s['id'] for s in sources]


def test_exact_quote_from_original_title_is_valid_source_evidence(pipeline):
    def model(request, **kwargs):
        if not request.operation.endswith('briefs'):
            return pipeline.model(request, **kwargs)
        part = json.loads(request.input)['data']['sources'][0]
        return SimpleNamespace(result=json.dumps({'briefs': {part['part_id']: {
            'topic': 'Sports', 'summary': 'The athlete arrives to receive the award.',
            'quote': 'His father was excited about the award'}}}))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    narration = pipeline.run([{'id': '691', 'title': 'His father was excited about the award',
                              'text': 'The athlete arrived in Oviedo and met supporters.'}])
    assert 'The athlete arrives to receive the award.' in narration
    assert pipeline.saved['podcast-coverage-report']['article_ids'] == ['691']


def test_distant_duplicate_reports_share_global_theme_and_minor_topics_keep_space(pipeline):
    sources = [{'id': str(i), 'title': 'Repeated event' if i % 2 == 0 else f'Minor {i}',
                'text': f'Evidence {i}'} for i in range(20)]
    def model(request, **kwargs):
        if request.operation.endswith('plan'):
            cards = json.loads(request.input)['data']['cards']
            groups = {}
            for card in cards:
                label = 'Repeated event' if card['topic'] == 'Repeated event' else 'Minor roundup'
                groups.setdefault(label, {'topic': label, 'part_ids': []})['part_ids'].extend(card['part_ids'])
            text = json.dumps(planned(cards, list(groups.values())))
            kwargs['output_validator'](text)
            return SimpleNamespace(result=text)
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    text = pipeline.run(sources)
    groups = [c['data']['briefs'] for c in pipeline.calls if c['task'].endswith('write')]
    assert len(groups) == 1
    assert {b['source_id'] for b in groups[0]} == {str(i) for i in range(20)}
    duplicate_group = next(t for t in pipeline.saved['podcast-coverage-report']['outline'] if t['topic'] == 'Repeated event')
    assert set(duplicate_group['part_ids']) == {f'{i}:0' for i in range(0, 20, 2)}
    assert all(f'Minor {i}' in text for i in range(1, 20, 2))
    assert 1200 <= len(text.split()) <= 1510
    assert pipeline.saved['podcast-coverage-report']['word_budget'] == 1380


@pytest.mark.parametrize('words', [1, 5000])
def test_unbounded_model_output_is_rejected_before_publishing_or_caching(pipeline, words):
    def model(request, **kwargs):
        if not request.operation.endswith('write'):
            return pipeline.model(request, **kwargs)
        briefs = json.loads(request.input)['data']['briefs']
        return SimpleNamespace(result=json.dumps({'narration': 'word ' * words}))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(ValueError, match='podcast_word_budget'):
        pipeline.run([{'id': 'a', 'title': 'Title', 'text': 'Evidence'}])
    assert 'podcast-coverage-report' not in pipeline.saved
    assert not any('narration' in checkpoint['result'] for checkpoint in pipeline.saved.values())


def test_word_count_failure_is_repaired_automatically_without_caching_invalid_prose(pipeline):
    writes = []
    def model(request, **kwargs):
        if not request.operation.endswith('write'):
            return pipeline.model(request, **kwargs)
        data = json.loads(request.input)['data']
        writes.append(data)
        if 'previous_draft' not in data:
            text = json.dumps({'narration': 'word ' * (request.options['max_words'] + 2)})
            kwargs['output_validator'](text)
        assert data['length_repair']['current_words'] == request.options['max_words'] + 2
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    result = pipeline.run([{'id': 'a', 'title': 'Title', 'text': 'Evidence'}])
    assert len(writes) == 2 and 'previous_draft' in writes[-1]
    assert len(result.split()) <= 174
    assert all(len(v['result']['narration'].split()) <= 174 for v in pipeline.saved.values()
               if 'narration' in v.get('result', {}))


def test_length_repair_rebudgets_near_limit_without_discarding_source_evidence():
    from backend.services.podcast_automatic import _bounded_write
    requests = []
    class Context:
        budget = 2000
        def request(self, task, data, schema):
            return briefing.AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
                input=json.dumps(data), output_schema=schema)
        def cost(self, request):
            return 1950 if 'previous_draft' not in json.loads(request.input) else 2500
        def stage(self, request, validate):
            assert self.cost(request) <= self.budget
            data = json.loads(request.input)
            requests.append(data)
            result = {'narration': 'word ' * (127 if len(requests) == 1 else 115)}
            validate(result)
            return result
    evidence = [{'part_id': 'a:0', 'summary': 'Evidence'}]
    result = _bounded_write(Context(), {'briefs': evidence, 'feedback': []},
                            {'min_words': 104, 'max_words': 125, 'target_words': 115})
    assert len(result['narration'].split()) == 115 and len(requests) == 2
    assert all(r['briefs'] == evidence for r in requests)
    assert requests[-1]['length_repair']['mode'] == 'fresh_composition'
    assert 'word_delta' not in requests[-1]['length_repair']
    assert 'previous_draft' not in requests[-1]


def test_full_episode_has_one_shared_budget_and_all_subject_groups(pipeline):
    pipeline.run([{'id': str(i), 'title': f'Subject {i}', 'text': 'Evidence'} for i in range(40)])
    writes = [c for c in pipeline.calls if c['task'].endswith('write')]
    assert len(writes) == 1 and writes[0]['_options']['target_words'] == 1380
    assert len(writes[0]['data']['subject_groups']) > 1
    assert {b['source_id'] for b in writes[0]['data']['briefs']} == {str(i) for i in range(40)}
    assert {x for t in writes[0]['data']['subject_groups'] for x in t['subjects']} == {f'Subject {i}' for i in range(40)}


def test_oversized_theme_uses_recursive_bounded_digests_without_losing_ids():
    from backend.services.podcast_outline import narrate_day
    calls = []
    class Context:
        budget = 22000
        def request(self, task, data, schema):
            return briefing.AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
                input=json.dumps(data), output_schema=schema)
        def cost(self, request):
            return len(briefing.operation_input(request)) + 1024
        def stage(self, request, validate):
            assert self.cost(request) <= self.budget
            data = json.loads(request.input)
            calls.append(request.operation)
            if request.operation.endswith('plan'):
                result = planned(data['cards'], [{'topic': 'Complete collection',
                    'part_ids': [p for c in data['cards'] for p in c['part_ids']]}])
            elif request.operation.endswith('audit'):
                result = {'issues': []}
            else:
                records = data.get('briefs', data.get('digests'))
                ids = [p for r in records for p in r.get('part_ids', [r.get('part_id')])]
                words = 160 if request.operation.endswith('digest') else request.options['min_words']
                result = ({'narration': 'evidence ' * words} if request.operation.endswith('write') else
                    {'sections': [{'topic': 'Complete collection', 'part_ids': ids, 'narration': 'evidence ' * words}]})
            briefing.jsonschema.validate(result, request.output_schema)
            validate(result)
            return result
    briefs = [{'part_id': f'{i}:0', 'source_id': str(i), 'title': 'Title',
               'topic': 'Shared issue', 'summary': 'Evidence ' * 45, 'quote': 'Exact quote'} for i in range(110)]
    sections, outline, budget = narrate_day(Context(), briefs, lambda _: None)
    assert calls.count('podcast.coverage.digest') > 14  # More than one reduction level.
    assert {p for s in sections for p in s['part_ids']} == {b['part_id'] for b in briefs}
    assert budget == 1380 and 1200 < sum(len(s['narration'].split()) for s in sections) < 1510


def test_planning_never_asks_model_to_classify_or_repeat_hundreds_of_source_ids(pipeline):
    sources = [{'id': f'article-original-id-{i}', 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(110)]
    text = pipeline.run(sources)
    plans = [c for c in pipeline.calls if c['task'].endswith('plan')]
    assert len(plans) >= 4
    assert all(len(c['data']['cards']) <= 48 for c in plans)
    assert all(len(card['part_ids']) == 1 and card['part_ids'][0].startswith('card:')
               for c in plans for card in c['data']['cards'])
    assert all(f'Topic {i}' in text for i in range(110))
    report = pipeline.saved['podcast-coverage-report']
    assert {p for g in report['outline'] for p in g['part_ids']} == {f'{s["id"]}:0' for s in sources}


def test_automatic_audit_repairs_source_note_and_request_certainty_without_manual_input(pipeline):
    writes = []
    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if request.operation.endswith('write'):
            writes.append(data)
            wrong = not data['feedback']
            text = ('The requested extension was granted. Source has no text.' if wrong else
                    'The party requests an extension; no ruling is reported.')
            text += ' Context.' * (request.options['min_words'] - len(text.split()))
            result = {'narration': text}
        elif request.operation.endswith('audit') and data.get('review_focus') == 'fidelity':
            result = {'issues': [{'kind': 'distortion', 'detail': 'Requested is not granted; remove spoken source-access note.',
                       'narration_quotes': ['The requested extension was granted.'],
                       'source_part_ids': [data['briefs'][0]['part_id']],
                       'evidence_quote': 'The party requests an extension.'}]
                      if 'was granted' in data['narration'] else []}
        else:
            return pipeline.model(request, **kwargs)
        text = json.dumps(result);kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    text = pipeline.run([{'id': 'a', 'title': 'Extension request', 'text': 'The party requests an extension.'}])
    assert len(writes) == 2 and writes[1]['feedback']
    assert 'was granted' not in text and 'Source has no text' not in text
    assert 'requests an extension' in text
    assert pipeline.saved['podcast-coverage-report']['pipeline'] == 'automatic-narration-v2'


def test_unresolved_semantic_failure_never_publishes_coverage_report(pipeline):
    def model(request, **kwargs):
        if not request.operation.endswith('audit'):
            return pipeline.model(request, **kwargs)
        data = json.loads(request.input)['data']
        if data.get('review_focus') != 'coverage':
            return pipeline.model(request, **kwargs)
        text = json.dumps({'issues': [{'kind': 'omission', 'detail': 'Distinct minority subject is absent.',
            'narration_quotes': [], 'source_part_ids': [data['briefs'][0]['part_id']],
            'evidence_quote': data['briefs'][0]['quote']}]})
        kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(ValueError, match='podcast_semantic_review_failed'):
        pipeline.run([{'id': 'a', 'title': 'Minority topic', 'text': 'Actual evidence.'}])
    assert 'podcast-coverage-report' not in pipeline.saved


def test_writer_schema_is_narration_only_and_planning_retains_every_child_subject(pipeline):
    sources = [{'id': str(i), 'title': f'Minority topic {i}', 'text': f'Evidence {i}'} for i in range(110)]
    pipeline.run(sources)
    report = pipeline.saved['podcast-coverage-report']
    assert {s for g in report['outline'] for s in g['subjects']} == {s['title'] for s in sources}
    for call in pipeline.calls:
        if call['task'].endswith('write'):
            assert 'automatic_contract' in call['_options']
            assert set(call['_schema']['properties']) == {'narration'}
    assert any(c['task'].endswith('audit') and c['data'].get('whole_episode') for c in pipeline.calls)


@pytest.mark.parametrize('bad', ['missing', 'foreign', 'outside', 'old_list'])
def test_routing_requires_exactly_one_typed_assignment_for_every_source(pipeline, bad):
    def model(request, **kwargs):
        if not request.operation.endswith('plan'):
            return pipeline.model(request, **kwargs)
        cards = json.loads(request.input)['data']['cards']
        result = planned(cards, [{'topic': 'Daily subjects', 'part_ids': [c['part_ids'][0] for c in cards]}])
        if bad == 'missing':
            result['assignments'].pop(cards[-1]['part_ids'][0])
        elif bad == 'foreign':
            result['assignments']['foreign'] = 0
        elif bad == 'outside':
            result['assignments'][cards[0]['part_ids'][0]] = 12
        else:
            result = {'topics': [{'topic': 'News', 'part_ids': ['card:0', 'card:0']}]}
        return SimpleNamespace(result=json.dumps(result))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(briefing.jsonschema.ValidationError):
        pipeline.run([{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(3)])
    assert 'podcast-coverage-report' not in pipeline.saved


@pytest.mark.parametrize('changed', ['narration', 'evidence', 'confirmation'])
def test_audit_cannot_invent_quoted_passages_or_change_confirmed_finding(changed):
    from backend.services.podcast_review import _validate
    data = {'narration': 'The party requests an extension.', 'briefs': [
        {'part_id': 'a:0', 'quote': 'The party requests an extension.'}]}
    finding = {'kind': 'distortion', 'detail': 'Check certainty.',
               'narration_quotes': ['The party requests an extension.'],
               'source_part_ids': ['a:0'], 'evidence_quote': 'The party requests an extension.'}
    if changed == 'narration':
        finding['narration_quotes'] = ['Rosalia performs amid smoke and gunfire.']
    elif changed == 'evidence':
        finding['evidence_quote'] = 'A ruling granted the extension.'
    else:
        data['candidate_findings'] = []
    with pytest.raises(ValueError, match='podcast_audit_'):
        _validate({'issues': [finding]}, data)


def test_false_absence_claim_is_contrasted_before_automatic_rewrite(pipeline):
    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        if not request.operation.endswith('audit') or data.get('review_focus') != 'coverage':
            return pipeline.model(request, **kwargs)
        issues = [] if 'candidate_findings' in data else [{
            'kind': 'omission', 'detail': 'The extension request is missing.',
            'narration_quotes': [], 'source_part_ids': [data['briefs'][0]['part_id']],
            'evidence_quote': data['briefs'][0]['quote']}]
        text = json.dumps({'issues': issues});kwargs['output_validator'](text)
        pipeline.calls.append({'task': request.operation, 'data': data})
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    text = pipeline.run([{'id': 'a', 'title': 'Extension request', 'text': 'The party requests an extension.'}])
    assert 'Extension request' in text
    assert len([c for c in pipeline.calls if c['task'].endswith('write')]) == 1
    assert any('candidate_findings' in c['data'] for c in pipeline.calls)


def test_global_overshoot_is_rewritten_without_clipping_or_local_caps(pipeline):
    calls = []
    def model(request, **kwargs):
        if not request.operation.endswith('write'):
            return pipeline.model(request, **kwargs)
        data = json.loads(request.input)['data']
        calls.append(data)
        count = request.options['target_words'] if 'previous_draft' in data else 1587
        text = json.dumps({'narration': 'word ' * count})
        kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    result = pipeline.run([{'id': str(i), 'title': f'Subject {i}', 'text': 'Evidence'} for i in range(20)])
    assert len(result.split()) == 1380 and len(calls) == 2
    assert calls[-1]['length_repair']['current_words'] == 1587
    assert calls[-1]['length_repair']['word_delta'] == -207
    assert len(calls[-1]['previous_draft'].split()) == 1587


def test_audit_confirmation_batches_findings_without_discarding_evidence():
    from backend.services.podcast_review import _confirm, _schema
    data = {'narration': 'A supported headline.', 'briefs': [{'part_id': 'a:0', 'quote': 'Evidence.'}]}
    findings = [{'kind': 'omission', 'detail': str(i), 'narration_quotes': [],
                 'source_part_ids': ['a:0'], 'evidence_quote': 'Evidence.'} for i in range(5)]
    calls = []
    class Context:
        budget = 1000
        def cost(self, value):
            return 400 + 300 * len(value['candidate_findings'])
        def stage(self, value, validate):
            assert value['briefs'] == data['briefs'] and self.cost(value) <= self.budget
            calls.append(value)
            result = {'issues': value['candidate_findings']}
            validate(result)
            return result
    result = _confirm(Context(), data, findings, lambda context, phase, value, schema: value, _schema(data))
    assert result == findings and [len(c['candidate_findings']) for c in calls] == [2, 2, 1]


def test_planner_uses_complete_evidence_when_global_request_fits(pipeline):
    pipeline.monkeypatch.setattr('backend.services.agent_context_budget.count_tokens',
                                lambda text, _: SimpleNamespace(tokens=len(text) // 4))
    pipeline.monkeypatch.setattr('backend.domains.agent.runtime_tools._model_context_window', lambda *_: 256000)
    pipeline.run([{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(110)])
    plans = [c for c in pipeline.calls if c['task'].endswith('plan')]
    assert len(plans) == 1 and len(plans[0]['data']['cards']) == 110
    assert all(card['summary'] for card in plans[0]['data']['cards'])
    assert all(card['part_ids'] == [f'card:{i}'] for i, card in enumerate(plans[0]['data']['cards']))


def test_internal_digest_overshoot_retains_exact_sources_without_becoming_spoken_text():
    from backend.services.podcast_outline import _digest
    calls = []
    evidence = [{'part_id': f'{i}:0', 'topic': f'Subject {i}', 'summary': f'Evidence {i}'} for i in range(8)]
    class Context:
        budget = 22000
        def request(self, task, data, schema):
            return briefing.AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
                input=json.dumps(data), output_schema=schema)
        def cost(self, request):
            return len(request.input)
        def stage(self, request, validate):
            assert self.cost(request) <= self.budget
            calls.append(json.loads(request.input))
            result = {'sections': [{'topic': 'Internal evidence',
                'part_ids': [b['part_id'] for b in evidence], 'narration': 'Evidence ' * 163}]}
            briefing.jsonschema.validate(result, request.output_schema)
            validate(result)
            return result
    result = _digest(Context(), evidence)
    assert len(calls) == 1 and calls[0]['briefs'] == evidence
    assert result == [{'topic': 'Internal evidence', 'part_ids': [b['part_id'] for b in evidence],
                       'summary': 'Evidence ' * 163}]


def test_nonshrinking_internal_reduction_cannot_send_oversized_writer_request_or_loop():
    from backend.services.podcast_automatic import _write_request
    calls = []
    class Context:
        budget = 22000
        def request(self, task, data, schema):
            return briefing.AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
                input=json.dumps(data), output_schema=schema)
        def cost(self, request):
            return 1000 if request.operation.endswith('digest') else 30000
        def stage(self, request, validate):
            assert request.operation.endswith('digest') and self.cost(request) <= self.budget
            calls.append(request.operation)
            result = {'sections': [{'topic': 'Internal evidence', 'part_ids': ['a:0'],
                                    'narration': 'Evidence ' * 163}]}
            validate(result)
            return result
    with pytest.raises(RuntimeError, match='podcast_theme_context_insufficient'):
        _write_request(Context(), {'briefs': [{'part_id': 'a:0', 'topic': 'Subject', 'summary': 'Evidence'}]},
                       {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
    assert calls == ['podcast.coverage.digest']


@pytest.mark.parametrize('confirmation', [False, True])
def test_output_exhaustion_splits_only_failed_work_and_preserves_all_evidence(confirmation):
    from openai import LengthFinishReasonError
    from backend.services.podcast_review import _stage
    briefs = [{'part_id': f'{i}:0', 'quote': f'Evidence {i}'} for i in range(5)]
    findings = [{'kind': 'omission', 'detail': str(i), 'narration_quotes': [],
                 'source_part_ids': [b['part_id']], 'evidence_quote': b['quote']} for i, b in enumerate(briefs)]
    data = {'narration': 'The current complete episode.', 'briefs': briefs}
    if confirmation:
        data['candidate_findings'] = findings
    leaves = []
    class Context:
        def stage(self, value, validate):
            key = 'candidate_findings' if confirmation else 'briefs'
            assert value['narration'] == data['narration']
            if confirmation:
                assert value['briefs'] == briefs
            if len(value[key]) > 2:
                raise LengthFinishReasonError(completion=SimpleNamespace(usage=None))
            leaves.extend(value[key])
            result = {'issues': value['candidate_findings'] if confirmation else []}
            validate(result)
            return result
    result = _stage(Context(), data, lambda context, phase, value, schema: value)
    assert leaves == (findings if confirmation else briefs)
    assert result['issues'] == (findings if confirmation else [])


@pytest.mark.parametrize('failure', ['length', 'cancel', 'filter'])
def test_failed_indivisible_audit_never_becomes_approval(failure):
    from openai import LengthFinishReasonError, ContentFilterFinishReasonError
    from backend.services.podcast_review import _stage
    error = (LengthFinishReasonError(completion=SimpleNamespace(usage=None)) if failure == 'length'
             else ContentFilterFinishReasonError() if failure == 'filter' else RuntimeError('cancelled'))
    class Context:
        def stage(self, request, validate):
            raise error
    with pytest.raises(type(error)):
        _stage(Context(), {'briefs': [{'part_id': 'a:0'}]}, lambda context, phase, data, schema: data)


def test_every_revision_reviews_facts_coverage_and_ledger_without_stale_feedback(monkeypatch):
    from backend.services import podcast_automatic as automatic
    writes, reviews = [], []
    def write(context, briefs, outline, budget, feedback, previous_draft):
        writes.append((feedback, previous_draft))
        return {'topic': 'Day', 'part_ids': ['a:0'], 'narration': f'Draft {len(writes)}'}
    def source_review(context, briefs, narration, subjects):
        reviews.append(('source', narration))
        return [{'kind': 'distortion', 'detail': narration, 'source_part_ids': ['a:0']}]
    def ledger_review(context, data):
        reviews.append(('ledger', data['sections'][0]['narration']))
        return [{'kind': 'omission', 'detail': 'Minority domain', 'source_part_ids': []}]
    monkeypatch.setattr(automatic, '_write_episode', write)
    monkeypatch.setattr(automatic, '_review_theme', source_review)
    monkeypatch.setattr(automatic, '_audit', ledger_review)
    with pytest.raises(ValueError, match='podcast_semantic_review_failed'):
        automatic.write_day(None, [{'source_id': 'a'}], [{'topic': 'Domain'}], lambda _: None)
    assert len(reviews) == 6
    assert writes[0] == ([], '')
    assert [i['detail'] for i in writes[2][0]] == ['Draft 2', 'Minority domain']
    assert writes[2][1] == 'Draft 2'


def test_fidelity_and_coverage_each_review_every_source_with_full_ledger():
    from backend.services.podcast_automatic import _review_theme
    data_seen = []
    briefs = [{'part_id': f'{i}:0', 'summary': 'A request, not completion.'} for i in range(35)]
    class Context:
        budget = 80000
        def request(self, operation, data, schema):
            return SimpleNamespace(model_copy=lambda update: data)
        def cost(self, request):
            return 100
        def stage(self, request, validate):
            data_seen.append(request)
            assert request['subjects'] == [['Minority domain', 'Shared domain']]
            assert len(request['briefs']) <= 16
            result = {'issues': []}
            validate(result)
            return result
    assert _review_theme(Context(), briefs, 'The whole narration.', [['Minority domain', 'Shared domain']]) == []
    for focus in ('fidelity', 'coverage'):
        assert [b for d in data_seen if d['review_focus'] == focus for b in d['briefs']] == briefs


@pytest.mark.parametrize('whole_episode', [False, True])
def test_review_leaf_approvals_cover_all_original_obligations_after_length_failure(whole_episode):
    from openai import LengthFinishReasonError
    from backend.services.podcast_review import review
    briefs = [{'part_id': f'{i}:0', 'quote': f'Evidence {i}'} for i in range(7)]
    data = ({'whole_episode': True, 'sections': [{'narration': 'The complete episode.'}],
             'subjects': [[f'Domain {i}'] for i in range(7)]} if whole_episode else
            {'narration': 'The complete episode.', 'briefs': briefs, 'review_focus': 'coverage'})
    key = 'subjects' if whole_episode else 'briefs'
    approved = []
    class Context:
        budget = 80000
        def cost(self, request):
            return 100
        def stage(self, value, validate):
            if len(value[key]) > 2:
                raise LengthFinishReasonError(completion=SimpleNamespace(usage=None))
            approved.extend(value[key])
            result = {'issues': []}
            validate(result)
            return result
    assert review(Context(), data, lambda context, phase, value, schema: value) == []
    assert approved == data[key]


def test_rejected_length_state_replaces_previous_delta_without_changing_semantic_findings():
    from backend.services.podcast_automatic import _bounded_write
    captured = []
    findings = [{'kind': 'omission', 'detail': 'A distinct domain is absent.'}]
    class Context:
        budget = 80000
        def request(self, task, data, schema):
            return briefing.AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
                input=json.dumps(data), output_schema=schema)
        def cost(self, request):
            return 100
        def stage(self, request, validate):
            data = json.loads(request.input)
            captured.append(data)
            result = {'narration': 'word ' * [1580, 900, 1380][len(captured)-1]}
            validate(result)
            return result
    result = _bounded_write(Context(), {'briefs': [], 'feedback': findings},
                            {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
    assert len(result['narration'].split()) == 1380
    assert all(d['feedback'] == findings for d in captured)
    assert captured[1]['length_repair']['word_delta'] == -200
    assert captured[2]['length_repair']['word_delta'] == 480
    assert captured[2]['length_repair']['current_words'] == len(captured[2]['previous_draft'].split()) == 900
    import hashlib
    assert captured[2]['length_repair']['draft_sha256'] == hashlib.sha256(captured[2]['previous_draft'].encode()).hexdigest()


def test_latest_draft_is_restored_when_complete_digested_evidence_and_draft_fit(monkeypatch):
    from backend.services.podcast_automatic import _write_request
    evidence = [{'part_id': 'a:0', 'summary': 'Complete source'}]
    records = [{'part_ids': ['a:0'], 'summary': 'Compact complete source'}]
    def digest(context, values):
        assert values == evidence
        return records
    monkeypatch.setattr('backend.services.podcast_outline._digest', digest)
    class Context:
        budget = 80000
        def request(self, task, data, schema):
            return briefing.AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
                input=json.dumps(data), output_schema=schema)
        def cost(self, request):
            data = json.loads(request.input)
            return (90000 if 'briefs' in data else 20000) + (5000 if 'previous_draft' in data else 0)
    data = {'briefs': evidence, 'previous_draft': 'The matching latest draft.',
            'subject_groups': [{'topic': 'Minority domain'}],
            'length_repair': {'mode': 'revise_draft', 'current_words': 4, 'word_delta': 1376}}
    result = json.loads(_write_request(Context(), data, {}).input)
    assert result['digests'] == records and result['previous_draft'] == data['previous_draft']
    assert result['subject_groups'] == data['subject_groups'] and result['length_repair'] == data['length_repair']
    assert data['briefs'] == evidence
