"""Canonical vault slug and API routing regressions."""

import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.data.management_db import Base
from backend.models.management import Vault, Workspace
from backend.services import active_vault_middleware as routing_middleware
from backend.services.vault_routing import assign_vault_slug, slugify_vault_name


def test_vault_slugs_are_stable_and_globally_unique():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add_all([
        Workspace(id="workspace-a", name="A"),
        Workspace(id="workspace-b", name="B"),
    ])
    first = Vault(id="vault-a", workspace_id="workspace-a", name="Història Contemporània")
    second = Vault(id="vault-b", workspace_id="workspace-b", name="Història Contemporània")
    session.add_all([first, second])
    session.flush()

    assert slugify_vault_name(first.name) == "historia-contemporania"
    assert assign_vault_slug(session, first) == "historia-contemporania"
    session.flush()
    assert assign_vault_slug(session, second) == "historia-contemporania-2"
    first.name = "A renamed vault"
    assert assign_vault_slug(session, first) == "historia-contemporania"
    session.close()


def test_canonical_api_route_overrides_conflicting_legacy_header(monkeypatch, tmp_path):
    captured = {}

    async def inner(scope, receive, send):
        captured["path"] = scope["path"]
        captured["headers"] = dict(scope["headers"])
        captured["state"] = scope["state"]
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    monkeypatch.setattr(
        routing_middleware,
        "_resolve_vault_identity",
        lambda identifier: ("canonical-id", str(tmp_path)) if identifier == "principal" else None,
    )
    middleware = routing_middleware.ActiveVaultMiddleware(inner)
    sent = []
    scope = {
        "type": "http",
        "path": "/api/v1/vaults/principal/knowledge/pages/page-1",
        "raw_path": b"/api/v1/vaults/principal/knowledge/pages/page-1",
        "query_string": b"",
        "headers": [(b"x-vault-id", b"conflicting-id")],
        "state": {},
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(middleware(scope, receive, send))

    assert captured["path"] == "/api/vault/pages/page-1"
    assert captured["headers"][b"x-vault-id"] == b"canonical-id"
    assert captured["state"]["canonical_vault_slug"] == "principal"


def test_unknown_canonical_vault_returns_404(monkeypatch):
    async def inner(scope, receive, send):
        raise AssertionError("Unknown vaults must not reach endpoint dispatch")

    monkeypatch.setattr(routing_middleware, "_resolve_vault_identity", lambda identifier: None)
    middleware = routing_middleware.ActiveVaultMiddleware(inner)
    sent = []
    scope = {
        "type": "http",
        "path": "/api/v1/vaults/missing/knowledge/pages",
        "raw_path": b"/api/v1/vaults/missing/knowledge/pages",
        "query_string": b"",
        "headers": [],
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(middleware(scope, receive, send))
    assert sent[0]["status"] == 404
