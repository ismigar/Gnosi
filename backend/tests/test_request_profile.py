"""Safe synthetic frames only; no live process attachment or backend imports."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import stat
from threading import Lock
from types import SimpleNamespace

import pytest

from backend.utils import request_profile


@pytest.fixture(autouse=True)
def isolated_profiles(monkeypatch, tmp_path):
    monkeypatch.setattr(request_profile, "_DIRECTORY", tmp_path)
    monkeypatch.setattr(request_profile, "_SLOT", Lock())


def test_disabled_and_busy_profiling_does_not_construct_a_sampler(monkeypatch, tmp_path):
    def forbidden():
        raise AssertionError("A disabled or busy profile must not start diagnostics")

    monkeypatch.setattr(request_profile, "RequestProfile", forbidden)
    assert request_profile.start_request_profile(False) is None
    with request_profile._SLOT:
        assert request_profile.start_request_profile(True) is None
    assert list(tmp_path.iterdir()) == []


def test_only_registered_frames_are_read_and_private_metadata_is_redacted(monkeypatch, tmp_path):
    class Frame:
        def __init__(self, filename, function, line, parent=None):
            self.f_code = SimpleNamespace(co_filename=filename, co_name=function)
            self.f_lineno = line
            self.f_back = parent

        @property
        def f_locals(self):
            raise AssertionError("Never inspect frame locals")

        @property
        def f_globals(self):
            raise AssertionError("Never inspect frame globals")

    class UnrelatedFrame:
        @property
        def f_code(self):
            raise AssertionError("Never inspect an unrelated thread")

    profile = request_profile.RequestProfile()
    profile._main = 11
    monkeypatch.setattr(request_profile, "get_ident", lambda: 7)
    main = Frame(str(Path(request_profile._PROJECT) / "backend/app/lifespan.py"), "lifespan", 308)
    worker = Frame("/private/vault/private-account-title.py", "private_account_title", 88,
                   Frame(str(Path(request_profile._STDLIB) / "threading.py"), "wait", 331))
    monkeypatch.setattr(request_profile.sys, "_current_frames", lambda: {
        11: main, 7: worker, 99: UnrelatedFrame(),
    })
    original = RuntimeError("private exception and credential fixture")

    def work(_credential):
        profile._sample_once()
        raise original

    with pytest.raises(RuntimeError) as raised:
        profile.run(work, "never-serialize-this-credential")
    assert raised.value is original
    assert profile._workers == {}
    profile._sample_once()  # The reused worker is no longer eligible.
    profile._persist()
    identifier = profile._profile_id
    assert identifier is not None and re.fullmatch(r"[A-Za-z0-9_-]{6,64}", identifier)
    output = tmp_path / f"gnosi-request-profile-{identifier}.json"
    assert stat.S_IMODE(output.stat().st_mode) == 0o600
    raw = output.read_text()
    payload = json.loads(raw)
    assert payload["sample_count"] == 2
    assert len(payload["stacks"]) == 2
    assert sorted((entry["role"], entry["count"]) for entry in payload["stacks"]) == [
        ("main", 2), ("worker", 1),
    ]
    for private in ("private-account", "private_account", "credential", "/private/", "f_locals"):
        assert private not in raw
    assert "project/backend/app/lifespan.py" in raw
    assert "stdlib/threading.py" in raw
    assert {"file", "function", "line"} == set(payload["stacks"][0]["frames"][0])


def test_capture_persists_at_its_limit_without_waiting_for_request_stop(monkeypatch, tmp_path):
    monkeypatch.setattr(request_profile, "_MAX_SAMPLES", 0)
    profile = request_profile.start_request_profile(True)
    assert profile is not None
    profile._thread.join(timeout=5)
    assert not profile._thread.is_alive()
    outputs = list(tmp_path.glob("gnosi-request-profile-*.json"))
    assert len(outputs) == 1  # Already persisted; stop has not been called.
    payload = json.loads(outputs[0].read_text())
    assert payload["process_id"] > 0
    assert payload["started_monotonic"] > 0
    identifier = profile.stop()
    assert identifier is not None and profile.stop() == identifier
    assert request_profile._SLOT.acquire(blocking=False)
    request_profile._SLOT.release()


def test_persistence_failure_does_not_change_results_or_keep_the_global_slot(monkeypatch, tmp_path):
    monkeypatch.setattr(request_profile, "_MAX_SAMPLES", 0)

    def unavailable(**_kwargs):
        raise OSError("private diagnostic I/O failure")

    monkeypatch.setattr(request_profile.tempfile, "mkstemp", unavailable)
    profile = request_profile.start_request_profile(True)
    assert profile is not None
    assert profile.run(lambda: "same result") == "same result"
    profile._thread.join(timeout=5)
    assert profile.stop() is None
    assert list(tmp_path.iterdir()) == []
    assert request_profile._SLOT.acquire(blocking=False)
    request_profile._SLOT.release()


def test_stop_wait_is_bounded_when_sampler_has_not_finished():
    profile = request_profile.RequestProfile()
    waits = []
    profile._thread = SimpleNamespace(join=lambda *, timeout: waits.append(timeout), is_alive=lambda: True)
    assert profile.stop() is None
    assert waits == [0.25]
    assert profile._stop.is_set()


def test_calendar_registers_only_its_workers_and_stops_capture_in_finally(monkeypatch):
    from backend.domains.calendar import timing

    runs = []
    stopped = []

    class Capture:
        def run(self, function, *args, **kwargs):
            runs.append(function.__name__)
            return function(*args, **kwargs)

        def stop(self):
            stopped.append(True)
            return "safe-profile-id"

    capture = Capture()
    monkeypatch.setattr(timing, "start_request_profile", lambda enabled: capture if enabled else None)
    with timing.collect_calendar_timing(True, profile=True) as measured:
        assert asyncio.run(timing.calendar_to_thread(lambda: "same")) == "same"
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert timing.calendar_worker_map(executor, lambda value: value + 1, [1, 2]) == [2, 3]
    assert measured is not None and measured.profile_id == "safe-profile-id"
    assert len(runs) == 3
    assert stopped == [True]
