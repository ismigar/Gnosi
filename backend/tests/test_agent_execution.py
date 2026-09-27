"""Conformance tests for principal operations without provider calls or user data."""
import asyncio
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage

from backend.services import agent_execution as execution
from backend.services import agent_execution_store as store
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.services.principal_agent_migration import migrate


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    scope = ExecutionScope(user_id="alice", workspace_id="team", vault_path=str(tmp_path), role="owner")
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id="personal", profile={"id": "personal", "managed_by": "builtin:ai-platform", "enabled": True}, skill_ids=["core.gnosi-operation-writing"], instructions=["Use the assigned procedure"], catalog_revision="1", revision="v1")
    monkeypatch.setattr(store, "resolve_data_dir", lambda **kwargs: tmp_path)
    monkeypatch.setattr(execution, "revalidate_scope", lambda scope: None)
    from backend.config import app_config
    monkeypatch.setattr(app_config, "load_params", lambda **kwargs: SimpleNamespace(ai={"agents": [snapshot.profile]}, paths={}))
    from backend.services import agent_skill_catalog
    @dataclass
    class Runtime:
        active_skill_ids: tuple = tuple(snapshot.skill_ids)
        instructions: tuple = tuple(snapshot.instructions)
        catalog_revision: str = "1"
    monkeypatch.setattr(agent_skill_catalog, "resolve_agent_runtime", lambda *args, **kwargs: Runtime())
    return scope, snapshot


def test_migration_preserves_personal_brain_and_disabled_features():
    params = {"ai": {"active_agent_id": "mine", "agents": [{"id": "mine", "name": "Brain", "skill_ids": ["user.existing"]}, {"id": "llm-wiki", "managed_by": "llm-wiki", "persona": "Knowledge only", "model": "model"}]}}
    migrated, changed = migrate(params, {"ai-platform"})
    assert changed
    assert params["ai"]["agents"][1]["id"] == "llm-wiki"
    personal = migrated["ai"]["agents"][0]
    assert personal["name"] == "Brain"
    assert "core.gnosi-operation-reader" not in personal["skill_ids"]
    assert migrated["ai"]["retired_profiles"]["llm-wiki"]["persona"] == "Knowledge only"
    assert migrate(migrated, {"ai-platform"}) == (migrated, False)


def test_migration_replaces_managed_principal_without_global_knowledge_instructions():
    params = {"ai": {"active_agent_id": "llm-wiki", "agents": [{"id": "llm-wiki", "managed_by": "llm-wiki", "persona": "Knowledge only", "provider": "local", "model": "m"}]}}
    migrated, _ = migrate(params, {"llm-wiki"})
    ai = migrated["ai"]
    assert ai["active_agent_id"] == "principal"
    assert ai["agents"][0]["persona"] == ""
    assert ai["agents"][0]["model"] == "m"
    assert ai["knowledge_legacy_instructions"] == "Knowledge only"


def install_workflow(monkeypatch, answers):
    from backend.agent import factory
    calls = []
    class Application:
        async def astream(self, inputs, **kwargs):
            calls.append(inputs)
            yield {"operation": {"messages": [AIMessage(content=answers[len(calls)-1])]}}
        def compile(self):
            return self
    async def create(*args, **kwargs):
        assert kwargs["operation_mode"]
        assert kwargs["runtime_capabilities"].instructions == ("Use the assigned procedure",)
        return Application(), {"model": "fake", "provider": "test"}
    monkeypatch.setattr(factory, "create_agent_workflow", create)
    return calls


def test_structured_repair_once_and_scope_isolation(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, ['bad json', '{"answer": "ok"}'])
    request = AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="input", output_schema={"type": "object", "required": ["answer"]})
    with execution_scope(scope):
        result = asyncio.run(execution.execute_operation(request, snapshot=snapshot))
    assert result.status == "completed"
    assert len(calls) == 2
    assert store.read(scope, result.run_id).model == "fake"
    with pytest.raises(LookupError):
        store.read(scope.model_copy(update={"user_id": "bob"}), result.run_id)
    with pytest.raises(LookupError):
        store.cancel(scope.model_copy(update={"vault_path": "/other"}), result.run_id)


def test_invalid_result_fails_after_one_repair(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, ['bad', 'bad'])
    with execution_scope(scope), pytest.raises(ValueError):
        asyncio.run(execution.execute_operation(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="", output_schema={"type": "object"}), snapshot=snapshot))
    assert len(calls) == 2
    row = store.list_runs(scope)[0]
    assert row.status == "failed"
    assert not row.result


