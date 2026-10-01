"""Authorization and round-trip contracts for portable learned skills."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.domains.configuration.agent import learning_routes as routes
from backend.services.agent_skill_catalog import SkillCatalog, ToolCatalog
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


def test_import_review_save_export_and_permission_boundaries(tmp_path, monkeypatch):
    context = WorkspaceContext("synthetic", "owner", "owner", tmp_path)
    tools = ToolCatalog()
    catalog = SkillCatalog(tools)
    monkeypatch.setattr(routes, "_require_configured_agent", lambda _: {"id": "helper"})
    monkeypatch.setattr(routes, "get_tool_catalog", lambda: tools)
    monkeypatch.setattr(routes, "get_skill_catalog", lambda: catalog)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/ai")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)
    skill = {
        "name": "Synthetic review", "instructions": "Compare the supplied facts.",
        "criteria": ["Cites the supplied input"],
        "resources": [{"name": "template.md", "content": "# Comparison"}],
        "examples": [{"name": "Synthetic", "input": "A: 1, B: 2", "expected": "B > A"}],
        "tool_ids": ["core.unavailable"],
    }
    package = {"format": "gnosi-skill-v1", "skill": skill}
    validated = client.post("/api/ai/learning/package/validate", json=package)
    assert validated.status_code == 200
    assert not list(tmp_path.glob("**/SKILL.md"))
    denied_assignment = client.post("/api/ai/learning/skills", json={"agent_id": "helper", "skill": skill, "assign": True})
    assert denied_assignment.status_code == 409
    assert not list(tmp_path.glob("**/SKILL.md"))
    created = client.post("/api/ai/learning/skills", json={"agent_id": "helper", "skill": skill})
    assert created.status_code == 201, created.text
    assert created.json()["missing_tools"] == ["core.unavailable"]
    assert created.json()["assigned"] is False
    exported = client.get(f"/api/ai/skills/{created.json()['skill_id']}/package")
    assert exported.status_code == 200, exported.text
    assert exported.json()["skill"]["resources"] == skill["resources"]
    assert exported.json()["skill"]["examples"] == skill["examples"]
    assert "session_id" not in exported.json()
    context.role = "viewer"
    assert client.post("/api/ai/learning/skills", json={"agent_id": "helper", "skill": skill}).status_code == 403
    assert client.post("/api/ai/learning/trial", json={"agent_id": "helper", "skill": skill, "input": "Synthetic"}).status_code == 403
    assert client.post("/api/ai/learning/package/validate", json=package).status_code == 200
    package["skill"]["resources"] = [{"name": "../private.txt", "content": "Synthetic"}]
    assert client.post("/api/ai/learning/package/validate", json=package).status_code == 422


def test_autosave_reuses_identity_updates_package_and_rejects_stale_edits(tmp_path, monkeypatch):
    from types import SimpleNamespace

    context = WorkspaceContext("synthetic", "owner", "owner", tmp_path)
    tools = ToolCatalog()
    catalog = SkillCatalog(tools)
    monkeypatch.setattr(routes, "_require_configured_agent", lambda _: {"id": "helper"})
    monkeypatch.setattr(routes, "get_tool_catalog", lambda: tools)
    monkeypatch.setattr(routes, "get_skill_catalog", lambda: catalog)
    assignments = SimpleNamespace(ensure_migrated=lambda: None, agent_revision=lambda _: "1",
                                  get_agent=lambda _: {"skill_ids": []}, assign=lambda *args, **kwargs: None)
    monkeypatch.setattr(routes, "_assignment_store", lambda: assignments)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/ai")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)
    skill = {"name": "Autosave", "instructions": "Original", "criteria": ["Grounded"],
             "resources": [{"name": "template.md", "content": "Original template"}]}
    body = {"agent_id": "helper", "skill": skill, "skill_id": "user.learned-synthetic"}
    first = client.post("/api/ai/learning/skills", json=body)
    assert first.status_code == 201, first.text
    # Retrying a response lost in transit must not create another package.
    assert client.post("/api/ai/learning/skills", json=body).json() == first.json()
    assert len(list(tmp_path.glob("**/SKILL.md"))) == 1
    revision = first.json()["revision"]
    skill["instructions"] = "Edited"
    skill["resources"][0]["content"] = "Edited template"
    assert client.post("/api/ai/learning/skills", json=body).status_code == 409
    body["expected_revision"] = revision
    second = client.post("/api/ai/learning/skills", json=body)
    assert second.status_code == 201, second.text
    assert second.json()["skill_id"] == first.json()["skill_id"]
    assert second.json()["revision"] != revision
    assert len(list(tmp_path.glob("**/SKILL.md"))) == 1
    exported = client.get("/api/ai/skills/user.learned-synthetic/package").json()["skill"]
    assert exported["instructions"] == "Edited"
    assert exported["resources"] == skill["resources"]
    skill["instructions"] = "Stale edit"
    assert client.post("/api/ai/learning/skills", json=body).status_code == 409
    assert client.get("/api/ai/skills/user.learned-synthetic/package").json()["skill"]["instructions"] == "Edited"
    body["skill_id"] = "core.example"
    assert client.post("/api/ai/learning/skills", json=body).status_code == 409
