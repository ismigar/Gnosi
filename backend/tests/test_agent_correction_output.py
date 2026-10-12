"""Concrete reference violations trigger one counted action-free correction."""
import asyncio
import json

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from backend.services.agent_correction_contracts import correction_contract
from backend.services.agent_correction_output import CheckedCorrectionOutput, checked_correction_workflow
from backend.services.agent_behavior import resource
from backend.services import agent_execution as execution, agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.tests.test_agent_execution import runtime  # noqa: F401


@pytest.fixture(autouse=True)
def synthetic_money_budget(monkeypatch):
    monkeypatch.setattr('backend.agent.model_router.budget_status', lambda: {'over_cap':False})


@pytest.mark.parametrize("instruction,bad,good", [
    ('Corregeix: «Aquestes proposta son útil.»', 'Aquesta proposta és útil.', 'Aquestes propostes són útils.'),
    ('Corregeix: «Aquesta propostes són útils.»', 'Aquestes propostes són útils.', 'Aquesta proposta és útil.'),
    ('Corrige en español: «Esta solicitudes no están completa.»', 'Estas solicitudes no están completas.', 'Esta solicitud no está completa.'),
    ('Corrige en français : «Cette propositions sont utile.»', 'Ces propositions sont utiles.', 'Cette proposition est utile.'),
    ('Correct in English: «These proposals are useful.»', 'This proposal is useful.', 'These proposals are useful.'),
    ('Corregeix la frase en anglès: «These proposals are useful.»', 'This proposal is useful.', 'These proposals are useful.'),
    ('Corregeix: «Jo han revisat R-31.»', 'Ell ha revisat R-31.', 'Jo he revisat R-31.'),
])
def test_changed_explicit_reference_is_rejected(instruction, bad, good):
    contract = correction_contract(instruction)
    assert contract is not None
    with pytest.raises(ValueError, match="reference_changed"):
        contract.validate(bad)
    assert contract.validate(good) == good


@pytest.mark.parametrize("instruction,good", [
    ('Corregeix: «Aquestes llibres són útils.»', 'Aquests llibres són útils.'),
    ('Corrige en español: «Esta documento es útil.»', 'Este documento es útil.'),
    ('Corrige en español: «Estas decisión no esta aprobada.»', 'Estas decisiones no están aprobadas.'),
    ('Corrige en español: «Estas cansado.»', 'Estás cansado.'),
    ('Corrige en français : «Ces décision n’est pas définitive.»', 'Ces décisions ne sont pas définitives.'),
    ('Corrige en français : «Je ai confirmé R-03.»', "J’ai confirmé R-03."),
    ('Correct in English: «These two proposal is not approved; P-008 stays unchanged.»', 'These two proposals are not approved; P-008 stays unchanged.'),
])
def test_gender_accents_and_agreement_repairs_are_not_reference_changes(instruction, good):
    contract = correction_contract(instruction)
    assert contract is not None
    assert contract.validate(good) == good


@pytest.mark.parametrize("bad,error", [
    ('These three proposals are not approved; P-008 stays unchanged.', 'quantity_changed'),
    ('These two proposals are not approved; Z-008 stays unchanged.', 'identifier_changed'),
    ('These two proposals are approved; P-008 stays unchanged.', 'negation_lost'),
])
def test_quantities_ids_and_negation_are_preserved(bad, error):
    contract = correction_contract('Correct in English: «These two proposal is not approved; P-008 stays unchanged.»')
    assert contract is not None
    with pytest.raises(ValueError, match=error):
        contract.validate(bad)


@pytest.mark.parametrize("instruction", [
    'Tradueix: «Corregeix aquest text.»', 'Correct this text without a quoted source.',
    'Corregeix i passa a singular: «Aquestes proposta son útil.»',
    'Correct: «This text». Return JSON {"text":"..."}',
    'Corregeix: «Una frase» i «Una altra».', 'Corregeix el codi: «this = 1»',
    'Corregeix i desa: «Aquestes proposta son útil.»',
    'Correct and make it formal: «This text is good.»', 'Corregeix: «».',
])
def test_unrecognized_or_explicit_transforming_requests_use_the_original_workflow(instruction):
    assert correction_contract(instruction) is None


@pytest.mark.parametrize("repair,completed", [('Aquestes propostes són útils.', True), ('Aquesta proposta és útil.', False)])
def test_one_repair_uses_same_executor_no_tools_and_is_counted(runtime, monkeypatch, repair, completed):
    from backend.agent import factory
    from backend.domains.agent.operation_graph import operation_workflow
    scope, snapshot = runtime
    configurations = []
    async def create(*args, **kwargs):
        configurations.append(kwargs)
        return operation_workflow(FakeListChatModel(responses=[repair]), 'Use the assigned procedure', 16000), {'provider':'fake', 'model':'fake'}
    monkeypatch.setattr(factory, 'create_agent_workflow', create)
    instruction = 'Corregeix: «Aquestes proposta son útil.»'
    contract = correction_contract(instruction)
    assert contract is not None
    original = operation_workflow(FakeListChatModel(responses=['Aquesta proposta és útil.']), 'Use the assigned procedure', 16000).compile()
    app = CheckedCorrectionOutput(original, contract, snapshot, 'correction-parent', instruction)
    visible = []
    async def run():
        from langchain_core.messages import HumanMessage
        async for event in execution.stream_workflow(app, {'messages':[HumanMessage(content=instruction)], 'trace_id':'correction-parent'},
                config={'recursion_limit':4}, origin='chat', snapshot=snapshot, max_calls=2):
            visible.extend(m.text for update in event.values() for m in update.get('messages', []) if getattr(m,'type','')=='ai')
    with execution_scope(scope):
        if completed:
            asyncio.run(run())
            assert visible == [repair]
        else:
            with pytest.raises(ValueError, match='reference_changed'):
                asyncio.run(run())
            assert visible == []
    assert len(configurations) == 1 and configurations[0]['prepared_agent_data']['id'] == snapshot.agent_id
    assert configurations[0]['operation_read_tools'] is False
    assert configurations[0]['operation_team_help'] is False
    runs = store.list_runs(scope)
    assert len(runs) == 2 and sum(r.model_calls for r in runs) == 2
    assert all(r.status == ('completed' if completed else 'failed') for r in runs)
    child = next(r for r in runs if r.operation == 'writing.correct.repair')
    with store.connect() as db:
        saved = json.loads(db.execute('SELECT request FROM agent_runs WHERE run_id=?', (child.run_id,)).fetchone()[0])
    assert saved['parent_run_id'] == 'correction-parent' and saved['max_model_calls'] == 1 and saved['tool_mode'] == 'none'
    assert saved['input'] == 'Aquestes proposta son útil.'