def test_scope_and_skill_mismatch_rejected_before_model(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, [])
    with execution_scope(scope), pytest.raises(PermissionError):
        asyncio.run(execution.execute_operation(AgentOperation(skill_id="user.unassigned", operation="writing", input=""), snapshot=snapshot))
    assert not calls
    assert not store.list_runs(scope)


def test_real_operation_graph_uses_policy_and_complete_instructions(runtime, monkeypatch):
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from backend.domains.agent.operation_graph import operation_workflow
    from backend.agent import model_router
    from backend.agent import factory
    scope, snapshot = runtime
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap": False})
    async def create(*args, **kwargs):
        return operation_workflow(FakeListChatModel(responses=['{"answer":"yes"}']), "Complete procedure", 16000), {"provider":"fake", "model":"fake"}
    monkeypatch.setattr(factory, "create_agent_workflow", create)
    with execution_scope(scope):
        row = asyncio.run(execution.execute_operation(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="test", output_schema={"type":"object","required":["answer"]}), snapshot=snapshot))
    assert row.status == "completed"
    assert row.model_calls == 1


def test_revoked_permission_prevents_all_model_calls(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, [])
    def revoked(_scope):
        raise PermissionError("revoked")
    monkeypatch.setattr(execution, "revalidate_scope", revoked)
    with execution_scope(scope), pytest.raises(PermissionError):
        asyncio.run(execution.execute_operation(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="test"), snapshot=snapshot))
    assert not calls


def test_cancelled_parent_blocks_phase_before_transport(runtime, monkeypatch):
    from backend.services.agent_cancellation import AgentTurnCancelled
    from backend.agent import model_router
    scope, snapshot = runtime
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap": False})
    with execution_scope(scope):
        parent = execution.create_job_run(snapshot, "batch", "reader.analysis")
        store.cancel(scope, "batch")
        token = execution._run.set("batch")
        try:
            with pytest.raises(AgentTurnCancelled):
                execution.before_model_call()
        finally:
            execution._run.reset(token)
    assert parent.parent_run_id == "batch"
    assert store.read(scope, "batch").model_calls == 0


def test_interrupted_run_can_resume_once_with_frozen_instructions(runtime, monkeypatch):
    import json
    scope, snapshot = runtime
    install_workflow(monkeypatch, ["old", "retried"])
    with execution_scope(scope):
        first = execution.run_sync(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="input"), snapshot=snapshot)
        store.update(scope, first.run_id, status="running")
        with store.connect() as db:
            request = json.loads(db.execute("SELECT request FROM agent_runs WHERE run_id=?", (first.run_id,)).fetchone()[0])
            request["_worker_pid"] = 2147483647
            db.execute("UPDATE agent_runs SET request=? WHERE run_id=?", (json.dumps(request), first.run_id))
        assert store.read(scope, first.run_id).status == "interrupted"
        retry = asyncio.run(execution.resume_run(first.run_id))
        assert retry.result == "retried"
        assert retry.parent_run_id == first.run_id
        assert retry.execution_revision == snapshot.revision
        with pytest.raises(ValueError, match="not_resumable"):
            asyncio.run(execution.resume_run(first.run_id))
    assert len(store.list_runs(scope)) == 2


def test_semantic_phase_and_engines_cannot_resume_as_plain_text(runtime):
    import time
    from backend.services.agent_execution_models import AgentRun
    scope, snapshot = runtime
    for identifier, request in [("semantic", {"resume_requires_parent": True}), ("engine", {"mode": "specialized"})]:
        store.create(AgentRun(run_id=identifier, agent_id=snapshot.agent_id, skill_id=snapshot.skill_ids[0], operation=identifier, origin="worker", status="failed", created_at=time.time(), updated_at=time.time()), scope, request, snapshot.model_dump())
        with pytest.raises(ValueError, match="original_entrypoint"):
            store.resume_data(scope, identifier)
        assert store.read(scope, identifier).status == "failed"


def test_resume_claim_is_atomic_and_rejects_changed_role(runtime):
    scope, snapshot = runtime
    with execution_scope(scope):
        execution.create_job_run(snapshot, "batch", "reader.analysis")
        store.update(scope, "batch", status="failed")
        with pytest.raises(PermissionError):
            store.resume_data(scope.model_copy(update={"role":"editor"}), "batch")
        store.resume_data(scope, "batch")
        with pytest.raises(ValueError, match="not_resumable"):
            store.resume_data(scope, "batch")


