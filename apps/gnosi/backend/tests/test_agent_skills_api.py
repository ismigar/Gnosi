"""HTTP contract tests for Settings → AI skill and tool resources."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import agent_skills_routes
from backend.models.agent_skills import (
    CatalogOrigin,
    OriginType,
    ToolDescriptor,
)
from backend.services.agent_skill_assignments import AgentSkillAssignmentStore
from backend.services.agent_skill_catalog import SkillCatalog, ToolCatalog
from backend.services.workspace_service import (
    WorkspaceContext,
    get_workspace_context,
)


def test_user_skill_crud_assignment_and_delete_conflict(monkeypatch, tmp_path):
    tool_catalog = ToolCatalog()
    tool_catalog.register_core(
        ToolDescriptor(
            id="core.read-page",
            name="Read page",
            origin=CatalogOrigin(type=OriginType.CORE, id="gnosi"),
        ),
        handler=lambda: None,
    )
    skill_catalog = SkillCatalog(tool_catalog)
    assignment_store = AgentSkillAssignmentStore(
        tmp_path / ".gnosi" / "params.yaml",
        {"ai": {"agents": [{"id": "assistant", "skill_ids": []}]}},
    )
    context = WorkspaceContext(
        workspace_id="personal",
        user_id="owner",
        role="owner",
        vault_path=tmp_path,
    )

    monkeypatch.setattr(
        agent_skills_routes, "get_tool_catalog", lambda: tool_catalog
    )
    monkeypatch.setattr(
        agent_skills_routes, "get_skill_catalog", lambda: skill_catalog
    )
    monkeypatch.setattr(
        agent_skills_routes, "_assignment_store", lambda: assignment_store
    )

    app = FastAPI()
    app.include_router(agent_skills_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)

    created = client.post(
        "/api/ai/skills",
        json={
            "requested_id": "user.reader",
            "name": "Reader",
            "description": "Read a page safely.",
            "instructions": "Use the reader when evidence is needed.",
            "tool_ids": ["core.read-page"],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["id"] == "user.reader"
    assert created.json()["available"] is True

    validated = client.post("/api/ai/skills/user.reader/validate")
    assert validated.status_code == 200
    assert validated.json()["valid"] is True

    updated = client.put(
        "/api/ai/skills/user.reader",
        json={
            "name": "Evidence reader",
            "description": "Read a page safely.",
            "instructions": "Cite the page after reading it.",
            "tool_ids": ["core.read-page"],
            "expected_revision": created.json()["revision"],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Evidence reader"
    assert updated.json()["revision"] != created.json()["revision"]

    cloned = client.post(
        "/api/ai/skills/user.reader/clone",
        json={"name": "Evidence reader clone"},
    )
    assert cloned.status_code == 201, cloned.text
    assert cloned.json()["id"].startswith("user.evidence-reader-clone-")

    listed = client.get("/api/ai/skills")
    assert listed.status_code == 200
    assert any(
        row["id"] == "user.reader" for row in listed.json()["skills"]
    )

    tools = client.get("/api/ai/tools")
    assert tools.status_code == 200
    assert set(tools.json()["tools"][0]["skill_ids"]) == {
        "user.reader",
        cloned.json()["id"],
    }

    assigned = client.put(
        "/api/ai/agents/assistant/skills",
        json={"skill_ids": ["user.reader"]},
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["skill_ids"] == ["user.reader"]

    conflict = client.delete("/api/ai/skills/user.reader")
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["affected_agents"] == ["assistant"]

    deleted = client.delete(
        "/api/ai/skills/user.reader", params={"unassign": "true"}
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["affected_agents"] == ["assistant"]
    assert assignment_store.list_agents_for_skill("user.reader") == []


def test_skill_write_rejects_unregistered_tool(monkeypatch, tmp_path):
    tool_catalog = ToolCatalog()
    skill_catalog = SkillCatalog(tool_catalog)
    context = WorkspaceContext(
        workspace_id="personal",
        user_id="owner",
        role="owner",
        vault_path=tmp_path,
    )
    monkeypatch.setattr(
        agent_skills_routes, "get_tool_catalog", lambda: tool_catalog
    )
    monkeypatch.setattr(
        agent_skills_routes, "get_skill_catalog", lambda: skill_catalog
    )

    app = FastAPI()
    app.include_router(agent_skills_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)

    response = client.post(
        "/api/ai/skills",
        json={
            "name": "Unsafe",
            "instructions": "Pretend the missing tool exists.",
            "tool_ids": ["core.not-registered"],
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["missing_tool_ids"] == [
        "core.not-registered"
    ]


def test_provider_neutral_job_status_result_resume_and_cancel_routes(monkeypatch, tmp_path):
    context = WorkspaceContext(
        workspace_id="personal",
        user_id="owner",
        role="owner",
        vault_path=tmp_path,
    )
    calls = []

    def status(vault_path, job_id):
        calls.append(("status", vault_path, job_id))
        if job_id == "reader:missing-job":
            raise KeyError(job_id)
        return {"job_id": job_id, "status": "running"}

    def result(vault_path, job_id):
        calls.append(("result", vault_path, job_id))
        if job_id == "reader:running-job":
            raise ValueError("The job is not complete.")
        return {"job_id": job_id, "status": "complete", "result": "ready"}

    def cancel(vault_path, job_id):
        calls.append(("cancel", vault_path, job_id))
        return {"job_id": job_id, "status": "cancel_requested"}

    def resume(vault_path, job_id):
        calls.append(("resume", vault_path, job_id))
        return {"job_id": job_id, "status": "queued"}

    monkeypatch.setattr(agent_skills_routes, "get_capability_job_status", status)
    monkeypatch.setattr(agent_skills_routes, "read_capability_job_result", result)
    monkeypatch.setattr(agent_skills_routes, "cancel_capability_job", cancel)
    monkeypatch.setattr(agent_skills_routes, "resume_capability_job", resume)

    app = FastAPI()
    app.include_router(agent_skills_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)

    job_id = "reader:ready-job"
    status_response = client.get(f"/api/ai/jobs/{job_id}")
    result_response = client.get(f"/api/ai/jobs/{job_id}/result")
    cancel_response = client.post(f"/api/ai/jobs/{job_id}/cancel")
    resume_response = client.post(f"/api/ai/jobs/{job_id}/resume")

    assert status_response.status_code == 200
    assert status_response.json()["status"] == "running"
    assert result_response.status_code == 200
    assert result_response.json()["result"] == "ready"
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "cancel_requested"
    assert resume_response.status_code == 200
    assert resume_response.json()["status"] == "queued"
    assert calls == [
        ("status", tmp_path, job_id),
        ("result", tmp_path, job_id),
        ("cancel", tmp_path, job_id),
        ("resume", tmp_path, job_id),
    ]

    assert client.get("/api/ai/jobs/reader:missing-job").status_code == 404
    incomplete = client.get("/api/ai/jobs/reader:running-job/result")
    assert incomplete.status_code == 409
    assert incomplete.json()["detail"] == "The job is not complete."