def test_guard_is_scoped_to_current_builtin_method_and_skips_principal(runtime):
    _, snapshot = runtime
    original = object()
    data = {'user_request':'Corregeix: «Aquestes proposta son útil.»'}
    assert checked_correction_workflow(original, data, snapshot, 'id') is original
    snapshot.instructions = [resource('operations/writing/SKILL.md')]
    assert isinstance(checked_correction_workflow(original, data, snapshot, 'id'), CheckedCorrectionOutput)
    assert checked_correction_workflow(original, {**data, 'turn_authorized_tool_names':['save']}, snapshot, 'id') is original
    snapshot.profile['team'] = {'enabled':True}
    assert checked_correction_workflow(original, data, snapshot, 'id') is original


def test_a_correct_result_needs_no_repair(runtime, monkeypatch):
    from backend.domains.agent.operation_graph import operation_workflow
    from langchain_core.messages import HumanMessage
    scope, snapshot = runtime
    instruction = 'Corregeix: «Aquestes proposta son útil.»'
    contract = correction_contract(instruction)
    assert contract is not None
    async def forbidden(*args, **kwargs):
        raise AssertionError('A valid correction must not instruction another model')
    monkeypatch.setattr('backend.agent.factory.create_agent_workflow', forbidden)
    original = operation_workflow(FakeListChatModel(responses=['Aquestes propostes són útils.']), 'Use the assigned procedure', 16000).compile()
    app = CheckedCorrectionOutput(original, contract, snapshot, 'valid-parent', instruction)
    async def run():
        return [event async for event in execution.stream_workflow(app, {'messages':[HumanMessage(content=instruction)], 'trace_id':'valid-parent'},
            config={'recursion_limit':4}, origin='chat', snapshot=snapshot, max_calls=1)]
    with execution_scope(scope):
        asyncio.run(run())
    runs = store.list_runs(scope)
    assert len(runs) == 1 and runs[0].model_calls == 1 and runs[0].status == 'completed'


def test_a_repair_cannot_exceed_the_parent_call_budget(runtime, monkeypatch):
    from backend.domains.agent.operation_graph import operation_workflow
    from langchain_core.messages import HumanMessage
    scope, snapshot = runtime
    model = FakeListChatModel(responses=['Aquestes propostes són útils.', 'unused'])
    async def create(*args, **kwargs):
        return operation_workflow(model, 'Use the assigned procedure', 16000), {'provider':'fake', 'model':'fake'}
    monkeypatch.setattr('backend.agent.factory.create_agent_workflow', create)
    instruction = 'Corregeix: «Aquestes proposta son útil.»'
    contract = correction_contract(instruction)
    assert contract is not None
    original = operation_workflow(FakeListChatModel(responses=['Aquesta proposta és útil.']), 'Use the assigned procedure', 16000).compile()
    app = CheckedCorrectionOutput(original, contract, snapshot, 'budget-parent', instruction)
    visible = []
    async def run():
        async for event in execution.stream_workflow(app, {'messages':[HumanMessage(content=instruction)], 'trace_id':'budget-parent'},
                config={'recursion_limit':4}, origin='chat', snapshot=snapshot, max_calls=1):
            visible.append(event)
    with execution_scope(scope), pytest.raises(Exception, match='budget'):
        asyncio.run(run())
    assert not visible and model.i == 0
    assert sum(r.model_calls for r in store.list_runs(scope)) == 1


def test_tool_execution_is_not_repeated_for_a_text_repair(runtime, monkeypatch):
    from langchain_core.messages import AIMessage, ToolMessage
    _, snapshot = runtime
    effects = []
    class Original:
        async def astream(self, *args, **kwargs):
            effects.append('tool executed once')
            yield {'agent':{'messages':[AIMessage(content='', tool_calls=[{'name':'save','args':{},'id':'one'}])]}}
            yield {'tools':{'messages':[ToolMessage(content='saved',tool_call_id='one')]}}
            yield {'agent':{'messages':[AIMessage(content='Aquesta proposta és útil.')]}}
    async def forbidden(*args, **kwargs):
        raise AssertionError('A tool workflow must not request a corrective action replay')
    monkeypatch.setattr(execution,'execute_operation',forbidden)
    instruction = 'Corregeix: «Aquestes proposta son útil.»'
    contract = correction_contract(instruction)
    assert contract is not None
    app = CheckedCorrectionOutput(Original(), contract, snapshot, 'unused', instruction)
    async def run():
        return [event async for event in app.astream({},config={},stream_mode='updates')]
    assert len(asyncio.run(run())) == 3 and effects == ['tool executed once']