def test_failed_model_never_calls_legacy_provider(runtime, monkeypatch):
    from backend.agent import factory
    scope, snapshot = runtime
    async def unavailable(*args, **kwargs):
        return None, {}
    monkeypatch.setattr(factory, "create_agent_workflow", unavailable)
    with execution_scope(scope), pytest.raises(RuntimeError, match="model_unavailable"):
        execution.run_sync(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="input"), snapshot=snapshot)
    assert store.list_runs(scope)[0].status == "failed"


def test_durable_phase_checkpoint_prevents_duplicate_model_execution(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, ['first', 'second'])
    request = AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="phase")
    with execution_scope(scope):
        frozen = execution.create_job_run(snapshot, "durable", "notebook.analysis")
        first = execution.run_sync(request, snapshot=frozen)
        retry = execution.run_sync(request, snapshot=frozen)
        assert first.run_id == retry.run_id
        changed = execution.run_sync(request.model_copy(update={"input":"different evidence"}), snapshot=frozen)
        assert changed.run_id != first.run_id
    assert len(calls) == 2


def test_format_repair_is_charged_to_parent_budget(runtime, monkeypatch):
    from backend.agent import model_router, factory
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from backend.domains.agent.operation_graph import operation_workflow
    scope, snapshot = runtime
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap":False})
    async def create(*args, **kwargs):
        return operation_workflow(FakeListChatModel(responses=['invalid', '{}']), "procedure", 16000), {}
    monkeypatch.setattr(factory, "create_agent_workflow", create)
    with execution_scope(scope):
        frozen = execution.create_job_run(snapshot, "capped", "reader.analysis", max_calls=1)
        with pytest.raises(RuntimeError, match="job_call_budget"):
            execution.run_sync(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="phase", output_schema={"type":"object"}), snapshot=frozen)
    assert store.read(scope, "capped").model_calls == 1


def test_migration_backup_and_scoped_companion_survive_repetition(monkeypatch, tmp_path):
    import yaml
    from backend.services import principal_agent_migration, builtin_plugins
    from backend.config import app_config
    from backend.api import vault_routes as configuration_routes
    from backend.services.user_skill_store import UserSkillStore
    path = tmp_path / 'params.yaml'
    original = {"ai":{"active_agent_id":"llm-wiki", "agents":[{"id":"llm-wiki", "managed_by":"llm-wiki", "model":"original-model", "persona":"Only use cited sources"}]}, "scheduler":{"disabled-job":{"enabled":False}}}
    path.write_text(yaml.safe_dump(original))
    def config(**_kwargs):
        data = yaml.safe_load(path.read_text())
        return SimpleNamespace(params=data, ai=data['ai'], params_source=path)
    monkeypatch.setattr(app_config, 'load_params', config)
    monkeypatch.setattr(configuration_routes, '_load_plugins_state', lambda: {})
    monkeypatch.setattr(builtin_plugins, 'is_enabled', lambda _state, identifier: identifier in {'ai-platform','llm-wiki'})
    scope = ExecutionScope(user_id='owner',workspace_id='personal',vault_path=str(tmp_path),role='owner')
    with execution_scope(scope):
        first = principal_agent_migration.ensure_migrated()
        second = principal_agent_migration.ensure_migrated()
    assert first == second
    assert yaml.safe_load(path.with_name('params.yaml.before-principal-v1').read_text()) == original
    assert yaml.safe_load(path.read_text())['scheduler'] == original['scheduler']
    skills, errors = UserSkillStore(tmp_path).load_all()
    assert not errors
    assert len(skills) == 1
    assert skills[0].instructions == 'Only use cited sources'
    assert skills[0].metadata['companion_for'] == ['core.gnosi-operation-knowledge', 'plugin.llm-wiki.process-source']
    assert first['agents'][0]['persona'] == ''


def test_knowledge_aliases_reuse_handlers_and_guards():
    from fastapi import APIRouter, Depends
    from backend.domains.vault.knowledge.aliases import knowledge_aliases
    def guard():
        return None
    source = APIRouter(dependencies=[Depends(guard)])
    @source.get('/llm-wiki/status/{item_id}')
    def status(item_id: str):
        return {'id':item_id}
    alias = knowledge_aliases(source).routes[0]
    assert alias.path == '/knowledge/status/{item_id}'
    assert alias.endpoint is status
    assert any(dependency.dependency is guard for dependency in alias.dependencies)


