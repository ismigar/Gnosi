"""Semantic proposals must produce scoped, verified native previews, never writes."""
import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import ValidationError

from backend.domains.agent.title_edit_contract import TitleEdit, ViewEditDecision
from backend.domains.agent.title_replacements import title_view_revisions
from backend.services.agent_title_continuation import MARKER
from backend.tests.test_agent_title_mentions import (  # noqa: F401
    VIEW, _http_chat, dashboard_runtime, action_runtime, optional_runtime, team_runtime, view,
)

REQUEST = 'Ara per a tots els "TFM - Fx -" on x € [1..n] transforma\'ls a "TFM - Fx:"'


def edit(**updates):
    return TitleEdit.model_validate({'operation': 'transform_titles', 'field': 'title',
        'scope': 'active_view', 'condition': {'kind': 'all', 'value': ''},
        'changes': [{'kind': 'numbered_replace', 'source': 'TFM - F{n} -',
                     'target': 'TFM - F{n}:', 'position': 'start'}], **updates})


def decision(program=None):
    return ViewEditDecision(kind='edit', edit=program or edit(), question='').model_dump_json()


@pytest.mark.parametrize('before,after', [
    ('TFM - F1 - Text', 'TFM - F1: Text'), ('TFM - F27 - Text', 'TFM - F27: Text'),
    ('TFM - F1: Text', 'TFM - F1: Text'), ('TFM - Fx - Text', 'TFM - Fx - Text'),
    ('TFM - F0 - Text', 'TFM - F0 - Text'), ('TFM - F01 - Text', 'TFM - F01 - Text'),
    ('Other TFM - F1 - Text', 'Other TFM - F1 - Text'),
    ('TFM - F1000000000 - Text', 'TFM - F1000000000 - Text'),
    ('TFM - F3 - Text - suffix', 'TFM - F3: Text - suffix'),
])
def test_numbered_template_preserves_number_suffix_and_nonmatches(before, after):
    assert edit().apply(before) == after


@pytest.mark.parametrize('kind,source,target,before,after', [
    ('replace', 'Fase ', 'F', 'TFM - Fase 21: Text', 'TFM - F21: Text'),
    ('replace', 'a.*', r'\1', 'Literal a.* title', r'Literal \1 title'),
    ('prefix', '', '[Review] ', 'Text', '[Review] Text'),
    ('suffix', '', ' (done)', 'Text', 'Text (done)'),
    ('trim', '', '', ' Text  ', 'Text'), ('lower', '', '', 'TEXT', 'text'),
    ('upper', '', '', 'text', 'TEXT'),
])
def test_general_text_operations_are_literal_and_bounded(kind, source, target, before, after):
    program = edit(changes=[{'kind': kind, 'source': source, 'target': target, 'position': 'any'}])
    assert program.apply(before) == after


def test_condition_applies_to_original_and_leaves_other_titles_untouched():
    program = edit(condition={'kind': 'starts_with', 'value': 'Note:'},
        changes=[{'kind': 'replace', 'source': 'draft', 'target': 'final', 'position': 'any'}])
    assert program.apply('Note: draft') == 'Note: final'
    assert program.apply('Other: draft') == 'Other: draft'


@pytest.mark.parametrize('updates', [
    {'field': 'status'}, {'scope': 'vault'}, {'operation': 'execute'}, {'code': 'print(1)'},
    {'changes': []}, {'changes': [{'kind': 'regex', 'source': '.*', 'target': 'X', 'position': 'any'}]},
    {'changes': [{'kind': 'numbered_replace', 'source': 'F{n}', 'target': 'F1', 'position': 'any'}]},
    {'changes': [{'kind': 'numbered_replace', 'source': '{n}', 'target': 'F{n}', 'position': 'any'}]},
])
def test_models_cannot_expand_the_executable_contract(updates):
    with pytest.raises(ValidationError):
        edit(**updates)


@pytest.mark.parametrize('kind', ['other', 'clarify'])
def test_inactive_schema_payload_never_becomes_an_edit(kind):
    value = ViewEditDecision.model_validate({'kind': kind, 'edit': edit().model_dump(), 'question': 'Quin canvi?'})
    assert value.edit is None
    assert value.question == ('Quin canvi?' if kind == 'clarify' else '')


def _seed(fixture, paths):
    from backend.domains.agent import context_storage
    from backend.agent import gnosi_tools
    for page in context_storage._table_pages('projects'):
        # Mixed phases, punctuation, matches and nonmatches, inside and outside view.
        number = int(page.id.split('-')[1])
        title = f'TFM - F{number % 15 + 1}{":" if number % 3 == 0 else " -"} Text {number}'
        meta, body = gnosi_tools._parse(page.path)
        meta['title'] = title
        page.path.write_text('---\n' + json.dumps(meta) + '\n---\n' + body)
        page.title, page.metadata = title, meta
    fixture[3]['_responses'] = {'director': [AIMessage(content=decision())]}
    return {identifier: path.read_bytes() for identifier, path in paths.items()}


