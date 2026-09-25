"""Resource, request and private trace contracts without live model calls."""
import json
import time

import pytest

from backend.services.agent_behavior import inventory, operation_input, resource, task_input
from backend.services import agent_execution_store as store
from backend.services import agent_execution_trace as trace
from backend.services.agent_execution_models import AgentOperation, AgentRun, ExecutionScope


def test_resources_are_addressable_and_paths_cannot_escape():
    assert inventory()
    assert resource("operations/translation/SKILL.md")
    with pytest.raises(ValueError):
        resource("../instructions/gnosy.md")


def test_structured_inputs_preserve_unicode_and_complete_sources():
    text = "Conclusió àlgebra 📚\n" * 20000
    encoded = task_input("knowledge.read", source=text)
    request = AgentOperation(skill_id="core.test", operation="knowledge", data=json.loads(encoded), options={"language": "ca"})
    assert json.loads(operation_input(request))["data"]["data"]["source"] == text


def test_trace_redaction_dedup_and_scope(monkeypatch, tmp_path):
    monkeypatch.setattr(store, "resolve_data_dir", lambda **kwargs: tmp_path)
    scope = ExecutionScope(user_id="alice", workspace_id="team", vault_path=str(tmp_path), role="owner")
    row = AgentRun(run_id="run", agent_id="bot", skill_id="skill", operation="test", origin="button", status="completed", created_at=time.time(), updated_at=time.time())
    store.create(row, scope, {}, {})
    for _ in range(2):
        trace.append(scope, "run", "request", {"api_key": "secret", "source": "complete"})
    page = trace.events(scope, "run", limit=1)
    assert page["events"][0]["value"] == {"api_key": "[redacted]", "source": "complete"}
    assert page["events"][0]["redactions"] == ["$.api_key"]
    assert len(trace.events(scope, "run", after=page["next_cursor"])["events"]) == 1
    with store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM agent_trace_blobs").fetchone()[0] == 1
    with pytest.raises(LookupError):
        trace.events(scope.model_copy(update={"user_id": "bob"}), "run")
    trace.delete(scope, "run")
    assert trace.events(scope, "run")["events"] == []
    assert store.read(scope, "run").status == "completed"


def test_document_actions_resume_from_private_checkpoint(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from backend.services.agent_document_work import synthesize
    from backend.services.agent_execution_models import AgentExecutionSnapshot
    monkeypatch.setattr(store, "resolve_data_dir", lambda **kwargs: tmp_path)
    monkeypatch.setattr("backend.domains.agent.runtime_tools._model_context_window", lambda *_: 16000)
    scope = ExecutionScope(user_id="alice", workspace_id="team", vault_path=str(tmp_path), role="owner")
    row = AgentRun(run_id="parent", agent_id="bot", skill_id="skill", operation="test", origin="button", status="running", created_at=time.time(), updated_at=time.time())
    store.create(row, scope, {}, {})
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id="bot", profile={}, skill_ids=[], instructions=[], catalog_revision="1", revision="1", parent_run_id="parent")
    actions = [{"action": "remember", "arguments": {"text": "Conclusion at the end"}},
               {"action": "finish", "arguments": {"result": {"text": "Conclusion"}, "reviewed": True,
                    "citations": [{"source_id": "book", "quote": "Conclusion"}]}}]
    calls = []
    def invoke(request, **kwargs):
        calls.append(json.loads(request.input))
        return SimpleNamespace(result=json.dumps(actions.pop(0)))
    monkeypatch.setattr("backend.services.agent_execution.run_sync", invoke)
    args = dict(snapshot=snapshot, output_schema={"type": "object", "required": ["text"]})
    with pytest.raises(RuntimeError, match="resume_required"):
        synthesize("notebook", [{"id": "book", "text": "Introduction. Conclusion"}], "Analyze", max_steps=1, **args)
    result = synthesize("notebook", [{"id": "book", "text": "Introduction. Conclusion"}], "Analyze", **args)
    assert result["coverage_complete"]
    assert calls[1]["data"]["memory"] == "Conclusion at the end"
    assert calls[1]["data"]["step"] == 1
    assert synthesize("notebook", [{"id": "book", "text": "Introduction. Conclusion"}], "Analyze", **args) == result
    assert len(calls) == 2


def test_personal_skill_replaces_method_but_keeps_original_tools():
    from backend.models.agent_skills import SkillDescriptor, SkillCatalogEntry, CatalogOrigin, OriginType
    from backend.services.agent_behavior_bindings import effective_entries
    original = SkillDescriptor(id="core.test", name="Original", origin=CatalogOrigin(type=OriginType.CORE, id="gnosi"), instructions="Original method", tool_ids=["core.read"])
    personal = SkillDescriptor(id="user.test", name="Personal", origin=CatalogOrigin(type=OriginType.USER, id="user"), instructions="My method", tool_ids=["core.write"], metadata={"derived_from": {"id": "core.test"}})
    entries = {descriptor.id: SkillCatalogEntry(descriptor=descriptor, available=True, revision=descriptor.id) for descriptor in [original, personal]}
    assigned, resolved, _ = effective_entries({"skill_ids": ["core.test", "user.test"]}, entries)
    assert assigned == ["core.test"]
    assert resolved["core.test"].descriptor.instructions == "My method"
    assert resolved["core.test"].descriptor.tool_ids == ["core.read"]
    entries["core.test"] = entries["core.test"].model_copy(update={"available": False})
    with pytest.raises(ValueError, match="unavailable"):
        effective_entries({"skill_ids": ["user.test"]}, entries)


