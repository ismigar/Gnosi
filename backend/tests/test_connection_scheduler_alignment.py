"""Connection scheduling uses the canonical Brain queue and honest status."""

from __future__ import annotations

import pytest

from backend.api import vault_routes
from backend.scheduler.manager import SchedulerManager
from backend.services import llm_wiki_actions, llm_wiki_suggestions
from backend.services.graph_service import GraphService
from backend.services.integration_manager import integration_manager


def _manager() -> SchedulerManager:
    return object.__new__(SchedulerManager)


def test_structured_task_error_is_not_reported_as_success():
    with pytest.raises(RuntimeError, match="Pipeline unavailable"):
        SchedulerManager._raise_for_task_failure({"error": "Pipeline unavailable"})
    with pytest.raises(RuntimeError, match="Model failed"):
        SchedulerManager._raise_for_task_failure({
            "success": False,
            "message": "Model failed",
        })


def test_contact_sync_scheduler_uses_current_management_session_api(monkeypatch):
    monkeypatch.setattr(integration_manager, "get_all_safe", lambda: {"contacts": []})

    result = _manager()._task_fetch_contacts()

    assert result == {"success": True, "message": "No contact accounts configured"}


def test_suggest_connections_uses_llm_wiki_queue(monkeypatch):
    calls = []
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: {})
    monkeypatch.setattr(vault_routes, "_llm_wiki_enabled", lambda _state: True)
    monkeypatch.setattr(
        llm_wiki_actions,
        "run_maintenance",
        lambda *, semantic: calls.append(semantic) or {
            "suggestions_queued": 2,
            "suggestions_pending": 4,
        },
    )

    result = _manager()._task_suggest_connections()

    assert calls == [True]
    assert result["success"] is True
    assert result["suggestions_queued"] == 2
    assert result["suggestions_pending"] == 4


def test_memory_refresh_reads_queue_without_generating_suggestions(monkeypatch):
    manager = _manager()
    monkeypatch.setattr(
        manager,
        "_task_suggest_connections",
        lambda: pytest.fail("Memory refresh must not invoke the semantic generator"),
    )
    monkeypatch.setattr(
        llm_wiki_suggestions,
        "load_queue",
        lambda: [{"id": "one"}, {"id": "two"}, {"id": "three"}],
    )
    monkeypatch.setattr(GraphService, "invalidate_response_cache", lambda: None)
    monkeypatch.setattr(
        GraphService,
        "build_unified_graph",
        lambda _self: {"nodes": [{"id": "a"}], "edges": []},
    )
    monkeypatch.setattr(manager, "_task_update_analytics", lambda: {"stats": {}})

    result = manager._task_update_memories()

    assert result["success"] is True
    assert {"connections_pending": 3} in result["steps"]
