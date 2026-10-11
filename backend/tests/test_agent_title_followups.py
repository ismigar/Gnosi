"""Follow-ups retain server-verified view intent, never assistant prose or approval."""
import asyncio
import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from backend.domains.agent.title_followups import canonical_title_request, followup_pairs
from backend.domains.agent.title_replacements import title_replacements, title_view_revisions
from backend.services.agent_title_continuation import MARKER, resolve_title_turn
from backend.tests.test_agent_title_mentions import (
    PAGE, VIEW, _http_chat, dashboard_runtime, action_runtime, optional_runtime, team_runtime, view,  # noqa: F401
)

INITIAL = 'Als noms de les tasques de la vista canvia "F1" per "Fase 1"'
FOLLOWUP = 'Ara canvia "Fase " per "F". P.ex.: Fase 1 per F1'


@pytest.mark.parametrize('message', [FOLLOWUP, 'Ara canvia "Fase " per "F"',
    'Ahora cambia "Fase " por "F". Por ejemplo: Fase 1 por F1',
    'Now replace "Fase " with "F". For example: Fase 1 to F1',
    'Maintenant remplace «Fase » par «F». Par exemple: Fase 1 par F1'])
def test_complete_followup_preserves_operand_spacing_and_checks_example(message):
    assert followup_pairs(message) == [('Fase ', 'F')]
    for language in ['ca', 'es', 'en', 'fr']:
        assert title_replacements(canonical_title_request(followup_pairs(message), language)) == [('Fase ', 'F')]


@pytest.mark.parametrize('message', ['No ' + FOLLOWUP, 'Explica com ' + FOLLOWUP,
    '«' + FOLLOWUP + '»', FOLLOWUP + ' i elimina la taula',
    FOLLOWUP.replace('per F1', 'per F 1'), FOLLOWUP + ', però no ho facis',
    'Ara canvia "Fase " per "F". P.ex.: Fase 1 per F1; envia un correu',
    'Ara canvia "Fase " per "F" als resums', 'fes-ho a tot el Vault'])
def test_ambiguous_denied_and_compound_followups_cannot_reuse_title_scope(message):
    assert followup_pairs(message) is None


def _history():
    marker = {'owner_id': 'director', 'request': INITIAL, 'view_scope': title_view_revisions([VIEW])[0]}
    return [HumanMessage(content=INITIAL), AIMessage(content='Review the change', additional_kwargs={MARKER: marker})]


@pytest.mark.parametrize('change', ['topic', 'filter', 'view', 'host', 'attachment', 'owner', 'no_history'])
def test_scope_topic_and_authority_boundaries(dashboard_runtime, change):
    fixture, _, registry = dashboard_runtime
    history, refs = _history(), [VIEW]
    if change == 'topic':
        history += [HumanMessage(content='Tradueix aquest poema'), AIMessage(content='Translation')]
    elif change == 'filter':
        registry['views'][0]['filters'] = []
    elif change == 'view':
        refs = [{**VIEW, 'scope': {**VIEW['scope'], 'view_id': 'resources'}}]
    elif change == 'host':
        refs = [{**VIEW, 'scope': {**VIEW['scope'], 'page_id': 'other'}}]
    elif change == 'attachment':
        history += [HumanMessage(content=FOLLOWUP, additional_kwargs={'gnosi_extra_context': True})]
    elif change == 'owner':
        history[-1].additional_kwargs[MARKER]['owner_id'] = 'another'
    elif change == 'no_history':
        history = [AIMessage(content=INITIAL)]  # assistant wording is not authority
    result = resolve_title_turn(FOLLOWUP, {'messages': [*history, HumanMessage(content=FOLLOWUP)]}, refs, 'director', fixture[0])
    assert result[1] is None and result[2] is True


def _latest_task(fixture):
    from backend.services import agent_team_store as artifacts
    return artifacts.list_artifacts(fixture[0], 'task')[0]