def test_nested_skill_uses_frozen_assignment_and_instructions(runtime):
    _scope, snapshot = runtime
    frozen = snapshot.model_copy(update={"skill_instructions":{"user.capture":"Original procedure"}, "skill_companions":{}})
    selected = execution.select_snapshot_skill(frozen, 'user.capture')
    assert selected.instructions == ['Original procedure']
    assert selected.profile == snapshot.profile
    assert selected.revision != snapshot.revision
    with pytest.raises(PermissionError):
        execution.select_snapshot_skill(frozen, 'user.unassigned')


def test_deadline_cancels_inflight_model_task(runtime, monkeypatch):
    import threading
    from backend.agent import factory, model_router
    from backend.domains.agent.operation_graph import operation_workflow
    scope, snapshot = runtime
    stopped = threading.Event()
    class SlowModel:
        async def ainvoke(self, *_args, **_kwargs):
            try:
                await asyncio.sleep(60)
            finally:
                stopped.set()
    async def create(*_args, **_kwargs):
        return operation_workflow(SlowModel(), "procedure", 16000), {}
    monkeypatch.setattr(factory, 'create_agent_workflow', create)
    monkeypatch.setattr(model_router, 'budget_status', lambda: {'over_cap':False})
    with execution_scope(scope), pytest.raises(TimeoutError):
        execution.run_sync(AgentOperation(skill_id=snapshot.skill_ids[0], operation='writing', input='input', timeout_seconds=1), snapshot=snapshot)
    assert stopped.wait(2), 'The provider task must not survive the operation deadline'


def test_cancellation_reaches_grandchild_model_tokens(runtime):
    from backend.services.agent_cancellation import create_cancel_token, is_cancelled, release
    scope, snapshot = runtime
    with execution_scope(scope):
        execution.create_job_run(snapshot, 'root', 'conversation-group')
        execution.create_job_run(snapshot, 'child', 'podcast')
        store.update(scope, 'child', parent_run_id='root')
        execution.create_job_run(snapshot, 'grandchild', 'phase')
        store.update(scope, 'grandchild', parent_run_id='child')
        token = create_cancel_token()
        execution._tokens['grandchild'] = token
        try:
            execution.cancel_run('root')
            assert is_cancelled(token)
            assert store.cancelled(scope, 'grandchild')
        finally:
            execution._tokens.pop('grandchild', None)
            release(token)


def test_snapshot_freezes_file_instructions(monkeypatch, runtime, tmp_path):
    from backend.domains.agent import workflow
    scope, original = runtime
    monkeypatch.setattr(workflow, "INSTRUCTIONS_DIR", tmp_path)
    persona = tmp_path / "personal.md"
    persona.write_text("Original instructions")
    frozen = execution.snapshot_from_runtime(scope, original.profile, SimpleNamespace())
    persona.write_text("Changed instructions")
    resumed = execution.snapshot_from_runtime(scope, frozen.profile, SimpleNamespace())
    assert frozen.profile["_execution_detailed_persona"] == "Original instructions"
    assert resumed.profile["_execution_detailed_persona"] == "Original instructions"
    assert "_execution_detailed_persona" not in original.profile


def test_same_pid_restart_is_interrupted_and_resume_claims_new_instance(runtime, monkeypatch):
    scope, snapshot = runtime
    with execution_scope(scope):
        execution.create_job_run(snapshot, "reused-pid", "reader.analysis")
        store.update(scope, "reused-pid", status="running")
        monkeypatch.setattr(store, "_WORKER_INSTANCE", "new-process-instance")
        assert store.read(scope, "reused-pid").status == "interrupted"
        request, _ = store.resume_data(scope, "reused-pid")
        assert "_worker_instance" not in request
        assert store.read(scope, "reused-pid").status == "resuming"
        store.update(scope, "reused-pid", status="running")
        assert store.read(scope, "reused-pid").status == "running"


@pytest.mark.parametrize("source", [
    "from groq import Groq as Client\nClient()",
    "client.chat.completions.create(model='legacy')",
    "client.responses.create(model='legacy')",
    "client.messages.create(model='legacy')",
])
def test_static_boundary_rejects_direct_provider_calls(tmp_path, monkeypatch, source):
    from scripts import check_agent_execution_boundary as boundary
    monkeypatch.setattr(boundary, "ROOT", tmp_path)
    module = tmp_path / "feature.py"
    module.write_text(source)
    assert boundary.violations(module)


