"""Preflight includes all planned phases and never performs inference or saves evidence."""
from types import SimpleNamespace
from unittest.mock import Mock
import json

import pytest

from backend.domains.llm_wiki.chunking import reading_chunks, reading_chunk_budget
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.origins import finalize_origin
from backend.services import reading_estimate as estimate


@pytest.mark.parametrize('hint', ['valid', 'stale', 'absent', 'outside', 'symlink', 'loop', 'invalid'])
def test_cold_source_lookup_verifies_cached_identity_and_preserves_fallback(monkeypatch, tmp_path, hint):
    from backend.api import vault_routes as vr
    from backend.services.llm_wiki_actions import _source_page_path

    vault = tmp_path / 'vault'; vault.mkdir()
    source = vault / 'source.md'; source.write_text('requested')
    old = vault / 'old.md'; old.write_text('another-id')
    outside = tmp_path / 'outside.md'; outside.write_text('requested')
    link = vault / 'link.md'; link.symlink_to(outside)
    loop = vault / 'loop.md'; loop.symlink_to(loop)
    candidate = {'valid': source, 'stale': old, 'outside': outside, 'symlink': link, 'loop': loop}.get(hint)
    cache = tmp_path / 'cache.json'
    cache.write_text(json.dumps({str(candidate): {'id': 'requested'}} if candidate else {}))
    if hint == 'invalid': cache.write_text('{broken')
    initialized = {}
    monkeypatch.setattr(vr, '_page_index_initialized', initialized)
    monkeypatch.setattr(vr, 'get_page_index_cache_path', lambda *_: cache)
    fallback = Mock(return_value=source)
    ports = SimpleNamespace(get_p=lambda _: vault, find_page_path=fallback,
                            parse_frontmatter=lambda text, _path: ({'id': text}, ''))
    assert _source_page_path(ports, 'requested') == source
    assert fallback.call_count == (0 if hint == 'valid' else 1)
    assert initialized == {}  # A disk hint cannot suppress discovery of newer files.


def test_warm_source_lookup_keeps_the_current_index(monkeypatch, tmp_path):
    from backend.api import vault_routes as vr
    from backend.services.llm_wiki_actions import _source_page_path

    monkeypatch.setattr(vr, '_page_index_initialized', {str(tmp_path): True})
    monkeypatch.setattr(vr, 'get_page_index_cache_path', lambda *_: pytest.fail('Warm lookup must not reload disk'))
    ports = SimpleNamespace(get_p=lambda _: tmp_path, find_page_path=lambda _: tmp_path / 'current.md')
    assert _source_page_path(ports, 'requested') == tmp_path / 'current.md'


def test_source_lookup_preserves_unavailable_metadata_without_scanning_or_writing(monkeypatch, tmp_path):
    from backend.api import vault_routes as vr
    from backend.services import llm_wiki_actions as actions
    from backend.utils.metadata_io import MetadataUnavailable

    monkeypatch.setattr(vr, '_page_index_initialized', {})
    monkeypatch.setattr(vr, 'get_page_index_cache_path', lambda *_: tmp_path / 'cache.json')
    failure = MetadataUnavailable('Provider metadata is pending')
    monkeypatch.setattr(actions, 'read_metadata_text', Mock(side_effect=failure))
    fallback = Mock(side_effect=AssertionError('Unavailable metadata must stay visible'))
    ports = SimpleNamespace(get_p=lambda _: tmp_path, find_page_path=fallback)
    with pytest.raises(MetadataUnavailable) as result:
        actions._source_page_path(ports, 'requested')
    assert result.value is failure
    fallback.assert_not_called()


