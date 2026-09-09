"""Cold vault routing must not pause unrelated requests or mix vault contexts."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.data.management_db import Base
from backend.models.management import Vault, Workspace
from backend.services import active_vault_middleware as routing
from backend.services.context_vars import active_vault_path


@pytest.fixture(autouse=True)
def clear_identity_cache():
    routing.reset_vault_path_cache()
    yield
    routing.reset_vault_path_cache()


@pytest.mark.parametrize("signal", ["canonical", "header", "query", "cookie", "websocket"])
def test_cold_lookup_keeps_request_loop_available_and_restores_context(monkeypatch, signal):
    async def scenario():
        loop = asyncio.get_running_loop()
        request_loop_available = Event()
        expected_path = Path("/requested-vault")

        def slow_lookup(identifier):
            assert identifier == "principal"
            loop.call_soon_threadsafe(request_loop_available.set)
            assert request_loop_available.wait(2), "Vault lookup blocked every request"
            return "vault-id", str(expected_path)

        monkeypatch.setattr(routing, "_read_vault_identity", slow_lookup)
        received = []

        async def inner(scope, receive, send):
            received.append(scope["path"])
            assert active_vault_path.get() == expected_path
            assert await asyncio.to_thread(active_vault_path.get) == expected_path

        scope = {
            "type": "websocket" if signal == "websocket" else "http",
            "path": "/api/vault/pages",
            "query_string": b"vault=principal" if signal == "query" else b"",
            "headers": [],
        }
        if signal == "canonical":
            scope["path"] = "/api/v1/vaults/principal/knowledge/pages"
        if signal == "header":
            scope["headers"] = [(b"x-vault-id", b"principal")]
        if signal in {"cookie", "websocket"}:
            scope["headers"] = [(b"cookie", b"gnosi_active_vault=principal")]

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(_message):
            pass

        outer_path = Path("/outer-context")
        token = active_vault_path.set(outer_path)
        try:
            await routing.ActiveVaultMiddleware(inner)(scope, receive, send)
            assert received == ["/api/vault/pages"]
            assert active_vault_path.get() == outer_path
        finally:
            active_vault_path.reset(token)

    asyncio.run(scenario())


def test_parallel_requests_share_one_lookup_but_other_vaults_can_progress(monkeypatch):
    started = Event()
    release = Event()
    calls = []

    def read(identifier):
        calls.append(identifier)
        if identifier == "slow":
            started.set()
            assert release.wait(3)
        return identifier, f"/{identifier}"

    monkeypatch.setattr(routing, "_read_vault_identity", read)
    with ThreadPoolExecutor(max_workers=3) as pool:
        first = pool.submit(routing._resolve_vault_identity, "slow")
        assert started.wait(2)
        second = pool.submit(routing._resolve_vault_identity, "slow")
        try:
            other = pool.submit(routing._resolve_vault_identity, "other")
            assert other.result(timeout=2) == ("other", "/other")
        finally:
            release.set()
        assert first.result(timeout=2) == second.result(timeout=2) == ("slow", "/slow")
    assert calls.count("slow") == 1


def test_invalidation_during_lookup_cannot_repopulate_an_old_identity(monkeypatch):
    started = Event()
    release = Event()
    calls = []

    def read(identifier):
        calls.append(identifier)
        if len(calls) == 1:
            started.set()
            assert release.wait(3)
            return "vault-id", "/old-path"
        return "vault-id", "/new-path"

    monkeypatch.setattr(routing, "_read_vault_identity", read)
    with ThreadPoolExecutor(max_workers=1) as pool:
        old = pool.submit(routing._resolve_vault_identity, "principal")
        assert started.wait(2)
        try:
            routing.reset_vault_path_cache()
            assert routing._resolve_vault_identity("principal") == ("vault-id", "/new-path")
        finally:
            release.set()
        assert old.result(timeout=2) == ("vault-id", "/old-path")
    assert routing._resolve_vault_identity("principal") == ("vault-id", "/new-path")
    assert len(calls) == 2


def test_missing_identity_is_cached_briefly_and_can_be_retried(monkeypatch):
    calls = []

    def read(identifier):
        calls.append(identifier)
        return None if len(calls) == 1 else ("vault-id", "/new-path")

    monkeypatch.setattr(routing, "_read_vault_identity", read)
    assert routing._resolve_vault_identity("principal") is None
    assert routing._resolve_vault_identity("principal") is None
    assert len(calls) == 1
    monkeypatch.setattr(routing, "_TTL", 0)
    assert routing._resolve_vault_identity("principal") == ("vault-id", "/new-path")


@pytest.mark.parametrize("existing_slug", ["principal", None])
def test_known_slug_avoids_backfill_but_legacy_rows_still_resolve(
    monkeypatch, tmp_path, existing_slug,
):
    from backend.data import management_db
    from backend.services import vault_routing

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add(Workspace(id="workspace", name="Workspace"))
        db.flush()
        db.add(Vault(
            id="vault-id", workspace_id="workspace", name="Principal",
            slug=existing_slug, path_override=str(tmp_path),
        ))
        db.commit()
    monkeypatch.setattr(management_db, "_get_or_init_mgmt_engine", lambda: (engine, sessions))
    if existing_slug:
        def unexpected_backfill(_db):
            raise AssertionError("Existing slugs must not scan or migrate every vault")
        monkeypatch.setattr(vault_routing, "ensure_vault_slugs", unexpected_backfill)
    assert routing._read_vault_identity("principal") == ("vault-id", str(tmp_path))
    engine.dispose()
