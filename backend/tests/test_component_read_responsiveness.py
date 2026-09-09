"""Slow component reads must not stall unrelated requests or lose vault context."""

from __future__ import annotations

import asyncio
import inspect
import json
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request, Response

from backend.api import calendar_routes, vault_graph_routes
from backend.domains.mail.routes import compose, messages
from backend.domains.vault.media import routes as media_routes
from backend.services import hybrid_calendar_service, hybrid_mail_service, meeting_reminders
from backend.services.context_vars import active_vault_path
from backend.services.integration_manager import integration_manager


@pytest.mark.parametrize(
    "endpoint",
    [
        "mail-counts",
        "mail-list",
        "mail-detail",
        "mail-thread",
        "mail-folders",
        "calendars",
        "reminders",
        "reminder-settings",
        "event",
        "graph",
        "graph-encoding",
        "media-roots",
        "media-page",
        "media-albums",
        "media-tree",
        "media-views",
    ],
)
def test_component_reads_leave_loop_available(monkeypatch, tmp_path, endpoint):
    async def scenario():
        loop = asyncio.get_running_loop()
        observed = []

        def slow(value):
            served = Event()
            observed.append(active_vault_path.get())
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), f"{endpoint} blocked unrelated requests"
            return value

        token = active_vault_path.set(tmp_path)
        try:
            if endpoint.startswith("media-"):
                method, route, payload = {
                    "media-roots": ("get_roots", media_routes.get_media_roots, []),
                    "media-page": (
                        "get_all_media", media_routes.get_all_media,
                        {"items": [], "total": 0, "limit": 50, "offset": 0},
                    ),
                    "media-albums": ("get_albums", media_routes.get_albums, []),
                    "media-tree": ("get_tree_node", media_routes.get_media_tree, []),
                    "media-views": ("list_views", media_routes.list_media_views, []),
                }[endpoint]
                service = SimpleNamespace(**{method: lambda *a, **k: slow(payload)})
                monkeypatch.setattr(media_routes, "_media_service", lambda: service)
                kwargs = {
                    name: Response() if name == "response" else parameter.default.default
                    for name, parameter in inspect.signature(route).parameters.items()
                }
                assert await route(**kwargs) == payload
            elif endpoint.startswith("mail-"):
                messages._COUNTS_CACHE.clear()
                messages._MAIL_CACHE.clear()
                monkeypatch.setattr(integration_manager, "get_mail_account", lambda _, **kwargs: slow(None))
                if endpoint == "mail-counts":
                    with pytest.raises(HTTPException) as unavailable:
                        await messages.get_mail_counts("a@example.test")
                    assert unavailable.value.status_code == 503
                elif endpoint == "mail-list":
                    monkeypatch.setattr(
                        hybrid_mail_service,
                        "imap_list_messages",
                        lambda *a, **k: slow({"messages": []}),
                    )
                    assert (
                        await messages.get_messages(
                            "a@example.test", None, None, 20, 0, None, None, False
                        )
                    )["messages"] == []
                elif endpoint == "mail-thread":
                    assert await messages.get_thread("one", "a@example.test") == {"messages": []}
                elif endpoint == "mail-detail":
                    monkeypatch.setattr(
                        integration_manager,
                        "get_mail_account",
                        lambda _: slow({"provider": "imap"}),
                    )
                    monkeypatch.setattr(integration_manager, "is_imap_account", lambda _: True)
                    monkeypatch.setattr(
                        hybrid_mail_service, "imap_get_message", lambda *a: slow({"id": "one"})
                    )
                    assert await messages.get_message("one", "a@example.test", "INBOX") == {
                        "id": "one"
                    }
                else:
                    monkeypatch.setattr(compose, "_is_imap_account", lambda _: slow(True))
                    monkeypatch.setattr(
                        compose.imap_sync_service, "list_folders", lambda _: slow([])
                    )
                    assert await compose.get_folders("a@example.test") == {"folders": []}
            elif endpoint == "calendars":
                monkeypatch.setattr(integration_manager, "get_all_safe", lambda: slow({}))
                monkeypatch.setattr(calendar_routes, "fetch_calendar_lists", lambda _: slow([]))
                assert await calendar_routes.get_calendars(Response(), None) == []
            elif endpoint == "reminders":
                monkeypatch.setattr(meeting_reminders, "get_active", lambda: slow([]))
                assert await calendar_routes.get_meeting_reminders() == {"reminders": []}
            elif endpoint == "reminder-settings":
                monkeypatch.setattr(meeting_reminders, "get_settings", lambda: slow({}))
                assert await calendar_routes.get_meeting_reminder_settings() == {}
            elif endpoint == "event":
                monkeypatch.setattr(
                    hybrid_calendar_service, "get_event", lambda *a: slow({"id": "one"})
                )
                assert await calendar_routes.get_event("one", "a@example.test", "primary") == {
                    "id": "one"
                }
            else:
                payload = {"nodes": [], "edges": [], "legend": {"kinds": [], "clusters": []}}
                if endpoint == "graph-encoding":
                    original_dump = vault_graph_routes._GRAPH_RESPONSE_ADAPTER.dump_json
                    monkeypatch.setattr(
                        vault_graph_routes._GRAPH_RESPONSE_ADAPTER,
                        "dump_json", lambda *args, **kwargs: slow(original_dump(*args, **kwargs)),
                    )
                monkeypatch.setattr(
                    vault_graph_routes,
                    "GraphService",
                    lambda: slow(SimpleNamespace(build_unified_graph=lambda: slow(payload))),
                )
                request = Request({"type": "http", "headers": []})
                assert json.loads((await vault_graph_routes.get_vault_graph(request)).body) == payload
            assert observed and all(value == tmp_path for value in observed)
        finally:
            active_vault_path.reset(token)

    previous: Path | None = active_vault_path.get()
    asyncio.run(scenario())
    assert active_vault_path.get() == previous
