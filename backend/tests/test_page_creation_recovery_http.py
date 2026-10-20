"""Continuation stays scoped to the authenticated editor and original request."""

import asyncio
from types import SimpleNamespace
import json

from fastapi import FastAPI, APIRouter, BackgroundTasks, HTTPException
import httpx
import pytest

from backend.domains.vault.api import pages_commands
from backend.domains.vault.pages.creation_requests import CreationRequests, _create_with_receipt, creation_scope
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.tests.test_page_creation_responsiveness import dependencies


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    context = SimpleNamespace(user_id="user", workspace_id="workspace", vault_path=tmp_path)
    permission = {"editor": True, "current": True}
    calls = []
    def save(path, metadata, body): path.write_text(json.dumps(metadata) + "\n\n" + body)
    def parse(raw, _path):
        metadata, body = raw.split("\n\n", 1); return json.loads(metadata), body
    def interrupted(*_args): raise HTTPException(503, "Interrupted after save")
    ports = dependencies(tmp_path, save_page=save, parse_frontmatter=parse, checkpoint_post_save=interrupted,
                         update_link_index=lambda *_args: calls.append("links"),
                         propagate_relations=lambda *_args: calls.append("relations"))
    ledger = CreationRequests()
    with pytest.raises(HTTPException):
        _create_with_receipt(ledger, creation_scope("user", "workspace", tmp_path), "key", tmp_path,
            PageSaveRequest(title="QA", content="Body"), BackgroundTasks(), "user", ports)
    def editor():
        if not permission["editor"]: raise HTTPException(403, "Editor required")
    def guard_factory(authenticated):
        frozen = (authenticated.user_id, authenticated.workspace_id, authenticated.vault_path)
        def guard():
            assert frozen == (context.user_id, context.workspace_id, context.vault_path)
            if not permission["current"]: raise HTTPException(403, "Revoked")
        return guard
    monkeypatch.setattr(pages_commands, "recovery_access_guard", guard_factory)
    app = FastAPI(); router = APIRouter()
    pages_commands.register_create_route(router, editor_dependency=editor,
        workspace_context_dependency=lambda: context, dependencies=ports)
    app.include_router(router)
    return app, context, permission, calls, ledger


def request(state, **kwargs):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=state[0]), base_url="http://qa") as client:
            return await client.post("/pages/creation-requests/key/resume", **kwargs)
    return asyncio.run(run())


def test_http_continuation_returns_same_page_and_receipt_on_replay(state, tmp_path):
    before = (tmp_path / "QA.md").read_bytes()
    first = request(state)
    assert first.status_code == 200 and first.json()["content"] == "Body"
    assert request(state).json() == first.json()
    assert state[3] == ["links", "relations"] and (tmp_path / "QA.md").read_bytes() == before


@pytest.mark.parametrize("case", ["viewer", "revoked", "user", "workspace", "vault"])
def test_unavailable_scope_or_permission_cannot_resume(state, tmp_path, case):
    _, context, permission, calls, _ledger = state
    expected = 404
    if case == "viewer": permission["editor"] = False; expected = 403
    elif case == "revoked": permission["current"] = False; expected = 403
    elif case == "user": context.user_id = "other"
    elif case == "workspace": context.workspace_id = "other"
    else: context.vault_path = tmp_path / "other"
    response = request(state)
    assert response.status_code == expected and calls == []


def test_request_headers_cannot_override_authenticated_scope(state):
    response = request(state, headers={"X-User-ID": "other", "X-Workspace-ID": "other", "X-Vault-ID": "other"})
    assert response.status_code == 200 and state[3] == ["links", "relations"]


def test_guard_requires_editor_and_maps_revocation_to_403(tmp_path, monkeypatch):
    from backend.domains.vault.pages.creation_recovery import recovery_access_guard
    from backend.services import agent_execution_scope
    seen = []
    def revalidate(scope):
        seen.append(scope)
        raise PermissionError("revoked")
    monkeypatch.setattr(agent_execution_scope, "revalidate_scope", revalidate)
    context = SimpleNamespace(user_id="u", workspace_id="w", vault_path=tmp_path)
    guard = recovery_access_guard(context)
    context.user_id = "changed"
    with pytest.raises(HTTPException) as caught: guard()
    assert caught.value.status_code == 403
    assert seen[0].user_id == "u" and seen[0].role == "editor" and seen[0].vault_path == str(tmp_path.resolve())
