"""Selected skills use the common executor and cannot bypass row contracts."""

import asyncio
import json
from types import SimpleNamespace

from fastapi import HTTPException
from jsonschema import ValidationError
import pytest

from backend.services import button_skill_execution as service
from backend.domains.vault.translation import routes
from backend.domains.vault.translation.request_contracts import ExecuteButtonActionRequest


@pytest.fixture
def skill(monkeypatch):
    entry = SimpleNamespace(available=True, descriptor=SimpleNamespace(id="core.gnosi-tables"), revision="initial")
    monkeypatch.setattr(service, "current_scope", lambda: SimpleNamespace(vault_path="/fixture"))
    monkeypatch.setattr(service, "get_skill_catalog", lambda: SimpleNamespace(get_entry=lambda *_args: entry))
    fields = [{"id": "count-id", "name": "count", "type": "number", "options": []},
              {"id": "flag-id", "name": "flag", "type": "checkbox", "options": []}]
    monkeypatch.setattr(service, "resolve_button_fields", lambda _metadata: fields)
    return entry, fields


def test_skill_executor_receives_actual_fields_and_immutable_revision(skill, monkeypatch):
    entry, fields = skill
    calls = []
    def run(request):
        calls.append(request)
        entry.revision = "changed while generating"
        return SimpleNamespace(result=json.dumps({"assignments": [{"field": "count", "value": 0}, {"field": "flag", "value": False}]}))
    monkeypatch.setattr(service, "run_sync", run)
    result = service.generate_skill_assignments(entry.descriptor.id, "Title", {"untouched": 0}, "Body")
    assert result[0] == fields and result[3] == "initial"
    assert calls[0].skill_id == entry.descriptor.id and calls[0].origin == "button"
    assert calls[0].data["editable_fields"] == fields and calls[0].data["content"] == "Body"
    monkeypatch.setattr(service, "revalidate_scope", lambda _scope: None)
    with pytest.raises(HTTPException) as error: service.revalidate_button_skill(result[2], result[3])
    assert error.value.status_code == 409


@pytest.mark.parametrize("assignments", [[], [{"field": "unknown", "value": "x"}],
                                      [{"field": "flag", "value": 0}],
                                      [{"field": "count", "value": 1}, {"field": "count", "value": 2}]])
def test_skill_invalid_output_is_rejected_before_commit(skill, monkeypatch, assignments):
    monkeypatch.setattr(service, "run_sync", lambda _request: SimpleNamespace(result=json.dumps({"assignments": assignments})))
    with pytest.raises(ValidationError): service.generate_skill_assignments("core.gnosi-tables", "Title", {}, "Body")


def test_unavailable_skill_does_not_call_model(skill, monkeypatch):
    skill[0].available = False
    monkeypatch.setattr(service, "run_sync", lambda _request: pytest.fail("Unavailable skill invoked the model"))
    with pytest.raises(HTTPException) as error: service.generate_skill_assignments("core.gnosi-tables", "Title", {}, "Body")
    assert error.value.status_code == 422


def test_skill_receives_relation_candidates_without_changing_the_field_schema(skill, monkeypatch):
    field = {"id": "links", "name": "Links", "type": "relation", "relation_database_id": "resources"}
    monkeypatch.setattr(service, "resolve_button_fields", lambda _metadata: [field])
    context = SimpleNamespace(candidates=({"field": "Links", "candidates": [{"id": "target", "content": "Relevant evidence"}]},))
    monkeypatch.setattr(service, "build_button_relation_context", lambda fields: context)
    calls = []
    def run(request):
        calls.append(request)
        return SimpleNamespace(result='{"assignments":[{"field":"Links","value":"target"}]}')
    monkeypatch.setattr(service, "run_sync", run)
    result = service.generate_skill_assignments("core.gnosi-tables", "Title", {}, "Body")
    assert result[0] == [field] and result[4] is context
    assert calls[0].data["relation_candidates"][0]["candidates"][0]["id"] == "target"
    assert calls[0].data["editable_fields"] == [field]


def test_route_executes_and_commits_one_typed_skill_result(tmp_path, monkeypatch):
    from backend.services import button_page_mutations
    path = tmp_path / "row.md"; path.write_text("original")
    monkeypatch.setattr(routes._legacy, "find_page_path", lambda _id: path)
    monkeypatch.setattr(routes._legacy, "parse_frontmatter", lambda *_args: ({"id": "row", "title": "Title"}, "Body"))
    async def lock(_id): return asyncio.Lock()
    monkeypatch.setattr(routes._legacy, "_get_page_write_lock", lock)
    assignments = [{"field": "count", "value": 0}, {"field": "flag", "value": False}]
    monkeypatch.setattr(service, "generate_skill_assignments", lambda *_args: ([], assignments, "skill", "revision", SimpleNamespace(validate=lambda: None)))
    checks, commits = [], []
    monkeypatch.setattr(service, "revalidate_button_skill", lambda *args: checks.append(args))
    async def commit(*args, guard):
        guard()
        commits.append(args)
        return {"id": "row", "count": 0, "flag": False}
    monkeypatch.setattr(button_page_mutations, "commit_button_mutation", commit)
    result = asyncio.run(routes.execute_button_action(ExecuteButtonActionRequest(
        note_id="row", button_action="run_skill", button_config={"skill_id": "skill"})))
    assert result["status"] == "ok" and result["updated_fields"] == ["count", "flag"]
    assert checks == [("skill", "revision")] and len(commits) == 1
    assert commits[0][2] == "original" and commits[0][4] == assignments
    assert routes.ExecuteButtonActionResponse.model_validate(result).metadata["flag"] is False
