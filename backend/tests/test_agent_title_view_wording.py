"""Equivalent view-title requests reach the same scoped action without AI."""
import asyncio

import pytest

from backend.domains.agent.title_replacements import title_replacements
from backend.tests.test_agent_title_mentions import (
    PAGE, VIEW, _http_chat, dashboard_runtime, action_runtime, optional_runtime, team_runtime, view,  # noqa: F401
)

REQUEST = 'Als noms de les tasques de la vista canvia "—" per "-" i "FASE" per "Fase"'
PAIRS = [('—', '-'), ('FASE', 'Fase')]
CA_PAIRS = '"—" per "-" i "FASE" per "Fase"'
VARIANTS = [
    REQUEST,
    f'Als noms de les tasques de la vista activa, substitueix {CA_PAIRS}.',
    f'En els títols dels registres d’aquesta vista modifica {CA_PAIRS}',
    f'Canvia {CA_PAIRS} als noms de les tasques de la vista',
    f'Substitueix en els títols de les files de la vista actual: {CA_PAIRS}',
    'En los nombres de las tareas de la vista cambia "—" por "-" y "FASE" por "Fase"',
    'En los títulos de los registros de esta vista, reemplaza "—" por "-" y "FASE" por "Fase"',
    'Cambia "—" por "-" y "FASE" por "Fase" en los nombres de las filas de la vista activa',
    'Reemplaza en los títulos de las tareas de la vista actual: "—" por "-" y "FASE" por "Fase"',
    'In the names of the tasks in the view change "—" to "-" and "FASE" to "Fase"',
    'In the titles of the records in this view, replace "—" with "-" and "FASE" with "Fase"',
    'Replace "—" with "-" and "FASE" with "Fase" in the names of the rows in the active view',
    'Change in the titles of the tasks in the current view: "—" to "-" and "FASE" to "Fase"',
    'Dans les noms des tâches de la vue remplace «—» par «-» et «FASE» par «Fase»',
    'Dans les titres des enregistrements de cette vue, remplace «—» par «-» et «FASE» par «Fase».',
    'Remplace «—» par «-» et «FASE» par «Fase» dans les noms des lignes de la vue active',
    'Modifie dans les titres des tâches de la vue actuelle : «—» par «-» et «FASE» par «Fase»',
]


@pytest.mark.parametrize('message', VARIANTS)
def test_equivalent_scopes_and_word_orders_preserve_the_exact_operands(message):
    assert title_replacements(message) == PAIRS


@pytest.mark.parametrize('message', [
    'No ' + REQUEST, 'Explica com fer això: ' + REQUEST, '«' + REQUEST + '»',
    REQUEST + ', però no ho facis', REQUEST + ' i elimina les tasques',
    REQUEST + ' a tot el Vault', REQUEST + ' de la vista inactiva',
    REQUEST.replace('noms', 'descripcions'), REQUEST.replace('tasques', 'persones'),
    REQUEST.replace('la vista', 'la vista Arxiu'),
    REQUEST.replace('la vista', 'totes les vistes'),
    f'Canvia {CA_PAIRS} als noms de les tasques de la vista i envia un correu',
    f'Canvia {CA_PAIRS} al nom de la vista',
    f'Canvia {CA_PAIRS} a les fórmules de les files de la vista',
])
def test_other_fields_named_views_negations_and_extra_actions_do_not_take_the_fast_path(message):
    assert title_replacements(message) is None


@pytest.mark.parametrize('message', VARIANTS)
def test_http_equivalent_wording_routes_and_confirms_without_calling_a_provider(dashboard_runtime, message):
    from backend.services import agent_team_store as artifacts
    from backend.agent import gnosi_tools
    from backend.agent.action_confirmations import claim_confirmation
    from backend.services.context_vars import active_vault_path
    fixture, paths, _ = dashboard_runtime
    before = {identifier: path.read_bytes() for identifier, path in paths.items()}
    # Use the real HTTP boundary with no tool grants and an unrelated page ref.
    events = _http_chat(fixture, message, [PAGE, VIEW], [])
    assert fixture[2] == [], 'A local substitution must work even when the provider is unavailable'
    task = artifacts.list_artifacts(fixture[0], 'task')[0]
    assert task['agent_id'] == 'vault' and task['status'] == 'awaiting_confirmation', events
    assert task['required_action_names'] == ['bulk_update_rows']
    assert all(path.read_bytes() == before[identifier] for identifier, path in paths.items())
    confirmation = claim_confirmation(task['confirmations'][0]['confirmation_id'], task['confirmation_scope'])
    assert len(confirmation['arguments']['updates']) == 31
    assert confirmation['arguments']['view_scope']['page_id'] == 'selected'
    token = active_vault_path.set(paths['selected'].parent)
    try:
        result = asyncio.run(gnosi_tools.execute_confirmed_action(
            'bulk_update_rows', confirmation['arguments'], workspace_id='test'))
    finally:
        active_vault_path.reset(token)
    assert result['updated_count'] == 31
    for i in range(748):
        if i < 31:
            assert gnosi_tools._parse(paths[f'row-{i}'])[0]['title'] == f'TFM · F1 - Filosofia {i}'
        else:
            assert paths[f'row-{i}'].read_bytes() == before[f'row-{i}']
    assert paths['selected'].read_bytes() == before['selected']


@pytest.mark.parametrize('refs', [[], [PAGE], [{**VIEW, 'scope': {}}],
    [VIEW, {**VIEW, 'id': 'other', 'scope': {**VIEW['scope'], 'view_id': 'notes'}}]])
def test_new_wording_still_requires_one_selected_view(dashboard_runtime, refs):
    from backend.services import agent_team_store as artifacts
    fixture, paths, _ = dashboard_runtime
    before = {key: path.read_bytes() for key, path in paths.items()}
    events = _http_chat(fixture, REQUEST, refs, [])
    assert fixture[2] == []
    assert not artifacts.list_artifacts(fixture[0], 'task')
    assert any('Selecciona una vista concreta' in str(event) for event in events)
    assert all(path.read_bytes() == before[key] for key, path in paths.items())
