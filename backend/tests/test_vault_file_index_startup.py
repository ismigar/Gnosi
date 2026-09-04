"""Startup policy for the provider-neutral filename index."""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from backend.services import vault_file_index


@pytest.fixture(autouse=True)
def isolated_index_state(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> Iterator[None]:
    vault_file_index.shutdown_file_index()
    monkeypatch.setattr(vault_file_index, "_CACHE_PATH", tmp_path / "index.json")
    monkeypatch.setattr(vault_file_index, "_REFRESH_SECONDS", 3600)
    with vault_file_index._lock:
        vault_file_index._by_path = {}
        vault_file_index._built_at = 0.0
        vault_file_index._building = False
        vault_file_index._thread_started = False
        vault_file_index._worker_thread = None
        vault_file_index._stop_event = None
        vault_file_index._state = "preparing"
        vault_file_index._last_error = None
    yield
    vault_file_index.shutdown_file_index()


async def _wait_until(
    predicate: Callable[[], bool],
    *,
    timeout: float = 1.0,
) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("timed out waiting for file-index state")
        await asyncio.sleep(0.005)


def test_cached_index_defers_first_cloud_walk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vault_file_index, "_REFRESH_SECONDS", 600)

    assert vault_file_index._initial_rebuild_delay(cache_loaded=True) == 600


def test_missing_index_rebuilds_immediately(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vault_file_index, "_REFRESH_SECONDS", 600)

    assert vault_file_index._initial_rebuild_delay(cache_loaded=False) == 0


def test_default_policy_disables_periodic_provider_walks() -> None:
    assert vault_file_index._DEFAULT_REFRESH_SECONDS == 0


def test_cached_one_shot_worker_never_walks_provider_tree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_loaded = threading.Event()
    monkeypatch.setattr(vault_file_index, "_REFRESH_SECONDS", 0)
    monkeypatch.setattr(
        vault_file_index,
        "_load_from_disk",
        lambda _stop: cache_loaded.set() or True,
    )
    monkeypatch.setattr(
        vault_file_index,
        "build_index",
        lambda _stop: pytest.fail("a valid cache must be preferred to a provider walk"),
    )

    started_at = time.perf_counter()
    vault_file_index.kickoff_file_index_rebuild()
    assert cache_loaded.wait(timeout=0.25)
    assert vault_file_index.shutdown_file_index(timeout_seconds=0.25) is True

    assert time.perf_counter() - started_at < 0.25


def test_slow_cache_load_does_not_block_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    load_started = threading.Event()
    release_load = threading.Event()

    def slow_load(_stop_event: threading.Event | None = None) -> bool:
        load_started.set()
        assert release_load.wait(timeout=1)
        return False

    monkeypatch.setattr(vault_file_index, "_load_from_disk", slow_load)
    monkeypatch.setattr(vault_file_index, "build_index", lambda _stop: 0)

    async def exercise() -> None:
        started_at = time.monotonic()
        vault_file_index.kickoff_file_index_rebuild()
        kickoff_elapsed = time.monotonic() - started_at
        await _wait_until(load_started.is_set)

        event_loop_progressed = asyncio.Event()

        async def ticker() -> None:
            await asyncio.sleep(0)
            event_loop_progressed.set()

        ticker_task = asyncio.create_task(ticker())
        await asyncio.wait_for(event_loop_progressed.wait(), timeout=1)

        assert kickoff_elapsed < 0.25
        assert vault_file_index.status()["state"] == "preparing"

        release_load.set()
        await ticker_task
        await asyncio.to_thread(vault_file_index.shutdown_file_index)

    asyncio.run(exercise())


def test_slow_traversal_does_not_block_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    walk_started = threading.Event()
    release_walk = threading.Event()
    monkeypatch.setattr(vault_file_index, "_load_from_disk", lambda _stop: False)

    def slow_walk(
        stop_event: threading.Event | None = None,
    ) -> list[dict[str, object]]:
        assert stop_event is not None
        walk_started.set()
        assert release_walk.wait(timeout=1)
        return []

    monkeypatch.setattr(vault_file_index, "_walk", slow_walk)

    async def exercise() -> None:
        vault_file_index.kickoff_file_index_rebuild()
        await _wait_until(walk_started.is_set)

        event_loop_progressed = asyncio.Event()

        async def ticker() -> None:
            await asyncio.sleep(0)
            event_loop_progressed.set()

        ticker_task = asyncio.create_task(ticker())
        await asyncio.wait_for(event_loop_progressed.wait(), timeout=1)

        assert vault_file_index.status()["building"] is True

        release_walk.set()
        await ticker_task
        await _wait_until(lambda: vault_file_index.status()["state"] == "ready")

    asyncio.run(exercise())