@pytest.mark.parametrize('flex', [False, True])
def test_semantic_preflight_does_not_prepare_the_unused_legacy_workflow(monkeypatch, tmp_path, flex):
    from backend.agent import model_catalog

    origin = finalize_origin({'kind': 'text', 'label': 'Book', 'input_order': 0,
                              'segments': [{'text': 'A complete qualified argument.', 'locator': {'page': 1}}]})
    runtime = SimpleNamespace(provider='openai' if flex else 'openrouter', model='gpt-6.1-sol' if flex else 'test', identity='runtime', reading_engine='semantic',
                              instructions='Preserve evidence.', input_budget=120000, count_tokens=lambda text: len(text.encode()))
    monkeypatch.setattr(estimate, 'prepare_reading_runtime', lambda *_: runtime)
    monkeypatch.setattr(estimate.llm_wiki_extractors, 'extract_resource_sources', lambda *_: ([origin], []))
    monkeypatch.setattr(estimate.llm_wiki_config, 'load_config', lambda: {})
    monkeypatch.setattr(estimate.llm_wiki, '_dimension_context', lambda *_: ({}, []))
    monkeypatch.setattr(estimate.llm_wiki, '_load_brain_index', lambda *_: [])
    monkeypatch.setattr(estimate.llm_wiki_storage, 'get_job_status', lambda *_: {})
    monkeypatch.setattr(model_catalog, 'catalog_model_cost', lambda *_: {'cost_in': .1, 'cost_out': .5})
    legacy_schema = Mock(side_effect=AssertionError('Semantic preflight must not prepare legacy actions'))
    monkeypatch.setattr(estimate, 'action_schemas', legacy_schema)
    result = estimate.estimate('book', {}, '', tmp_path, {'id': 'table'}, {}, 'brain')
    assert result['reading_engine'] == 'semantic' and result['phase_calls']['interpretation'] == 1
    assert result['input_token_bound'] >= result['source_token_bound'] > 0
    assert result['cost_usd'] > 0 and result['cost_with_repairs_usd'] > result['cost_usd']
    assert result['processing_tier'] == ('flex' if flex else 'default')
    if flex:
        assert result['cost_usd'] == pytest.approx((result['input_token_bound'] * .1 * 1.25
            + result['output_tokens_assumed'] * .5) * .5 / 1_000_000)
    legacy_schema.assert_not_called()


def test_full_cost_and_exact_checkpoint_compatibility(monkeypatch, tmp_path):
    from backend.agent import model_catalog
    origin = finalize_origin({'kind':'text','label':'Book','input_order':0,
            'segments':[{'text':f'Qualified argument {i}.', 'locator':{'section':str(i)}} for i in range(20)]})
    runtime = SimpleNamespace(provider='openrouter', model='test', identity='runtime', instructions='Global instructions',
                              input_budget=120000, count_tokens=lambda text:len(text.encode()))
    monkeypatch.setattr(estimate, 'prepare_reading_runtime', lambda *_:runtime)
    fx = {'code': 'EUR', 'symbol': '€', 'usd_rate': .9, 'source': 'test', 'fetched_at': '2026-10-04'}
    monkeypatch.setattr(estimate, 'currency_context', lambda: fx)
    monkeypatch.setattr(estimate.llm_wiki_extractors, 'extract_resource_sources', lambda *_:([origin], []))
    monkeypatch.setattr(estimate.llm_wiki_config, 'load_config', lambda:{})
    monkeypatch.setattr(estimate.llm_wiki, '_dimension_context', lambda *_:({}, []))
    monkeypatch.setattr(estimate.llm_wiki, '_load_brain_index', lambda *_:[])
    monkeypatch.setattr(model_catalog, 'catalog_model_cost', lambda *_:{'cost_in':.1, 'cost_out':.5})
    monkeypatch.setattr(estimate.llm_wiki_storage, 'get_job_status', lambda *_:{'phase':'partial', 'job_id':'saved'})
    monkeypatch.setattr(estimate.llm_wiki_storage, 'resume_checkpoint_jobs', lambda *_:['saved'])
    chunks = reading_chunks([origin], budget=reading_chunk_budget(runtime.input_budget), count=runtime.count_tokens)
    saved = {'identity':fingerprint(['runtime',chunks,[],[]]), 'plans':{c['id']:{'notes':[{'body_md':'Global argument'}]} for c in chunks[:16]}, 'memory':''}
    monkeypatch.setattr(estimate.llm_wiki_storage, 'load_checkpoint', lambda *_:saved)
    save = Mock(side_effect=AssertionError('Preflight must not save source evidence'))
    monkeypatch.setattr(estimate.llm_wiki_storage, 'save_snapshot', save)
    result = estimate.estimate('book',{},'',tmp_path,{'id':'table'},{},'brain')
    assert result['saved_chunks'] == 16 and result['remaining_chunks'] == 4
    assert result['planned_calls'] == 1+1+result['memory_restore_calls']
    assert result['input_token_bound'] > result['source_token_bound']
    assert result['cost_with_repairs_usd'] > result['cost_usd'] > 0
    assert result['display_currency'] == fx and result['currency'] == 'USD'
    assert result['cost_in_per_million_usd'] == .1
    assert result['cost_out_per_million_usd'] == .5
    assert result['cost_usd'] == (result['input_token_bound']*.1+result['output_tokens_assumed']*.5)/1_000_000
    assert result['output_token_bound'] > result['output_tokens_assumed']
    different = estimate.estimate('book',{},'',tmp_path,{'id':'table'},{},'brain', batch_size=1)
    assert different['planned_calls'] > result['planned_calls']
    assert different['estimate_id'] != result['estimate_id']
    # Preflight predicts the reduced delivery without mutating even a zero-plan
    # checkpoint. The same provider error will drive resumption before billing.
    from copy import deepcopy
    from backend.tests.test_reading_batch_recovery import exhausted
    saved.update(last_result={'delivery': 'batch', 'sources': chunks[16:]},
                 last_action={'delivery': 'automatic'})
    original = deepcopy(saved)
    monkeypatch.setattr(estimate.llm_wiki_storage, 'get_job_status',
                        lambda *_: {'phase': 'partial', 'job_id': 'saved', 'error': str(exhausted())})
    reduced = estimate.estimate('book', {}, '', tmp_path, {'id': 'table'}, {}, 'brain')
    assert reduced['batch_size'] == 2 and reduced['saved_chunks'] == 16
    assert reduced['planned_calls'] == result['planned_calls'] + 1
    assert saved == original
    saved['plans'] = {}
    empty = estimate.estimate('book', {}, '', tmp_path, {'id': 'table'}, {}, 'brain')
    assert empty['batch_size'] == 2 and empty['saved_chunks'] == 0
    saved.update(original)
    runtime.identity = 'changed-model-or-instructions'
    blocked = estimate.estimate('book',{},'',tmp_path,{'id':'table'},{},'brain')
    assert blocked['saved_chunks'] == 0 and blocked['incompatible_saved_chunks'] == 16
    fresh = estimate.estimate('book',{},'',tmp_path,{'id':'table'},{},'brain', force=True)
    assert fresh['incompatible_saved_chunks'] == 0
    save.assert_not_called()


