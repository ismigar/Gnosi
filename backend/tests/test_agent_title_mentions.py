"""Exercise the actual chat boundary: no pre-granted tools or pre-resolved view."""
import asyncio
import json
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.api import vault_routes  # noqa: F401 - initialize app composition before fixture config
from backend.domains.agent.routes import chat_route, learning_context, workflow
from backend.domains.vault.links import runtime as links

from backend.domains.agent.title_replacements import title_replacements, title_target
from backend.domains.agent.title_context import title_context_refs, mention_context_refs
from backend.domains.agent.write_intent import _explicit_brain_write_tool_names
from backend.tests.test_agent_title_replacements import action_runtime, optional_runtime, team_runtime, view  # noqa: F401

LABEL = 'TFM: "Projecte de prova amb autonomia, cura i ètica”'
REQUEST = f'Als títols de @{LABEL} modIfica "FASE" i "F" per "Fase" i "—" per "-"'
PAGE = {'id': 'page:selected', 'type': 'page', 'ref': 'selected', 'label': LABEL}
VIEW = {'id': 'table:projects', 'type': 'table', 'ref': 'projects', 'label': 'Projects',
        'scope': {'view_id': 'filtered', 'page_id': 'selected'}}


@pytest.mark.parametrize('prompt', [REQUEST,
    f'En los títulos de @{LABEL} modifica "FASE" y "F" por "Fase" y "—" por "-"',
    f'In the titles of @{LABEL} replace "FASE" and "F" with "Fase" and "—" with "-"',
    f'Dans les titres de @{LABEL} remplace «FASE» et «F» par «Fase» et «—» par «-».'])
def test_named_title_request_preserves_operands_despite_quotes_inside_label(prompt):
    assert title_target(prompt) == LABEL
    assert title_replacements(prompt) == [('FASE', 'Fase'), ('F', 'Fase'), ('—', '-')]
    assert _explicit_brain_write_tool_names(prompt) == {'bulk_update_rows'}


@pytest.mark.parametrize('prompt', ['No ' + REQUEST, 'Explica com ' + REQUEST,
    '«' + REQUEST + '»', REQUEST + ', però no ho facis', REQUEST + ' i elimina la taula'])
def test_named_target_does_not_authorize_quoted_denied_or_compound_requests(prompt):
    assert title_replacements(prompt) is None


@pytest.fixture
def dashboard_runtime(action_runtime, monkeypatch, tmp_path):
    from backend.domains.agent import gnosi_support
    from backend.services import principal_agent_migration, agent_personal_memory, agent_skill_catalog
    from backend.domains.agent import workflow as factory
    from backend.agent import model_router
    fixture, paths, registry = action_runtime
    models = model_router.load_registry()
    monkeypatch.setattr(model_router, 'load_registry', lambda **_: models)
    fixture[3]['active_agent_id'] = 'director'
    registry['views'][0]['filters'][0]['value'] = 'this'
    registry['views'][0]['tabs'] = None
    registry['views'].extend([{'id': name, 'table_id': 'projects', 'name': name,
                               'filters': [{'field': 'project', 'operator': 'equals', 'value': 'other'}]}
                              for name in ['resources', 'notes']])
    dashboard = tmp_path / 'dashboard.md'
    dashboard.write_text('---\n' + json.dumps({'id': 'selected', 'title': LABEL + '.'}) + '\n---\n' +
                         '\n'.join('<!-- gnosi-view:def ' + json.dumps({'view_id': name}) + ' -->'
                                   for name in ['filtered', 'resources', 'notes']))
    paths['selected'] = dashboard
    monkeypatch.setattr(gnosi_support, '_resolve_page', lambda identifier: paths.get(identifier))
    monkeypatch.setattr(links, 'build_id_title_index', lambda: {'selected': LABEL + '.'})
    monkeypatch.setattr(workflow, 'prepare_agent_runtime', lambda *args, **kwargs: (
        fixture[3], fixture[1].profile, agent_skill_catalog.resolve_agent_runtime(fixture[1].profile)))
    monkeypatch.setattr(workflow, 'create_agent_workflow', factory.create_agent_workflow)
    monkeypatch.setattr(chat_route, '_vault_scope', lambda: (tmp_path, 'synthetic-vault'))
    monkeypatch.setattr(chat_route, 'cfg', SimpleNamespace(paths={'CHECKPOINTS': tmp_path / 'checkpoints'}))
    monkeypatch.setattr(principal_agent_migration, 'ensure_migrated', lambda: fixture[3])
    monkeypatch.setattr(learning_context, 'prepare_learning_context', lambda *_: ('', [], '', None))
    monkeypatch.setattr(agent_personal_memory, 'search_memories', lambda *args, **kwargs: [])
    return fixture, paths, registry


