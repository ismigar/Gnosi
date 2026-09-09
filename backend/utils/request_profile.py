"""Bounded, opt-in Python stack metadata for one application-owned request.

No attachment, signals or administrator privileges are needed. Only main and
explicitly registered workers are inspected. Frames are innermost first; locals,
arguments, source lines, results and thread names are never read. Unknown code
locations are replaced by ``external``. Files contain aggregate observations,
not a trace of request data, under /tmp/gnosi-request-profile-<id>.json on POSIX.
"""

from __future__ import annotations

from collections.abc import Callable
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from threading import Event, Lock, Thread, get_ident, main_thread
from time import monotonic
from types import FrameType
from typing import ParamSpec, TypeVar

_P = ParamSpec("_P")
_T = TypeVar("_T")
_SLOT = Lock()
_INTERVAL = 0.05
_DURATION = 15.0
_MAX_SAMPLES = 300
_MAX_STACKS = 256
_MAX_FRAMES = 32
_PROJECT = str(Path(__file__).resolve().parents[2]) + os.sep
_STDLIB = os.path.dirname(os.__file__) + os.sep
_PACKAGES = tuple(
    os.path.abspath(directory) + os.sep for directory in sys.path
    if directory and Path(directory).name in {"site-packages", "dist-packages"}
)
_DIRECTORY = Path("/tmp") if os.name == "posix" else Path(tempfile.gettempdir())
_PREFIX = "gnosi-request-profile-"
_ID = re.compile(r"[A-Za-z0-9_-]{6,64}\Z")
_FUNCTION = re.compile(r"[A-Za-z_<>][A-Za-z0-9_.<>]{0,159}\Z")
FrameMetadata = tuple[str, str, int]
StackKey = tuple[str, tuple[FrameMetadata, ...]]


def _code_location(filename: str) -> str:
    if not os.path.isabs(filename):
        return "external"
    filename = os.path.abspath(filename)
    for directory in _PACKAGES:
        if filename.startswith(directory):
            return "package/" + filename[len(directory):].replace(os.sep, "/")
    if filename.startswith(_PROJECT):
        return "project/" + filename[len(_PROJECT):].replace(os.sep, "/")
    if filename.startswith(_STDLIB):
        return "stdlib/" + filename[len(_STDLIB):].replace(os.sep, "/")
    return "external"


def _stack_metadata(frame: FrameType) -> tuple[FrameMetadata, ...]:
    result: list[FrameMetadata] = []
    current: FrameType | None = frame
    while current is not None and len(result) < _MAX_FRAMES:
        code = current.f_code
        location = _code_location(code.co_filename)
        name = code.co_name
        if location == "external":
            result.append(("external", "external", 0))
        else:
            result.append((location, name if _FUNCTION.fullmatch(name) else "function", current.f_lineno))
        current = current.f_back
    return tuple(result)


class RequestProfile:
    """Use run() around owned workers and always call stop() in finally."""

    def __init__(self) -> None:
        self._started = monotonic()
        self._stop = Event()
        self._workers_lock = Lock()
        self._workers: dict[int, int] = {}
        self._main = main_thread().ident
        self._stacks: dict[StackKey, int] = {}
        self._samples = 0
        self._dropped = 0
        self._profile_id: str | None = None
        self._thread = Thread(target=self._sample_loop, name="gnosi-request-profile", daemon=True)

    def run(self, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs) -> _T:
        registered = False
        identity = get_ident()
        try:
            with self._workers_lock:
                if not self._stop.is_set():
                    self._workers[identity] = self._workers.get(identity, 0) + 1
                    registered = True
        except Exception:
            pass
        try:
            return function(*args, **kwargs)
        finally:
            if registered:
                try:
                    with self._workers_lock:
                        remaining = self._workers[identity] - 1
                        if remaining:
                            self._workers[identity] = remaining
                        else:
                            self._workers.pop(identity, None)
                except Exception:
                    pass

    def _sample_once(self) -> None:
        # Keep registration stable while reading frames. A worker cannot return
        # to its pool and start unrelated work until its unregister completes.
        with self._workers_lock:
            identities = {identity: "worker" for identity in self._workers}
            if self._main is not None:
                identities[self._main] = "main"
            frames = sys._current_frames()
            for identity, role in identities.items():
                frame = frames.get(identity)
                if frame is None:
                    continue
                key = (role, _stack_metadata(frame))
                if key in self._stacks or len(self._stacks) < _MAX_STACKS:
                    self._stacks[key] = self._stacks.get(key, 0) + 1
                else:
                    self._dropped += 1
            self._samples += 1

    def _persist(self) -> None:
        output: str | None = None
        try:
            descriptor, output = tempfile.mkstemp(prefix=_PREFIX, suffix=".json", dir=_DIRECTORY)
            identifier = Path(output).name[len(_PREFIX):-len(".json")]
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                if not _ID.fullmatch(identifier):
                    raise ValueError("Invalid generated profile identifier")
                json.dump({
                    "version": 1,
                    "process_id": os.getpid(),
                    "started_monotonic": self._started,
                    "interval_ms": 50,
                    "maximum_duration_ms": 15_000,
                    "sample_count": self._samples,
                    "dropped_stacks": self._dropped,
                    "stacks": [
                        {"role": role, "count": count, "frames": [
                            {"file": filename, "function": function, "line": line}
                            for filename, function, line in stack
                        ]}
                        for (role, stack), count in self._stacks.items()
                    ],
                }, stream, separators=(",", ":"))
            self._profile_id = identifier
        except Exception:
            if output is not None:
                try:
                    os.unlink(output)
                except OSError:
                    pass

    def _sample_loop(self) -> None:
        deadline = self._started + _DURATION
        try:
            for _ in range(_MAX_SAMPLES):
                if self._stop.wait(_INTERVAL) or monotonic() >= deadline:
                    break
                self._sample_once()
        except Exception:
            # Profiling failures must not reach the application or its logs.
            pass
        finally:
            self._stop.set()
            try:
                self._persist()
            finally:
                _SLOT.release()

    def stop(self) -> str | None:
        """Stop with bounded waiting; omit the ID if persistence is not ready."""
        try:
            self._stop.set()
            self._thread.join(timeout=0.25)
            return self._profile_id if not self._thread.is_alive() else None
        except Exception:
            return None


def start_request_profile(enabled: bool) -> RequestProfile | None:
    """One global sampler; disabled/busy/unavailable diagnostics are a no-op."""
    if not enabled or not _SLOT.acquire(blocking=False):
        return None
    try:
        profile = RequestProfile()
        profile._thread.start()
        return profile
    except Exception:
        _SLOT.release()
        return None
