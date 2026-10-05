"""A previous processing date must not turn a checkpoint resume into a restart."""
from unittest.mock import Mock

import pytest


@pytest.mark.parametrize('phase,force,allowed', [
    ('partial', False, True), ('error', False, True),
    ('done', False, False), ('idle', False, False), ('done', True, True),
])
def test_processed_resource_resumes_interrupted_work(monkeypatch, tmp_path, phase, force, allowed):
    from backend.api import vault_routes as vr
    from backend.services import llm_wiki, llm_wiki_actions as actions, llm_wiki_config as config
    source = tmp_path / 'source.md'
    source.write_text('Original source')
    monkeypatch.setattr(vr, '_load_plugins_state', lambda: {})
    monkeypatch.setattr(vr, '_llm_wiki_enabled', lambda _: True)
    monkeypatch.setattr(vr, '_table_by_id', lambda table: {'id': table})
    monkeypatch.setattr(vr, 'find_page_path', lambda _: source)
    monkeypatch.setattr(vr, 'parse_frontmatter', lambda *_: ({'table_id': 'resources'}, 'Source'))
    monkeypatch.setattr(vr, '_resource_processed_value', lambda _: '2026-09-28')
    monkeypatch.setattr(vr, '_llm_wiki_source_title', lambda *_: 'Book')
    monkeypatch.setattr(vr, 'get_p', lambda _: tmp_path)
    monkeypatch.setattr(config, 'load_config', lambda: {'brain_table_id': 'brain'})
    monkeypatch.setattr(config, 'get_source_config', lambda _: {'table_id': 'resources'})
    monkeypatch.setattr(llm_wiki, 'is_running', lambda *_: False)
    monkeypatch.setattr(llm_wiki, 'get_job_status', lambda *_: {'phase': phase, 'job_id': 'saved'})
    start = Mock(return_value={'job_id': 'next'})
    monkeypatch.setattr(llm_wiki, 'start_ingest', start)
    if allowed:
        actions.start_source_process('resource', source_table_id='resources', force=force)
        assert start.call_args.kwargs['force'] is force
    else:
        with pytest.raises(actions.LlmWikiActionError, match='Already processed'):
            actions.start_source_process('resource', source_table_id='resources', force=force)
        start.assert_not_called()
