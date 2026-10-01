"""Deferred optional effects must honor current state in their original vault."""

from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import BackgroundTasks

from backend.api import vault_routes  # Initialize the compatibility composition first.

assert vault_routes is not None
from backend.app import lifespan
from backend.domains.calendar import google
from backend.domains.configuration import plugin_state
from backend.domains.configuration.api import plugin_lifecycle
from backend.domains.mail.sync.idle import ImapIdleManager
from backend.domains.vault.pages import runtime
from backend.services import builtin_plugins, google_calendar_service, plugin_access
from backend.services.context_vars import active_vault_path, get_active_vault_path


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin_state, "_store", None)
    root = tmp_path / "origin"
    root.mkdir()
    token = active_vault_path.set(root)
    try:
        yield root
    finally:
        active_vault_path.reset(token)


def set_enabled(root: Path, plugin: str, enabled: bool) -> None:
    state, _ = builtin_plugins.normalize_state({})
    state = builtin_plugins.set_enabled(state, plugin, enabled)
    directory = root / ".gnosi"
    directory.mkdir(exist_ok=True)
    (directory / "plugins.json").write_text(json.dumps(state), encoding="utf-8")


def calendar_metadata():
    return {"source": "Google Calendar (fixture@example.invalid)",
            "uid": "fixture", "title": "Local title"}


def test_disabled_calendar_does_not_schedule_provider(vault):
    set_enabled(vault, "calendar", False)
    tasks = BackgroundTasks()
    runtime.sync_to_google_calendar_if_needed(calendar_metadata(), tasks)
    assert tasks.tasks == []


@pytest.mark.parametrize("disable_origin", [False, True])
def test_queued_calendar_uses_current_origin_state(vault, tmp_path, monkeypatch, disable_origin):
    set_enabled(vault, "calendar", True)
    tasks = BackgroundTasks()
    runtime.sync_to_google_calendar_if_needed(calendar_metadata(), tasks)
    assert len(tasks.tasks) == 1
    if disable_origin:
        set_enabled(vault, "calendar", False)
    other = tmp_path / "other"
    other.mkdir()
    set_enabled(other, "calendar", not disable_origin)
    observed = []
    monkeypatch.setattr(google_calendar_service, "update_google_event",
                        lambda *args: observed.append((get_active_vault_path(), args)))
    token = active_vault_path.set(other)
    try:
        asyncio.run(tasks())
        assert get_active_vault_path() == other
    finally:
        active_vault_path.reset(token)
    assert len(observed) == (0 if disable_origin else 1)
    if observed:
        assert observed[0][0] == vault


def test_google_update_does_not_open_credentials_when_disabled(vault):
    set_enabled(vault, "calendar", False)
    provider_factory = MagicMock()
    assert not google.update_google_event("fixture@example.invalid", "fixture", {},
                                          service_factory=provider_factory)
    provider_factory.assert_not_called()


def test_google_update_rechecks_before_patch(vault):
    set_enabled(vault, "calendar", True)
    service = MagicMock()
    def fetched():
        set_enabled(vault, "calendar", False)
        return {"summary": "Before"}
    service.events.return_value.get.return_value.execute.side_effect = fetched
    assert not google.update_google_event("fixture@example.invalid", "fixture",
                                          {"summary": "After"},
                                          service_factory=lambda _: service)
    service.events.return_value.patch.assert_not_called()


def test_plugin_state_failure_blocks_optional_work(vault):
    (vault / ".gnosi").mkdir()
    (vault / ".gnosi" / "plugins.json").write_text("invalid", encoding="utf-8")
    assert not plugin_access.plugins_enabled_now("mail")
    assert not plugin_access.plugins_enabled_now("calendar")


def test_deferred_mail_start_rechecks_after_wait(vault, monkeypatch):
    set_enabled(vault, "mail", True)
    started = []
    from backend.services import imap_idle_service
    monkeypatch.setattr(imap_idle_service.idle_manager, "start_all", lambda: started.append(True))
    async def disable_during_wait(_delay):
        set_enabled(vault, "mail", False)
    monkeypatch.setattr(lifespan.asyncio, "sleep", disable_during_wait)
    asyncio.run(lifespan._start_deferred_integrations(scheduler_enabled=False))
    assert started == []


def test_mail_reactivation_during_startup_wait_uses_current_state(vault, monkeypatch):
    set_enabled(vault, "mail", False)
    from backend.services import imap_idle_service
    started = []
    monkeypatch.setattr(imap_idle_service.idle_manager, "start_all", lambda: started.append(True))
    async def enable_during_wait(_delay):
        set_enabled(vault, "mail", True)
    monkeypatch.setattr(lifespan.asyncio, "sleep", enable_during_wait)
    asyncio.run(lifespan._start_deferred_integrations(scheduler_enabled=False))
    assert started == [True]


def test_disabled_mail_blocks_direct_credential_restart(vault):
    set_enabled(vault, "mail", False)
    manager = ImapIdleManager()
    manager.start_worker("fixture@example.invalid")
    manager.start_all()
    assert manager._workers == {}
    assert not manager._running


def test_mail_refresh_ignores_stale_transition_payload(vault, monkeypatch):
    set_enabled(vault, "mail", False)
    from backend.services import imap_idle_service
    manager = ImapIdleManager()
    manager._running = True
    monkeypatch.setattr(imap_idle_service, "idle_manager", manager)
    stale = builtin_plugins.set_enabled(builtin_plugins.normalize_state({})[0], "mail", True)
    asyncio.run(plugin_lifecycle._refresh_mail_runtime(stale, plugin_lifecycle.logging.getLogger()))
    assert not manager._running


