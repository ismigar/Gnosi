"""Policy tests for proactive Vault hydration."""

from __future__ import annotations

from backend.platform.files import LocalProvider, OnDemandFilesProvider
from backend.services.vault_warmup import _critical_warmup_enabled


def test_native_open_mode_disables_bulk_warmup_by_default(monkeypatch) -> None:
    monkeypatch.delenv("GNOSI_CRITICAL_WARMUP", raising=False)
    provider = OnDemandFilesProvider()
    provider.warmup_mode = "open"

    assert not _critical_warmup_enabled(provider)


def test_daemon_and_local_modes_preserve_bulk_warmup_by_default(monkeypatch) -> None:
    monkeypatch.delenv("GNOSI_CRITICAL_WARMUP", raising=False)
    provider = OnDemandFilesProvider()
    provider.warmup_mode = "daemon"

    assert _critical_warmup_enabled(provider)
    assert _critical_warmup_enabled(LocalProvider())


def test_explicit_bulk_warmup_override_wins(monkeypatch) -> None:
    provider = OnDemandFilesProvider()
    provider.warmup_mode = "open"
    monkeypatch.setenv("GNOSI_CRITICAL_WARMUP", "yes")
    assert _critical_warmup_enabled(provider)

    monkeypatch.setenv("GNOSI_CRITICAL_WARMUP", "invalid")
    assert not _critical_warmup_enabled(provider)


def test_sync_kickoff_returns_without_waiting_and_coalesces(tmp_path, monkeypatch):
    import asyncio
    import threading
    from backend.services import vault_warmup
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    calls = []
    async def slow(path):
        calls.append(path)
        started.set()
        await asyncio.to_thread(release.wait, 2)
        finished.set()
    monkeypatch.setattr(vault_warmup, '_warm_critical', slow)
    path = str(tmp_path)
    try:
        vault_warmup.kickoff_critical_warmup(path)
        assert started.wait(1)
        assert not finished.is_set()
        vault_warmup.kickoff_critical_warmup(path)
        assert calls == [path]
    finally:
        release.set()
        assert finished.wait(1)