def _http_chat(fixture, message, refs, mentions):
    from backend.domains.agent.routes.chat_route import chat_endpoint
    from backend.services.workspace_service import WorkspaceContext
    from backend.services.context_vars import active_vault_path
    from backend.services.agent_execution_scope import execution_scope
    app = FastAPI()
    app.add_api_route('/api/agent/chat', chat_endpoint, methods=['POST'])
    dependency = app.routes[-1].dependant.dependencies[0].call
    scope = fixture[0]
    app.dependency_overrides[dependency] = lambda: WorkspaceContext('test', 'alice', 'owner', Path(scope.vault_path))
    token = active_vault_path.set(Path(scope.vault_path))
    try:
        with execution_scope(scope), TestClient(app) as client:
            response = client.post('/api/agent/chat', json={'agent_id': 'director', 'session_id': 's',
                'message': message, 'context_refs': refs, 'mentions': mentions})
        assert response.status_code == 200, response.text
        events = [json.loads(line) for line in response.text.splitlines() if line]
        assert not [event for event in events if event['type'] == 'error'], response.text
        return events
    finally:
        active_vault_path.reset(token)


@pytest.mark.parametrize('structured', [True, False])
def test_http_named_title_action_reaches_real_confirmation_without_a_model(dashboard_runtime, structured):
    from backend.services import agent_team_store as artifacts
    from backend.agent import gnosi_tools
    from backend.agent.action_confirmations import claim_confirmation
    from backend.services.context_vars import active_vault_path
    fixture, paths, registry = dashboard_runtime
    before = {identifier: path.read_bytes() for identifier, path in paths.items()}
    refs = [VIEW, *([PAGE] if structured else [])]
    mentions = [{'id': 'selected', 'type': 'page', 'label': LABEL}] if structured else []
    started = time.monotonic()
    events = _http_chat(fixture, REQUEST, refs, mentions)
    elapsed = time.monotonic() - started
    assert fixture[2] == []
    task = artifacts.list_artifacts(fixture[0], 'task')[0]
    assert task['status'] == 'awaiting_confirmation', (task, events)
    assert task['agent_id'] == 'vault'
    assert task['required_action_names'] == ['bulk_update_rows']
    assert task['snapshot']['profile']['context_refs'][0]['scope']['page_id'] == 'selected'
    assert len(task['confirmations']) == 1
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
    confirmation = claim_confirmation(task['confirmations'][0]['confirmation_id'], task['confirmation_scope'])
    token = active_vault_path.set(Path(fixture[0].vault_path))
    try:
        arguments = confirmation['arguments']
        assert len(arguments['updates']) == 31
        assert arguments['view_scope']['page_id'] == 'selected'
        result = asyncio.run(gnosi_tools.execute_confirmed_action('bulk_update_rows', arguments, workspace_id='test'))
    finally:
        active_vault_path.reset(token)
    assert result['updated_count'] == 31
    for i in range(748):
        assert (paths[f'row-{i}'].read_bytes() != before[f'row-{i}']) == (i < 31)
    assert paths['selected'].read_bytes() == before['selected']
    print(f'HTTP title preview: {elapsed:.3f}s; 0 model calls; 31 updates; 717 unchanged')


def test_missing_selected_view_clarifies_locally_without_guessing_among_three(dashboard_runtime):
    from backend.services import agent_team_store as artifacts
    fixture, paths, _ = dashboard_runtime
    before = {key: path.read_bytes() for key, path in paths.items()}
    events = _http_chat(fixture, REQUEST, [{'id': 'route-vault', 'type': 'vault', 'ref': 'active-vault'}], [])
    assert fixture[2] == []
    assert not artifacts.list_artifacts(fixture[0], 'task')
    assert 'Selecciona una vista concreta' in json.dumps(events, ensure_ascii=False)
    assert all(path.read_bytes() == before[key] for key, path in paths.items())


def test_unresolved_or_duplicate_named_page_cannot_fall_back_to_an_unrelated_view(dashboard_runtime, monkeypatch):
    for index in [{}, {'one': LABEL, 'two': LABEL}]:
        monkeypatch.setattr(links, 'build_id_title_index', lambda: index)
        assert title_context_refs(REQUEST, [VIEW]) == []


def test_only_visible_structured_mentions_attach_their_identity():
    mentions = [{'id': 'selected', 'type': 'page', 'label': LABEL},
                {'id': 'hidden', 'type': 'page', 'label': 'Hidden'}]
    assert [ref['ref'] for ref in mention_context_refs(REQUEST, mentions)] == ['selected']


def test_two_views_of_one_table_stay_ambiguous_after_normalization():
    from backend.domains.agent.context_refs import normalize_refs
    from backend.domains.agent.title_replacements import active_title_scope
    second = {**VIEW, 'scope': {**VIEW['scope'], 'view_id': 'resources'}}
    assert active_title_scope(normalize_refs([VIEW, second])) == []
    other_host = {**VIEW, 'scope': {**VIEW['scope'], 'page_id': 'other'}}
    assert active_title_scope(normalize_refs([VIEW, other_host])) == []