def test_trace_expiration_preserves_active_work_and_checkpoints(monkeypatch, tmp_path):
    monkeypatch.setattr(store, "resolve_data_dir", lambda **kwargs: tmp_path)
    scope = ExecutionScope(user_id="alice", workspace_id="team", vault_path=str(tmp_path), role="owner")
    for identifier, status in [("closed", "completed"), ("active", "running")]:
        row = AgentRun(run_id=identifier, agent_id="bot", skill_id="skill", operation="test", origin="button", status=status,
                       created_at=time.time(), updated_at=time.time(), closed_at=time.time() - 31 * 86400)
        store.create(row, scope, {}, {})
        trace.append(scope, identifier, "request", {"source": identifier})
        store.work_checkpoint(scope, identifier, "state", {"keep": True})
    trace.expire(scope)
    assert trace.events(scope, "closed")["events"] == []
    assert store.read(scope, "closed").trace_state == "expired"
    assert trace.events(scope, "active")["events"]
    assert store.work_checkpoint(scope, "closed", "state") == {"keep": True}
    assert trace.retention(scope) == 30
    assert trace.retention(scope, 60) == 60


def test_json_tool_transport_validates_and_preserves_usage():
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
    from backend.agent.json_tool_model import JsonToolModel
    class Model:
        model_name = 'test'
        answer = '{"action":"tool","name":"read","arguments":{"id":"book"}}'
        def invoke(self, messages, **kwargs):
            self.messages = messages
            return AIMessage(content=self.answer, usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15})
    provider = Model()
    adapter = JsonToolModel(provider).bind_tools([{"type": "function", "function": {"name": "read", "description": "Read source", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"], "additionalProperties": False}}}])
    response = adapter.invoke([HumanMessage(content='read the book')])
    assert response.tool_calls[0]['args'] == {'id': 'book'}
    assert response.usage_metadata['total_tokens'] == 15
    provider.answer = '{"action":"finish","text":"Read."}'
    final = adapter.invoke([response, ToolMessage(content='original', tool_call_id=response.tool_calls[0]['id'])])
    assert final.content == 'Read.'
    assert not any(isinstance(message, ToolMessage) for message in provider.messages)
    for answer in ('plain answer', '{"action":"tool","name":"delete","arguments":{}}', '{"action":"tool","name":"read","arguments":{"id":4}}'):
        provider.answer = answer
        with pytest.raises(RuntimeError, match='json_tool_contract_unsupported'):
            adapter.invoke([HumanMessage(content='read')])


def test_maintenance_expires_scopes_without_history_access(monkeypatch, tmp_path):
    monkeypatch.setattr(store, 'resolve_data_dir', lambda **kwargs: tmp_path)
    for user, days in [('alice', 1), ('bob', 30)]:
        scope = ExecutionScope(user_id=user, workspace_id='team', vault_path=str(tmp_path), role='owner')
        row = AgentRun(run_id=user, agent_id='bot', skill_id='skill', operation='test', origin='button', status='completed', created_at=time.time() - 172800, updated_at=time.time() - 172800, closed_at=time.time() - 172800)
        store.create(row, scope, {}, {})
        trace.retention(scope, days)
        trace.append(scope, user, 'response', {'text': 'example'})
    trace.maintain()
    with store.connect() as db:
        assert db.execute('SELECT run_id FROM agent_trace_events').fetchall()[0][0] == 'bob'
        assert db.execute('SELECT COUNT(*) FROM agent_trace_events').fetchone()[0] == 1


def test_operation_binding_preserves_settings_and_detects_conflicts(tmp_path):
    from backend.services.agent_skill_assignments import AgentSkillAssignmentStore, AgentAssignmentConflictError
    from backend.services.agent_operation_catalog import skill_id
    params = {'theme': 'dark', 'ai': {'agents': [{'id': 'personal', 'enabled': True, 'skill_ids': [skill_id('podcast')]}]}}
    assignments = AgentSkillAssignmentStore(tmp_path / 'params.yaml', params)
    binding = assignments.bind_operation('podcast', 'personal', 'builtin.feeds-reader.default')
    assert binding == {'agent_id': 'personal', 'skill_id': skill_id('podcast')}
    assert AgentSkillAssignmentStore.load(tmp_path / 'params.yaml').params['theme'] == 'dark'
    with pytest.raises(AgentAssignmentConflictError, match='binding_changed'):
        assignments.bind_operation('podcast', 'personal', 'builtin.feeds-reader.default')
    with pytest.raises(RuntimeError):
        assignments.bind_operation('podcast', 'missing', 'personal')
    assert assignments.params['ai']['operation_bindings']['podcast'] == binding


def test_unreadable_source_cannot_disappear_from_coverage(monkeypatch, tmp_path):
    from backend.services.agent_document_work import synthesize
    from backend.services.agent_execution_models import AgentExecutionSnapshot
    monkeypatch.setattr('backend.domains.agent.runtime_tools._model_context_window', lambda *_: 16000)
    scope = ExecutionScope(user_id='alice', workspace_id='team', vault_path=str(tmp_path), role='owner')
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id='bot', profile={}, skill_ids=[], instructions=[], catalog_revision='1', revision='1')
    with pytest.raises(ValueError, match='source_unreadable:missing'):
        synthesize('notebook', [{'id': 'readable', 'text': 'Full text'}, {'id': 'missing', 'text': ''}], 'Analyze', snapshot=snapshot, output_schema={'type': 'object'})
