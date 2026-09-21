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
