"""Regression contracts for the deterministic frontend API-boundary guard."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GUARD = REPOSITORY_ROOT / "scripts" / "check_frontend_api_boundary.py"


def _load_guard_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("gnosi_frontend_api_boundary", GUARD)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load frontend API boundary guard from {GUARD}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_guard = _load_guard_module()
AXIOS_SPECIFIER = _guard.AXIOS_SPECIFIER
GLOBAL_FETCH_ASSIGNMENT = _guard.GLOBAL_FETCH_ASSIGNMENT
PATTERNS = _guard.PATTERNS


def test_boundary_patterns_distinguish_reviewed_adapters_from_bypasses() -> None:
    direct_fetch = PATTERNS["directFetch"]
    event_source = PATTERNS["eventSource"]
    web_socket = PATTERNS["webSocket"]

    assert direct_fetch.search("fetch('/api/health')")
    assert direct_fetch.search("globalThis.fetch(input, init)")
    assert not direct_fetch.search("transportFetch('/api/health')")
    assert event_source.search("new globalThis.EventSource(url)")
    assert not event_source.search("// EventSource reconnects automatically")
    assert web_socket.search("new globalThis.WebSocket(url)")
    assert not web_socket.search("const state = WebSocket.OPEN")
    assert AXIOS_SPECIFIER.search("import axios from 'axios'")
    assert not AXIOS_SPECIFIER.search("import legacyHttp from './legacy-http'")
    assert GLOBAL_FETCH_ASSIGNMENT.search("window.fetch = wrappedFetch")
    assert not GLOBAL_FETCH_ASSIGNMENT.search(
        "const transportFetch: typeof globalThis.fetch = wrapper"
    )


def test_committed_frontend_boundary_is_current_and_reasoned() -> None:
    result = subprocess.run(
        [sys.executable, str(GUARD)],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    allowlist = json.loads(
        (REPOSITORY_ROOT / "frontend" / "api-boundaries.json").read_text(
            encoding="utf-8"
        )
    )
    assert all(
        isinstance(reason, str) and reason.strip()
        for entries in allowlist.values()
        for reason in entries.values()
    )
