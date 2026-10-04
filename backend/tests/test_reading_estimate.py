"""Preflight includes all planned phases and never performs inference or saves evidence."""
from types import SimpleNamespace
from unittest.mock import Mock

from backend.domains.llm_wiki.chunking import reading_chunks, reading_chunk_budget
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.origins import finalize_origin
from backend.services import reading_estimate as estimate


def test_full_cost_and_exact_checkpoint_compatibility(monkeypatch, tmp_path):
    from backend.agent import model_catalog
    origin = finalize_origin({'kind':'text','label':'Book','input_order':0,
            'segments':[{'text':f'Qualified argument {i}.', 'locator':{'section':str(i)}} for i in range(20)]})
    runtime = SimpleNamespace(provider='openrouter', model='test', identity='runtime', instructions='Global instructions',
                              input_budget=120000, count_tokens=lambda text:len(text.encode()))
    monkeypatch.setattr(estimate, 'prepare_reading_runtime', lambda *_:runtime)
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
    assert result['output_token_bound'] > result['output_tokens_assumed']
    different = estimate.estimate('book',{},'',tmp_path,{'id':'table'},{},'brain', batch_size=1)
    assert different['planned_calls'] > result['planned_calls']
    assert different['estimate_id'] != result['estimate_id']
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