def test_large_refresh_keeps_http_sentinel_responsive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry_count = 81_000
    entries = [
        {
            "name": f"synthetic-{index}.md",
            "name_norm": f"synthetic-{index}.md",
            "path": f"/synthetic/provider/{index}.md",
            "is_dir": False,
        }
        for index in range(entry_count)
    ]
    monkeypatch.setattr(vault_file_index, "_walk", lambda _stop: entries)
    monkeypatch.setattr(vault_file_index, "_save_to_disk", lambda _entries, _stop: None)

    async def exercise() -> None:
        stop_event = threading.Event()
        worker = threading.Thread(
            target=vault_file_index.build_index,
            args=(stop_event,),
        )
        interval = 0.005
        expected_tick = time.perf_counter() + interval
        last_tick = time.perf_counter()
        response_gaps: list[float] = []
        worker.start()
        while worker.is_alive():
            await asyncio.sleep(max(0.0, expected_tick - time.perf_counter()))
            current_tick = time.perf_counter()
            response_gaps.append(current_tick - last_tick)
            last_tick = current_tick
            expected_tick = max(expected_tick + interval, current_tick + interval)
        worker.join()

        assert len(response_gaps) >= 10
        ordered_gaps = sorted(response_gaps)
        percentile_95 = ordered_gaps[int(len(ordered_gaps) * 0.95)]
        assert percentile_95 < 0.03
        assert max(response_gaps) < 0.5

    asyncio.run(exercise())
    assert vault_file_index.status()["entries"] == entry_count


def test_worker_pause_is_positive_and_immediately_cancelable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stop_event = threading.Event()
    waits: list[float] = []

    def cancel_during_wait(timeout: float | None = None) -> bool:
        assert timeout is not None
        waits.append(timeout)
        stop_event.set()
        return True

    monkeypatch.setattr(stop_event, "wait", cancel_during_wait)

    with pytest.raises(vault_file_index._BuildCancelled):
        vault_file_index._cooperate_with_event_loop(
            vault_file_index._WORKER_BATCH_ENTRIES,
            stop_event,
        )

    assert waits == [vault_file_index._WORKER_PAUSE_SECONDS]
    assert waits[0] > 0


def test_partial_refresh_merges_without_losing_provider_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    previous = {
        "name": "Google Drive note.md",
        "name_norm": "google drive note.md",
        "path": "/synthetic/GoogleDrive/note.md",
        "is_dir": False,
        "last_seen": 1.0,
    }
    discovered = {
        "name": "Nextcloud note.md",
        "name_norm": "nextcloud note.md",
        "path": "/synthetic/Nextcloud/note.md",
        "is_dir": False,
    }
    second_previous = {
        "name": "OneDrive note.md",
        "name_norm": "onedrive note.md",
        "path": "/synthetic/OneDrive/note.md",
        "is_dir": False,
        "last_seen": 1.0,
    }
    with vault_file_index._lock:
        vault_file_index._by_path = {
            str(previous["path"]): previous,
            str(second_previous["path"]): second_previous,
        }
    monkeypatch.setattr(vault_file_index, "_walk", lambda _stop: [discovered])
    monkeypatch.setattr(vault_file_index, "_save_to_disk", lambda _entries, _stop: None)

    assert vault_file_index.build_index(threading.Event()) == 3
    assert vault_file_index.query("google drive") == [
        {
            "name": previous["name"],
            "path": previous["path"],
            "is_dir": False,
        }
    ]
    assert vault_file_index.query("nextcloud") == [
        {
            "name": discovered["name"],
            "path": discovered["path"],
            "is_dir": False,
        }
    ]