def _confirm_in_test(fixture, task):
    from backend.agent.action_confirmations import claim_confirmation
    from backend.agent import gnosi_tools
    from backend.services.context_vars import active_vault_path
    from backend.domains.agent import context_storage
    from pathlib import Path
    confirmation = claim_confirmation(task['confirmations'][0]['confirmation_id'], task['confirmation_scope'])
    token = active_vault_path.set(Path(fixture[0].vault_path))
    try:
        result = asyncio.run(gnosi_tools.execute_confirmed_action('bulk_update_rows', confirmation['arguments'], workspace_id='test'))
        # The production writer reindexes; mirror that in the in-memory fixture index.
        for page in context_storage._table_pages('projects'):
            page.metadata, _ = gnosi_tools._parse(page.path)
            page.title = page.metadata['title']
    finally:
        active_vault_path.reset(token)
    return result


def test_real_http_continuation_and_assent_prepare_then_confirm_without_ai(dashboard_runtime):
    fixture, paths, _ = dashboard_runtime
    before = {key: path.read_bytes() for key, path in paths.items()}
    _http_chat(fixture, INITIAL, [PAGE, VIEW], [])
    assert _confirm_in_test(fixture, _latest_task(fixture))['updated_count'] == 31
    phase = {key: path.read_bytes() for key, path in paths.items()}
    _http_chat(fixture, FOLLOWUP, [PAGE, VIEW], [])
    task = _latest_task(fixture)
    preview = task['confirmations'][0]
    assert len(preview['details']['updates']) == 31
    assert preview['details']['updates'][0]['to'].startswith('TFM · F1 —')
    _http_chat(fixture, 'fes-ho', [PAGE, VIEW], [])
    next_task = _latest_task(fixture)
    assert next_task['confirmations'][0]['confirmation_id'] != preview['confirmation_id']
    assert next_task['confirmations'][0]['details'] == preview['details']
    assert fixture[2] == []
    assert all(path.read_bytes() == phase[key] for key, path in paths.items()), 'assent must not confirm'
    assert _confirm_in_test(fixture, next_task)['updated_count'] == 31
    from backend.agent import gnosi_tools
    for i in range(31):
        assert gnosi_tools._parse(paths[f'row-{i}'])[0]['title'] == f'TFM · F1 — Filosofia {i}'
    assert all(paths[f'row-{i}'].read_bytes() == before[f'row-{i}'] for i in range(31, 748))
    assert paths['selected'].read_bytes() == before['selected']


def test_existing_conversation_uses_scoped_preview_evidence_after_failed_continuations(dashboard_runtime):
    fixture, _, _ = dashboard_runtime
    _http_chat(fixture, INITIAL, [PAGE, VIEW], [])
    task = _latest_task(fixture)
    history = [HumanMessage(content=INITIAL), AIMessage(content=json.dumps(task['confirmations'][0])),
               HumanMessage(content=FOLLOWUP), AIMessage(content='No he modificat els títols.'),
               HumanMessage(content='fes-ho'), AIMessage(content='Internal error ab685ebf'),
               HumanMessage(content='fes-ho')]
    original, marker, clarify = resolve_title_turn('fes-ho', {'messages': history}, [VIEW], 'director', fixture[0])
    assert not clarify and marker
    assert title_replacements(original) == [('Fase ', 'F')]
    assert marker['view_scope'] == title_view_revisions([VIEW])[0]


@pytest.mark.parametrize('failure', ['no_op', 'wrong_title'])
def test_silent_write_failure_never_reports_completion(dashboard_runtime, monkeypatch, failure):
    from backend.domains.agent import gnosi_dispatch_rows as rows
    fixture, paths, _ = dashboard_runtime
    before = {key: path.read_bytes() for key, path in paths.items()}
    _http_chat(fixture, INITIAL, [PAGE, VIEW], [])
    original_write = rows._write_page
    def faulty_write(path, metadata, body):
        if failure == 'wrong_title':
            original_write(path, {**metadata, 'title': 'wrong'}, body)
    monkeypatch.setattr(rows, '_write_page', faulty_write)
    with pytest.raises(RuntimeError, match='rolled back'):
        _confirm_in_test(fixture, _latest_task(fixture))
    assert all(path.read_bytes() == before[key] for key, path in paths.items())


def test_catalan_assent_errors_stay_in_catalan():
    from backend.domains.agent.responses import _response_language
    assert _response_language('fes-ho') == 'ca'
