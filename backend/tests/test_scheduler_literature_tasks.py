"""Regression coverage for Vault-aware academic scheduler tasks."""

from __future__ import annotations

from types import SimpleNamespace

from backend.scheduler import literature_tasks


def test_academic_tasks_skip_cleanly_without_an_active_vault(monkeypatch) -> None:
    monkeypatch.setattr(literature_tasks, "get_primary_vault_path", lambda: None)
    monkeypatch.setattr(
        literature_tasks,
        "load_params",
        lambda *, strict_env: SimpleNamespace(paths={"VAULT": None}),
    )

    repository_result = literature_tasks.queue_due_repository_syncs()
    review_result = literature_tasks.queue_due_review_updates()

    assert repository_result == {
        "queued": 0,
        "skipped": True,
        "reason": "no_active_vault",
        "message": "Academic repository synchronization awaits an active Vault.",
    }
    assert review_result == {
        "queued": 0,
        "skipped": True,
        "reason": "no_active_vault",
        "message": "Literature review updates await an active Vault.",
    }