def test_incompatible_checkpoint_and_stale_estimate_cannot_launch_worker(monkeypatch, tmp_path):
    import pytest
    from backend.api import vault_routes as vr
    from backend.services import llm_wiki_actions as actions
    page = tmp_path/'source.md';page.write_text('Source')
    monkeypatch.setattr(vr, '_load_plugins_state', lambda:{})
    monkeypatch.setattr(vr, '_llm_wiki_enabled', lambda _:True)
    monkeypatch.setattr(vr, '_table_by_id', lambda key:{'id':key})
    monkeypatch.setattr(vr, 'find_page_path', lambda _:page)
    monkeypatch.setattr(vr, 'parse_frontmatter', lambda *_:({'table_id':'sources'}, 'Source'))
    monkeypatch.setattr(vr, '_resource_processed_value', lambda _:'')
    monkeypatch.setattr(vr, '_llm_wiki_source_title', lambda *_:'Book')
    monkeypatch.setattr(vr, 'get_p', lambda _:tmp_path)
    monkeypatch.setattr(estimate.llm_wiki_config, 'load_config', lambda:{'brain_table_id':'brain'})
    monkeypatch.setattr(estimate.llm_wiki_config, 'get_source_config', lambda _:{'table_id':'sources'})
    monkeypatch.setattr(estimate.llm_wiki, 'is_running', lambda *_:False)
    monkeypatch.setattr(estimate.llm_wiki, 'get_job_status', lambda *_:{'phase':'partial', 'job_id':'saved'})
    start = Mock(return_value={'job_id':'new'})
    monkeypatch.setattr(estimate.llm_wiki, 'start_ingest', start)
    result = {'estimate_id':'current','incompatible_saved_chunks':166,'_reading_identity':'identity','priced':True}
    monkeypatch.setattr(estimate, 'estimate', lambda *_args, **_kwargs:result)
    for identifier, error in [('stale','reading_estimate_changed'),('current','reading_checkpoint_incompatible')]:
        with pytest.raises(actions.LlmWikiActionError, match=error):
            actions.start_source_process('book', source_table_id='sources', estimate_id=identifier)
        start.assert_not_called()
    result['incompatible_saved_chunks'] = 0
    actions.start_source_process('book', source_table_id='sources', estimate_id='current', force=True)
    assert start.call_args.kwargs['force'] is True
    assert start.call_args.kwargs['expected_reading_identity'] == 'identity'