def test_concurrent_kickoff_starts_only_one_build(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build_started = threading.Event()
    release_build = threading.Event()
    build_calls = 0
    calls_lock = threading.Lock()

    monkeypatch.setattr(vault_file_index, "_load_from_disk", lambda _stop: False)

    def blocking_build(_stop_event: threading.Event) -> int:
        nonlocal build_calls
        with calls_lock:
            build_calls += 1
        build_started.set()
        assert release_build.wait(timeout=1)
        return 0

    monkeypatch.setattr(vault_file_index, "build_index", blocking_build)

    callers = [
        threading.Thread(target=vault_file_index.kickoff_file_index_rebuild) for _ in range(8)
    ]
    for caller in callers:
        caller.start()
    for caller in callers:
        caller.join()

    assert build_started.wait(timeout=1)
    assert build_calls == 1

    release_build.set()
    vault_file_index.shutdown_file_index()


def test_shutdown_cancels_and_joins_active_walk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    walk_started = threading.Event()
    walk_stopped = threading.Event()
    monkeypatch.setattr(vault_file_index, "_load_from_disk", lambda _stop: False)

    def cancellable_walk(stop_event: threading.Event | None = None) -> list[dict[str, object]]:
        assert stop_event is not None
        walk_started.set()
        while not stop_event.wait(0.005):
            pass
        walk_stopped.set()
        raise vault_file_index._BuildCancelled

    monkeypatch.setattr(vault_file_index, "_walk", cancellable_walk)

    vault_file_index.kickoff_file_index_rebuild()
    assert walk_started.wait(timeout=1)
    with vault_file_index._lock:
        worker = vault_file_index._worker_thread

    assert vault_file_index.shutdown_file_index(timeout_seconds=1) is True

    assert walk_stopped.is_set()
    assert worker is not None
    assert not worker.is_alive()
    with vault_file_index._lock:
        assert vault_file_index._worker_thread is None
        assert vault_file_index._thread_started is False


def test_shutdown_is_bounded_when_filesystem_call_does_not_return(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    load_started = threading.Event()
    release_load = threading.Event()

    def stuck_load(_stop_event: threading.Event | None = None) -> bool:
        load_started.set()
        assert release_load.wait(timeout=1)
        return False

    monkeypatch.setattr(vault_file_index, "_load_from_disk", stuck_load)

    vault_file_index.kickoff_file_index_rebuild()
    assert load_started.wait(timeout=1)
    started_at = time.monotonic()

    stopped = vault_file_index.shutdown_file_index(timeout_seconds=0.02)

    assert stopped is False
    assert time.monotonic() - started_at < 0.2
    assert vault_file_index.status()["error"] == "shutdown_timeout"

    release_load.set()
    assert vault_file_index.shutdown_file_index(timeout_seconds=1) is True


def test_background_build_publishes_complete_synthetic_index(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    root = tmp_path / "cloud"
    folder = root / "Course"
    folder.mkdir(parents=True)
    (folder / "Notes.md").write_text("fixture", encoding="utf-8")
    (root / "Schedule.pdf").write_bytes(b"fixture")
    monkeypatch.setattr(vault_file_index, "_index_roots", lambda: [str(root)])

    async def exercise() -> None:
        vault_file_index.kickoff_file_index_rebuild()
        await _wait_until(
            lambda: (
                vault_file_index.status()["state"] == "ready"
                and vault_file_index.status()["entries"] == 3
            ),
        )

    asyncio.run(exercise())

    assert vault_file_index.query("notes") == [
        {
            "name": "Notes.md",
            "path": str(folder / "Notes.md"),
            "is_dir": False,
        }
    ]
    assert vault_file_index.status()["error"] is None
    assert vault_file_index._CACHE_PATH.exists()


def test_failed_background_build_reports_explicit_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vault_file_index, "_load_from_disk", lambda _stop: False)

    def failing_walk(
        _stop_event: threading.Event | None = None,
    ) -> list[dict[str, object]]:
        raise OSError("synthetic failure")

    monkeypatch.setattr(vault_file_index, "_walk", failing_walk)

    async def exercise() -> None:
        vault_file_index.kickoff_file_index_rebuild()
        await _wait_until(lambda: vault_file_index.status()["state"] == "error")

    asyncio.run(exercise())

    current_status = vault_file_index.status()
    assert current_status["ready"] is False
    assert current_status["error"] == "OSError"