def test_worker_does_not_reconnect_after_disable(vault, monkeypatch):
    set_enabled(vault, "mail", False)
    from backend.services import imap_mail_sync_service
    connect = MagicMock(side_effect=AssertionError("IMAP opened"))
    monkeypatch.setattr(imap_mail_sync_service.imap_sync_service, "_connect", connect)
    ImapIdleManager()._worker_loop("fixture@example.invalid", threading.Event())
    connect.assert_not_called()


def test_start_stop_race_cannot_leave_late_worker(vault, monkeypatch):
    set_enabled(vault, "mail", True)
    from backend.services.integration_manager import integration_manager
    manager = ImapIdleManager()
    entered = threading.Event()
    release = threading.Event()
    def accounts(**_kwargs):
        entered.set()
        assert release.wait(2)
        return [{"email": "fixture@example.invalid"}]
    monkeypatch.setattr(integration_manager, "get_all_mail_accounts", accounts)
    monkeypatch.setattr(integration_manager, "is_imap_account", lambda _: True)
    def start():
        token = active_vault_path.set(vault)
        try:
            manager.start_all()
        finally:
            active_vault_path.reset(token)
    thread = threading.Thread(target=start)
    thread.start()
    assert entered.wait(2)
    set_enabled(vault, "mail", False)
    stopper = threading.Thread(target=manager.stop_all)
    stopper.start()
    release.set()
    thread.join(2)
    stopper.join(2)
    assert not thread.is_alive() and not stopper.is_alive()
    assert manager._workers == {} and not manager._running


def test_configured_state_store_reads_pinned_vault(vault, tmp_path, monkeypatch):
    import logging
    from backend.utils.safe_io import safe_write_json

    set_enabled(vault, "calendar", True)
    other = tmp_path / "different"
    other.mkdir()
    set_enabled(other, "calendar", False)
    store = plugin_state.PluginStateStore(plugin_state.PluginStateDependencies(
        path=lambda: get_active_vault_path() / ".gnosi" / "plugins.json",
        normalize_state=builtin_plugins.normalize_state, write_json=safe_write_json,
        logger=logging.getLogger(__name__),
    ))
    monkeypatch.setattr(plugin_state, "_store", store)
    token = active_vault_path.set(other)
    try:
        assert plugin_access.plugins_enabled_now("calendar", vault_path=vault)
        assert not plugin_access.plugins_enabled_now("calendar")
        assert get_active_vault_path() == other
    finally:
        active_vault_path.reset(token)


def test_worker_shutdown_cancels_pending_stop_flags():
    manager = ImapIdleManager()
    flag = threading.Event()
    manager._workers["fixture"] = MagicMock()
    manager._stop_flags["fixture"] = flag
    manager._running = True
    manager.stop_all()
    assert flag.is_set()
    assert manager._workers == {} and not manager._running


@pytest.mark.parametrize("operation", ["save", "patch"])
def test_disabled_calendar_keeps_local_page_writes(vault, monkeypatch, operation):
    from dataclasses import replace
    from backend.domains.vault.pages import patch_service, save_service
    from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest
    from backend.tests.page_write_open_fixtures import _patch_dependencies, _save_dependencies

    set_enabled(vault, "calendar", False)
    path = vault / "page.md"
    path.write_text("Before", encoding="utf-8")
    metadata = calendar_metadata()
    events = []
    calls = MagicMock()
    monkeypatch.setattr(google_calendar_service, "update_google_event", calls)
    tasks = BackgroundTasks()
    if operation == "save":
        dependencies = replace(_save_dependencies(path, metadata, events),
                               sync_calendar=runtime.sync_to_google_calendar_if_needed,
                               write_with_version=lambda _, file, meta, body: file.write_text(body))
        request = PageSaveRequest(title="Local change", metadata=metadata, content="After")
        response = asyncio.run(save_service.save_page("fixture", request, tasks, None, dependencies))
    else:
        dependencies = replace(_patch_dependencies(path, metadata, events),
                               sync_calendar=runtime.sync_to_google_calendar_if_needed,
                               save_page=lambda file, meta, body: file.write_text(body))
        request = PagePatchRequest(title="Local change", content="After")
        response = asyncio.run(patch_service.patch_page("fixture", request, tasks, None, dependencies))
    assert response["status"] == "success"
    assert path.read_text() == "After"
    asyncio.run(tasks())
    calls.assert_not_called()


def test_mail_worker_pins_vault_without_retaining_request_context(vault, tmp_path, monkeypatch):
    from contextvars import ContextVar
    from backend.domains.mail.sync import idle

    set_enabled(vault, "mail", True)
    actor = ContextVar("fixture_request_actor", default=None)
    actor_token = actor.set("request-user")
    started = {}
    observed = []
    manager = ImapIdleManager()
    def thread_factory(**kwargs):
        started.update(kwargs)
        return MagicMock()
    monkeypatch.setattr(idle.threading, "Thread", thread_factory)
    monkeypatch.setattr(manager, "_worker_loop",
                        lambda *args: observed.append((get_active_vault_path(), actor.get())))
    try:
        manager.start_worker("fixture@example.invalid")
        other = tmp_path / "other_worker_vault"
        other.mkdir()
        token = active_vault_path.set(other)
        try:
            started["target"](*started["args"])
            assert get_active_vault_path() == other
        finally:
            active_vault_path.reset(token)
    finally:
        actor.reset(actor_token)
    assert observed == [(vault, None)]
    manager.stop_all()
