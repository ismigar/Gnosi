"""Exercise FastAPI dispatch, including worker execution and vault context."""

from __future__ import annotations

import asyncio
from threading import Event
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from backend.data.db import get_db
from backend.domains.mail.routes import messages, tags, views
from backend.services.context_vars import active_vault_path
from backend.services.integration_manager import integration_manager
from backend.services.workspace_service import get_workspace_context


@pytest.mark.parametrize(
    "method,path,payload,status",
    [
        ("GET", "/views", None, 200),
        ("GET", "/tags", None, 200),
        ("GET", "/messages/synthetic/tags", None, 200),
        ("GET", "/tags/synthetic/messages", None, 404),
        ("POST", "/tags/messages/batch", {"message_ids": ["synthetic"]}, 200),
    ],
)
def test_slow_mail_database_does_not_block_other_requests(tmp_path, method, path, payload, status):
    async def scenario():
        loop = asyncio.get_running_loop()
        contexts = []

        class SlowQuery:
            def query(self, *args):
                served = Event()
                contexts.append(active_vault_path.get())
                loop.call_soon_threadsafe(served.set)
                assert served.wait(2), "Mail database query blocked other requests"
                return self

            def filter(self, *args):
                return self

            def order_by(self, *args):
                return self

            def all(self):
                return []

            def first(self):
                return None

        app = FastAPI()
        assert tags.router is views.router
        app.include_router(tags.router)
        app.dependency_overrides[get_db] = SlowQuery
        app.dependency_overrides[get_workspace_context] = lambda: None
        token = active_vault_path.set(tmp_path)
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.request(method, f"/api/mail{path}", json=payload)
                assert response.status_code == status, response.text
            assert contexts and all(context == tmp_path for context in contexts)
        finally:
            active_vault_path.reset(token)

    asyncio.run(scenario())


@pytest.mark.parametrize("endpoint", ["counts", "list", "detail", "cached-list"])
def test_cold_provider_loading_leaves_loop_available(monkeypatch, tmp_path, endpoint):
    async def scenario():
        loop = asyncio.get_running_loop()
        observed = []
        original_import = messages.importlib.import_module
        provider = SimpleNamespace(
            imap_get_counts=lambda email: {},
            imap_list_messages=lambda *a, **k: {"messages": []},
            imap_get_message=lambda *a: {"id": "synthetic"},
        )

        def slow_import(name, *args, **kwargs):
            if name != "backend.services.hybrid_mail_service":
                return original_import(name, *args, **kwargs)
            served = Event()
            observed.append(active_vault_path.get())
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), "Provider import blocked other requests"
            return provider

        messages._COUNTS_CACHE.clear()
        messages._MAIL_CACHE.clear()
        monkeypatch.setattr(messages.importlib, "import_module", slow_import)
        monkeypatch.setattr(integration_manager, "is_microsoft_account", lambda acc: False)
        monkeypatch.setattr(integration_manager, "is_imap_account", lambda acc: True)
        # The account must be truthy, even though its secrets are irrelevant here.
        monkeypatch.setattr(integration_manager, "get_mail_account", lambda email, **kwargs: {"email": email})
        token = active_vault_path.set(tmp_path)
        try:
            if endpoint == "counts":
                assert await messages.get_mail_counts("a@example.test") == {}
            elif endpoint == "detail":
                assert await messages.get_message("synthetic", "a@example.test", "INBOX") == {
                    "id": "synthetic"
                }
            else:
                if endpoint == "cached-list":
                    messages._MAIL_CACHE.set("a@example.test|None|None|None|0|None", {"messages": []})
                result = await messages.get_messages(
                    "a@example.test", None, None, 20, 0, None, None, False
                )
                assert result["messages"] == []
            assert observed == ([] if endpoint == "cached-list" else [tmp_path])
        finally:
            active_vault_path.reset(token)
            messages._COUNTS_CACHE.clear()
            messages._MAIL_CACHE.clear()

    asyncio.run(scenario())