def test_http_adapters_bind_authenticated_scope_before_the_handler(monkeypatch, tmp_path):
    from fastapi import APIRouter, FastAPI
    from fastapi.testclient import TestClient
    from backend.app import routes
    from backend.services import principal_agent_migration
    from backend.services.agent_execution_scope import current_scope
    from backend.services.context_vars import get_active_vault_path
    from backend.services.workspace_service import get_workspace_context

    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: {})
    monkeypatch.setattr(routes, "require_plugins", lambda *args: lambda: None)
    adapters = {
        "agent_router": "/api", "ai_routes": "/api", "reader": "",
        "mail_routes": "", "social_routes": "/api/social", "meeting_routes": "",
        "calendar_routes": "", "vault_routes": "/api/vault", "handwriting_routes": "",
        "literature_routes": "", "notebook_routes": "", "agent_skills_routes": "/api",
        "config_routes": "/api",
    }
    def probe():
        return {"scope": current_scope().model_dump(), "vault": str(get_active_vault_path())}
    for name in adapters:
        router = APIRouter()
        router.add_api_route(f"/scope-probe-{name}", probe)
        if name == "agent_router":
            monkeypatch.setattr(routes, name, router)
        else:
            monkeypatch.setattr(getattr(routes, name), "router", router)
    app = FastAPI()
    context = SimpleNamespace(user_id="alice", workspace_id="team", role="editor", vault_path=tmp_path)
    app.dependency_overrides[get_workspace_context] = lambda: context
    routes.register_routers(app)
    with TestClient(app) as client:
        for name, prefix in adapters.items():
            response = client.get(f"{prefix}/scope-probe-{name}")
            assert response.status_code == 200, (name, response.text)
            assert response.json() == {
                "scope": {"user_id": "alice", "workspace_id": "team", "role": "editor", "vault_path": str(tmp_path)},
                "vault": str(tmp_path),
            }
    with pytest.raises(RuntimeError, match="agent_execution_scope_required"):
        current_scope()


@pytest.mark.parametrize("origin", ["button", "chat", "automation", "worker"])
def test_operation_and_durable_job_keep_the_trigger_origin(runtime, monkeypatch, origin):
    scope, snapshot = runtime
    snapshot = snapshot.model_copy(update={"origin": origin})
    install_workflow(monkeypatch, ["Result"])
    with execution.operation_session(snapshot):
        job_snapshot = execution.create_job_run(snapshot, "job", "reader.analysis")
        assert store.read(scope, "job").origin == origin
        with execution.operation_session(job_snapshot):
            result = execution.generate_result_for("writing", "Summarize")
        assert result.origin == origin
        assert result.parent_run_id == "job"
    from backend.services.agent_execution_scope import current_origin
    assert current_origin() == "button"


def test_editor_http_request_runs_executor_and_returns_activity_id(runtime, monkeypatch, tmp_path):
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient
    from backend.domains.configuration.ai.content_routes import router
    from backend.services import principal_agent_migration
    from backend.services.agent_execution_scope import bind_request_scope
    from backend.services.agent_run_middleware import AgentRunMiddleware
    from backend.services.workspace_service import get_workspace_context

    scope, snapshot = runtime
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: {})
    monkeypatch.setattr(execution, "prepare_snapshot", lambda *args, **kwargs: snapshot)
    calls = install_workflow(monkeypatch, ["Text generated by the principal"])
    app = FastAPI()
    app.add_middleware(AgentRunMiddleware)
    app.include_router(router, dependencies=[Depends(bind_request_scope)])
    app.dependency_overrides[get_workspace_context] = lambda: SimpleNamespace(
        user_id=scope.user_id, workspace_id=scope.workspace_id, role=scope.role, vault_path=tmp_path,
    )
    with TestClient(app) as client:
        response = client.post("/generate", json={"prompt": "Write a note"})
    assert response.status_code == 200, response.text
    assert response.json() == {"content": "Text generated by the principal", "provider": "fake"}
    row = store.read(scope, response.headers["X-Agent-Run-Id"])
    assert row.status == "completed" and row.origin == "button"
    assert row.skill_id == "core.gnosi-operation-writing" and len(calls) == 1