def test_http_semantic_edit_routes_to_vault_and_prepares_every_changed_row_with_one_call(dashboard_runtime):
    from backend.services import agent_team_store as artifacts
    fixture, paths, _ = dashboard_runtime
    before = _seed(fixture, paths)
    events = _http_chat(fixture, REQUEST, [VIEW], [])
    assert fixture[2] == ['director']
    task = artifacts.list_artifacts(fixture[0], 'task')[0]
    assert task['agent_id'] == 'vault' and task['status'] == 'awaiting_confirmation'
    changes = task['confirmations'][0]['details']['updates']
    assert {row['id'] for row in changes} == {f'row-{i}' for i in range(31) if i % 3}
    assert all(row['to'] == edit().apply(row['from']) for row in changes)
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
    assert any(event['type'] == 'confirmation_required' for event in events)
    assert not any(event.get('type') == 'assistant' and 'confirmation_required' in str(event) for event in events)
    from backend.tests.test_agent_title_followups import _confirm_in_test
    from backend.agent import gnosi_tools
    applied = _confirm_in_test(fixture, task)
    assert applied['updated_count'] == len(changes)
    expected = {row['id']: row['to'] for row in changes}
    for identifier, path in paths.items():
        if identifier in expected:
            metadata, body = gnosi_tools._parse(path)
            assert metadata['title'] == expected[identifier]
            assert metadata['unrelated'] == 'keep-' + identifier.split('-')[1]
            assert 'Original body' in body
        else:
            assert path.read_bytes() == before[identifier]


def test_assent_reuses_verified_program_without_another_model_or_approving(dashboard_runtime):
    from backend.services import agent_team_store as artifacts
    fixture, paths, _ = dashboard_runtime
    before = _seed(fixture, paths)
    _http_chat(fixture, REQUEST, [VIEW], [])
    _http_chat(fixture, 'fes-ho', [VIEW], [])
    assert fixture[2] == ['director']
    tasks = artifacts.list_artifacts(fixture[0], 'task')
    assert len(tasks) == 2
    assert len({task['confirmations'][0]['confirmation_id'] for task in tasks}) == 2
    assert all(task['status'] == 'awaiting_confirmation' for task in tasks)
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())


@pytest.mark.parametrize('text,answer', [
    ('No canviïs els títols, explica què significa Fx.', {'kind': 'other', 'edit': None, 'question': ''}),
    ('Canvia aquests títols com toca.', {'kind': 'clarify', 'edit': None, 'question': 'Quin canvi vols fer als títols?'}),
])
def test_nonedit_and_ambiguous_requests_do_not_prepare_mutations(dashboard_runtime, text, answer):
    from backend.services import agent_team_store as artifacts
    from backend.services.agent_team_models import TeamPlan
    fixture, paths, _ = dashboard_runtime
    before = {key: path.read_bytes() for key, path in paths.items()}
    fixture[3]['_responses'] = {'director': [AIMessage(content=json.dumps(answer)),
        AIMessage(content=TeamPlan(response='Fx indica una fase.', response_kind='conversation').model_dump_json())]}
    _http_chat(fixture, text, [VIEW], [])
    assert not artifacts.list_artifacts(fixture[0], 'task')
    assert all(path.read_bytes() == before[key] for key, path in paths.items())


def test_invalid_decision_stops_without_long_planning_or_tools(dashboard_runtime):
    from backend.services import agent_team_store as artifacts
    fixture, _, _ = dashboard_runtime
    fixture[3]['_responses'] = {'director': [AIMessage(content='{"kind":"edit"}')]}
    events = _http_chat(fixture, REQUEST, [VIEW], [])
    assert fixture[2] == ['director']
    assert not artifacts.list_artifacts(fixture[0], 'task')
    assert 'interpretació' in json.dumps(events, ensure_ascii=False)


def test_changed_view_invalidates_previous_program_scope(dashboard_runtime):
    from backend.services.agent_title_continuation import resolve_title_turn
    fixture, _, registry = dashboard_runtime
    marker = {'owner_id': 'director', 'request': REQUEST, 'view_scope': title_view_revisions([VIEW])[0],
              'program': edit().model_dump()}
    registry['views'][0]['filters'] = []
    history = [HumanMessage(content=REQUEST), AIMessage(content='Review', additional_kwargs={MARKER: marker}), HumanMessage(content='fes-ho')]
    _, recovered, clarify = resolve_title_turn('fes-ho', {'messages': history}, [VIEW], 'director', fixture[0])
    assert recovered is None and clarify


def test_view_changed_during_interpretation_cannot_prepare_a_write(dashboard_runtime, monkeypatch):
    from backend.services import agent_view_edit, agent_team_store as artifacts
    fixture, paths, registry = dashboard_runtime
    before = _seed(fixture, paths)
    async def interpreted(*args, **kwargs):
        registry['views'][0]['filters'] = []
        return ViewEditDecision.model_validate_json(decision())
    monkeypatch.setattr(agent_view_edit, 'interpret_view_edit', interpreted)
    events = _http_chat(fixture, REQUEST, [VIEW], [])
    assert not any(event['type'] == 'confirmation_required' for event in events)
    assert all(not task['confirmations'] for task in artifacts.list_artifacts(fixture[0], 'task'))
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