def test_changed_knowledge_preflight_reuses_drafts_but_prices_all_reviews(monkeypatch):
    from copy import deepcopy
    from backend.domains.llm_wiki.reading_identity import identity_parts, canonical_hash
    from backend.services.reading_semantic_estimate import phase_estimate
    parts = identity_parts('same-policy', [], [], [{'id': 'new-knowledge'}])
    old_parts = {**parts, 'knowledge': 'old-index'}
    checkpoint = {'engine': 2, 'identity': canonical_hash(old_parts), 'identity_parts': old_parts,
                  'reading_context': fingerprint(['Book', 'Catalan']), 'plans': {'one': {'notes': [{'body_md': 'Qualified idea'}]}},
                  'maps': ['Map'], 'global_map': 'Map', 'notes_map': 'Map', 'overview_complete': {'0': ['Map']},
                  'reviewed_groups': {'old': {}}, 'reviewed_ranges': {'0': 1}, 'review_quality_version': 1, 'completed': True}
    original = deepcopy(checkpoint)
    monkeypatch.setattr(estimate.llm_wiki_storage, 'resume_checkpoint_jobs', lambda _: ['old'])
    monkeypatch.setattr(estimate.llm_wiki_storage, 'load_checkpoint', lambda *_: checkpoint)
    monkeypatch.setattr(estimate.llm_wiki_storage, 'get_job_status', lambda *_: {})
    saved, count = estimate._saved_state({'phase': 'partial', 'job_id': 'old'}, canonical_hash(parts), True, False,
                                       'Book', 'Catalan', parts)
    assert count == 1 and saved['plans'] == checkpoint['plans']
    assert saved['reviewed_groups'] == {} and saved['completed'] is False
    costs = phase_estimate(SimpleNamespace(input_budget=100000, count_tokens=len, instructions='Policy'), [], [], [], saved, 4)
    assert costs['phase_calls']['review'] >= 1 and costs['phase_calls']['interpretation'] == 0
    assert checkpoint == original
    for field in ['execution', 'sources', 'classification']:
        changed = {**parts, field: 'changed'}
        rejected, _ = estimate._saved_state({'phase': 'partial', 'job_id': 'old'}, canonical_hash(changed), True, False,
                                           'Book', 'Catalan', changed)
        assert not rejected
    rejected, _ = estimate._saved_state({'phase': 'partial', 'job_id': 'old'}, canonical_hash(parts), True, False,
                                       'Book', 'French', parts)
    assert not rejected


def test_price_tokenizer_identifies_exact_reference_and_missing_assets(monkeypatch):
    from backend.services import agent_context_budget

    def available(model, *, use_profile_cache=False):
        assert use_profile_cache
        if model == 'gpt-4o':
            return SimpleNamespace(name='o200k_base', encode=lambda text, **_: text.split())
        raise KeyError(model)

    monkeypatch.setattr(agent_context_budget, '_available_encoding', available)
    text = 'Una prova en català'
    for model, prefix in [('openai/gpt-4o', 'model'), ('openai/gpt-6.1-sol', 'reference')]:
        count, method = agent_context_budget.reading_price_counter('openrouter', model)
        assert method == f'{prefix}:tiktoken:o200k_base'
        assert count(text) == 4
    for provider, model in [('openrouter', 'other/unknown'), ('ollama', 'gpt-4o')]:
        count, method = agent_context_budget.reading_price_counter(provider, model)
        assert method == 'utf8-conservative-upper-bound'
        assert count(text) == len(text.encode('utf-8'))