def test_host_page_membership_is_rechecked_after_preview(dashboard_runtime):
    from backend.domains.agent.title_replacements import title_view_revisions, validate_title_view
    _, paths, _ = dashboard_runtime
    scope = title_view_revisions([VIEW])[0]
    paths['selected'].write_text('---\n{"id":"selected","title":"Project"}\n---\nNo embedded views now.')
    with pytest.raises(ValueError, match='context_view_unavailable'):
        validate_title_view(scope)


@pytest.mark.parametrize('field_name,storage', [('Nom', 'name'), ('Titre', 'id'),
                                               ('Title', 'alias'), ('Título', 'collision')])
def test_http_title_edits_use_the_visible_schema_field_with_a_stale_internal_title(
    dashboard_runtime, monkeypatch, field_name, storage,
):
    from backend.domains.agent import context_storage, gnosi_support
    from backend.services import agent_team_store as artifacts
    from backend.agent import gnosi_tools
    from backend.agent.action_confirmations import claim_confirmation
    from backend.services.context_vars import active_vault_path
    from backend.services.field_resolver import to_response_names
    fixture, paths, registry = dashboard_runtime
    table = registry['tables'][0]
    field = {'id': 'fld_12345678', 'name': field_name, 'type': 'title', 'aliases': ['Old title']}
    table['properties'] = [field]
    monkeypatch.setattr(gnosi_support, '_table', lambda identifier: table if identifier == table['id'] else None)
    first = context_storage._table_pages('projects')[0]
    visible_title = first.title
    metadata = dict(first.metadata)
    metadata['title'] = 'Outdated internal title'
    key = {'name': field_name, 'id': field['id'], 'alias': 'Old title', 'collision': field_name}[storage]
    metadata[key] = visible_title
    if storage == 'collision':
        metadata.update({field['id']: 'Outdated ID title', 'Old title': 'Outdated alias title'})
    first.metadata = metadata
    paths['row-0'].write_text('---\n' + json.dumps(metadata) + '\n---\n\nOriginal body\n')
    before = {identifier: path.read_bytes() for identifier, path in paths.items()}
    events = _http_chat(fixture, REQUEST, [PAGE, VIEW], [])
    assert fixture[2] == []
    task = artifacts.list_artifacts(fixture[0], 'task')[0]
    assert task['status'] == 'awaiting_confirmation', (task, events)
    confirmation = claim_confirmation(task['confirmations'][0]['confirmation_id'], task['confirmation_scope'])
    arguments = confirmation['arguments']
    first_update = next(update for update in arguments['updates'] if update['id'] == 'row-0')
    assert first_update['title'] == visible_title
    assert first_update['title_field']['name'] == field_name
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
    token = active_vault_path.set(Path(fixture[0].vault_path))
    try:
        result = asyncio.run(gnosi_tools.execute_confirmed_action('bulk_update_rows', arguments, workspace_id='test'))
    finally:
        active_vault_path.reset(token)
    assert result['updated_count'] == 31
    saved, body = gnosi_support._parse(paths['row-0'])
    assert to_response_names(saved, table)[field_name] == 'TFM · Fase1 - Filosofia 0'
    assert saved['title'] == 'TFM · Fase1 - Filosofia 0'
    assert saved['unrelated'] == 'keep-0' and body.strip() == 'Original body'
    assert all(paths[f'row-{i}'].read_bytes() == before[f'row-{i}'] for i in range(31, 748))
    assert paths['selected'].read_bytes() == before['selected']


def test_changing_the_title_field_after_preview_rejects_all_writes(dashboard_runtime, monkeypatch):
    from backend.domains.agent import gnosi_support
    from backend.services import agent_team_store as artifacts
    from backend.agent import gnosi_tools
    from backend.agent.action_confirmations import claim_confirmation
    from backend.services.context_vars import active_vault_path
    fixture, paths, registry = dashboard_runtime
    table = registry['tables'][0]
    table['properties'] = [{'id': 'fld_12345678', 'name': 'Nom', 'type': 'title'}]
    monkeypatch.setattr(gnosi_support, '_table', lambda identifier: table if identifier == table['id'] else None)
    _http_chat(fixture, REQUEST, [PAGE, VIEW], [])
    task = artifacts.list_artifacts(fixture[0], 'task')[0]
    confirmation = claim_confirmation(task['confirmations'][0]['confirmation_id'], task['confirmation_scope'])
    before = {identifier: path.read_bytes() for identifier, path in paths.items()}
    table['properties'][0]['name'] = 'New title field'
    token = active_vault_path.set(Path(fixture[0].vault_path))
    try:
        with pytest.raises(gnosi_tools.ActionConflictError, match='title field changed'):
            asyncio.run(gnosi_tools.execute_confirmed_action('bulk_update_rows', confirmation['arguments'], workspace_id='test'))
    finally:
        active_vault_path.reset(token)
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