def test_context_and_quote_tokenizers_use_verified_bytes_without_downloader(monkeypatch, tmp_path):
    import hashlib
    from tiktoken import load, registry
    from backend.services import agent_context_budget as budget

    # A tiny deterministic vocabulary is enough to exercise the constructor
    # and the loss of the on-disk cache immediately after the first read.
    raw = b'YQ== 0\n'
    url = 'https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken'
    path = tmp_path / hashlib.sha1(url.encode()).hexdigest()
    path.write_bytes(raw)
    real_read = type(path).read_bytes
    real_sha256 = hashlib.sha256

    def read_then_disappear(file):
        result = real_read(file)
        if file == path:
            file.unlink()
        return result

    def hash_fixture(data):
        if data == raw:
            return SimpleNamespace(hexdigest=lambda: budget._ENCODING_HASHES['o200k_base'])
        return real_sha256(data)

    download = Mock(side_effect=AssertionError('Estimate must not download a tokenizer'))
    monkeypatch.setenv('TIKTOKEN_CACHE_DIR', str(tmp_path))
    monkeypatch.setattr(type(path), 'read_bytes', read_then_disappear)
    monkeypatch.setattr(budget, 'hashlib', SimpleNamespace(sha1=hashlib.sha1, sha256=hash_fixture))
    monkeypatch.setattr(load, 'read_file', download)
    monkeypatch.setattr(registry, 'ENCODINGS', {})
    monkeypatch.setattr(budget, '_LOCAL_ENCODINGS', {})
    context = budget.count_tokens('aaaa', 'gpt-4o')
    assert context.tokens == 4 and not context.estimated
    count, method = budget.reading_price_counter('openrouter', 'openai/gpt-6.1-sol')
    assert method == 'reference:tiktoken:o200k_base'
    assert count('aaaa') == 4
    assert not path.exists()
    download.assert_not_called()


def test_profile_vocabulary_survives_cold_quotes_without_changing_context_counts(monkeypatch, tmp_path):
    import hashlib
    from tiktoken import load, registry
    from backend.services import agent_context_budget as budget

    raw = b'YQ== 0\nYWE= 1\n'
    url = 'https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken'
    profile = tmp_path / 'profile'
    cache = profile / 'cache' / 'tokenizers'
    cache.mkdir(parents=True)
    (cache / hashlib.sha1(url.encode()).hexdigest()).write_bytes(raw)
    real_sha256 = hashlib.sha256

    def hash_fixture(data):
        if data == raw:
            return SimpleNamespace(hexdigest=lambda: budget._ENCODING_HASHES['o200k_base'])
        return real_sha256(data)

    download = Mock(side_effect=AssertionError('Estimate must not download a tokenizer'))
    monkeypatch.setenv('GNOSI_DATA_DIR', str(profile))
    monkeypatch.delenv('TIKTOKEN_CACHE_DIR', raising=False)
    monkeypatch.delenv('DATA_GYM_CACHE_DIR', raising=False)
    monkeypatch.setattr(budget.tempfile, 'gettempdir', lambda: str(tmp_path / 'empty-temp'))
    monkeypatch.setattr(budget, 'hashlib', SimpleNamespace(sha1=hashlib.sha1, sha256=hash_fixture))
    monkeypatch.setattr(load, 'read_file', download)
    monkeypatch.setattr(registry, 'ENCODINGS', {})
    monkeypatch.setattr(budget, '_LOCAL_ENCODINGS', {})

    for _ in range(2):
        budget._LOCAL_ENCODINGS.clear()
        count, method = budget.reading_price_counter('openrouter', 'openai/gpt-6.1-sol')
        assert method == 'reference:tiktoken:o200k_base'
        assert count('aaaa') == 2
        context = budget.count_tokens('aaaa', 'gpt-4o')
        assert context.tokens == 4 and context.estimated

    monkeypatch.setenv('TIKTOKEN_CACHE_DIR', '')
    assert budget.reading_price_counter('openrouter', 'openai/gpt-6.1-sol')[1] == 'utf8-conservative-upper-bound'
    download.assert_not_called()


def test_pricing_tokens_change_cost_without_replanning_semantic_batches():
    from backend.services.reading_semantic_estimate import phase_estimate

    origin = finalize_origin({'kind': 'text', 'label': 'Book', 'input_order': 0,
                              'segments': [{'text': 'Una afirmació matisada. ' * 20,
                                            'locator': {'section': str(i)}} for i in range(20)]})
    runtime = SimpleNamespace(input_budget=100000, count_tokens=lambda text: len(text.encode()),
                              instructions='Keep every qualification.')
    chunks = reading_chunks([origin], budget=reading_chunk_budget(runtime.input_budget), count=runtime.count_tokens)
    old = phase_estimate(runtime, chunks, chunks, [], {}, 4)
    new = phase_estimate(runtime, chunks, chunks, [], {}, 4,
                         price_count=lambda text: len(text.split()))
    assert new['phase_calls'] == old['phase_calls']
    assert new['input_token_bound'] < old['input_token_bound']
    assert new['output_tokens_assumed'] < old['output_tokens_assumed']
    assert new['output_token_bound'] == old['output_token_bound']
    assert new['evidence_input_token_bound'] == old['evidence_input_token_bound']
