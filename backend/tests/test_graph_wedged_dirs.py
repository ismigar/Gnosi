"""GET /api/graph must survive wedged OneDrive subtrees (EDEADLK, errno 11).

A backend running under launchd cannot trigger OneDrive's on-access hydration:
listing a non-materialized directory raises OSError(EDEADLK) instantly (see
feedback_onedrive_warmup_native and files_provider/onedrive.py). The recursive
walk in get_markdown_files_efficient used to die on the first wedged directory,
turning the whole scan — and GET /api/graph — into a 500 (errors [1f98a0d9] /
[eab0704c] in backend-native.err, 2026-07-16, path .../Gnosi/Principal/BD/Cervell).

The walk now skips the wedged subtree (skip-and-log, same pattern as the
dataless-sidecar and warmup-indexer fixes), returns the rest of the vault,
marks the build as ``partial`` and never stores it in the TTL cache, so the
frontend doesn't get pinned on a near-empty graph until the next TTL.

Runs fully isolated: temp vault + temp GNOSI_LOCAL_DATA, os.scandir
monkeypatched to raise EDEADLK for one directory. No real OneDrive needed.
"""
from __future__ import annotations

import errno
import logging
import os
from pathlib import Path

import pytest

from backend.services import graph_service as gs
from backend.services.graph_service import GraphService, get_markdown_files_efficient

WEDGED_DIRNAME = "Cervell"  # mirrors the real-world wedged path BD/Cervell


@pytest.fixture()
def vault(tmp_path, monkeypatch):
    """Isolated temp vault + local data; GraphService class caches wiped."""
    vault = tmp_path / "vault"
    (vault / "Notes").mkdir(parents=True)
    (vault / WEDGED_DIRNAME).mkdir()
    (vault / "Altres").mkdir()
    (vault / "Notes" / "alpha.md").write_text(
        "---\nid: alpha\ntitle: Alpha\n---\nBody with [[Gamma]]\n", encoding="utf-8"
    )
    # Lives inside the wedged dir: must NOT be reachable while wedged.
    (vault / WEDGED_DIRNAME / "beta.md").write_text(
        "---\nid: beta\ntitle: Beta\n---\nBody\n", encoding="utf-8"
    )
    (vault / "Altres" / "gamma.md").write_text(
        "---\nid: gamma\ntitle: Gamma\n---\nBody\n", encoding="utf-8"
    )

    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(vault))
    monkeypatch.setenv("GNOSI_LOCAL_DATA", str(tmp_path / "localdata"))
    # Gate _request_dir_warmup: tests must never spawn a real `open` process.
    monkeypatch.setenv("ONEDRIVE_WARMUP_MODE", "daemon")

    GraphService._graph_cache = {}
    GraphService._last_graph_time = {}
    GraphService._node_count_cache = {}
    GraphService._NODE_DATA_CACHE = {}
    # Skip disk cache loads: keep the test hermetic regardless of prior runs.
    GraphService._NODE_CACHE_LOADED = True
    gs._DIR_WARMUP_REQUESTED.clear()
    return vault


def _wedge(monkeypatch, wedged_name: str = WEDGED_DIRNAME):
    """Monkeypatch os.scandir to raise EDEADLK for `wedged_name` directories.

    EDEADLK surfaces at the os.scandir() call itself, exactly like the real
    File Provider failure (traceback line: `for entry in os.scandir(root)`).
    Returns a mutable state dict: set state["on"] = False to "re-hydrate".
    """
    real_scandir = os.scandir
    state = {"on": True}

    def fake_scandir(path="."):
        if state["on"] and Path(path).name == wedged_name:
            raise OSError(errno.EDEADLK, "Resource deadlock avoided", str(path))
        return real_scandir(path)

    monkeypatch.setattr(os, "scandir", fake_scandir)
    return state


def test_walk_skips_wedged_dir_and_returns_rest(vault, monkeypatch):
    _wedge(monkeypatch)
    skipped: list[str] = []
    files = get_markdown_files_efficient(vault, skipped)
    assert {f.name for f in files} == {"alpha.md", "gamma.md"}
    assert [Path(s).name for s in skipped] == [WEDGED_DIRNAME]


def test_walk_without_tracking_list_still_survives(vault, monkeypatch):
    """Back-compat: callers using the old single-arg signature must not crash."""
    _wedge(monkeypatch)
    files = get_markdown_files_efficient(vault)
    assert {f.name for f in files} == {"alpha.md", "gamma.md"}


def test_wedged_dir_requests_finder_warmup_only_in_open_mode(vault, monkeypatch):
    calls: list[list[str]] = []

    def fake_popen(cmd, *args, **kwargs):
        calls.append(cmd)
        return None  # fire-and-forget: the return value is never used

    monkeypatch.setattr(gs.subprocess, "Popen", fake_popen)
    _wedge(monkeypatch)

    # Fixture default is daemon mode (Docker): no LaunchServices available.
    get_markdown_files_efficient(vault, [])
    assert calls == []

    # Native macOS mode: exactly one `open -g -j <dir>` per wedged path...
    monkeypatch.setenv("ONEDRIVE_WARMUP_MODE", "open")
    get_markdown_files_efficient(vault, [])
    assert len(calls) == 1
    assert calls[0][:3] == ["/usr/bin/open", "-g", "-j"]
    assert calls[0][3].endswith(WEDGED_DIRNAME)

    # ...throttled: an immediate rebuild does not spawn another one.
    get_markdown_files_efficient(vault, [])
    assert len(calls) == 1


def test_first_warmup_fires_within_the_throttle_window_after_boot(vault, monkeypatch):
    """Regression: the first request must not be swallowed on a fresh boot.

    `time.monotonic()` counts from an arbitrary epoch — system boot on Linux and
    on the macOS builds we ship. The throttle used to read the last-request
    stamp with a `0.0` default, so `now - 0.0 < _DIR_WARMUP_THROTTLE_S` was true
    for EVERY unseen directory while monotonic() was still under the window,
    silently dropping the first warmup during the first 5 minutes of uptime —
    exactly when the LaunchAgent starts and OneDrive subtrees are coldest.

    Pinning monotonic() below the window reproduces that; it passed unnoticed on
    a long-running machine, where monotonic() is already far past 300.
    """
    calls: list[list[str]] = []
    monkeypatch.setattr(gs.subprocess, "Popen", lambda cmd, *a, **k: calls.append(cmd))
    monkeypatch.setenv("ONEDRIVE_WARMUP_MODE", "open")
    # 12 s of uptime: well inside _DIR_WARMUP_THROTTLE_S (300 s).
    monkeypatch.setattr(gs.time, "monotonic", lambda: 12.0)
    _wedge(monkeypatch)

    get_markdown_files_efficient(vault, [])
    assert len(calls) == 1, "first warmup was swallowed by the throttle"
    assert calls[0][3].endswith(WEDGED_DIRNAME)

    # The throttle itself still holds: a rebuild at the same instant is a no-op.
    get_markdown_files_efficient(vault, [])
    assert len(calls) == 1


def test_partial_build_is_marked_and_not_cached(vault, monkeypatch):
    state = _wedge(monkeypatch)
    svc = GraphService()

    result = svc.build_unified_graph()
    ids = {n["id"] for n in result["nodes"]}
    assert {"alpha", "gamma"} <= ids
    assert "beta" not in ids
    assert result["partial"] is True
    assert result["skipped_dirs"] == [WEDGED_DIRNAME]
    # A partial graph must never be pinned in the TTL cache as the good one.
    # The cache is now a per-vault dict, so "not cached" means no entry was added.
    assert GraphService._graph_cache == {}

    # OneDrive recovers → the very next build is complete and cacheable
    # (no TTL wait, precisely because the partial result was not cached).
    state["on"] = False
    result2 = svc.build_unified_graph()
    ids2 = {n["id"] for n in result2["nodes"]}
    assert {"alpha", "beta", "gamma"} <= ids2
    assert "partial" not in result2
    # The complete build is cached; the per-vault dict now holds it as its value.
    assert any(v is result2 for v in GraphService._graph_cache.values())


def test_build_recovers_from_legacy_none_graph_cache(vault):
    """A stale scheduler cache state must not turn GET /api/graph into a 500."""
    GraphService._graph_cache = None
    GraphService._last_graph_time = None

    result = GraphService().build_unified_graph()

    assert result["nodes"]
    assert isinstance(GraphService._graph_cache, dict)
    assert isinstance(GraphService._last_graph_time, dict)


def test_complete_graph_exports_pending_suggestions_as_overlay(vault, monkeypatch):
    from backend.services import llm_wiki_suggestions

    queue_path = vault / ".gnosi" / "llm_wiki_suggestions.json"
    queue_path.parent.mkdir()
    queue_path.write_text(
        '{"suggestions":[{"id":"proposal-1","member_ids":["beta","gamma"],'
        '"title":"Shared concern"}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(llm_wiki_suggestions, "_queue_path", lambda: queue_path)

    result = GraphService().build_unified_graph()

    edge = next(
        item for item in result["edges"]
        if item["kind"] == "suggestion"
    )
    assert {edge["source"], edge["target"]} == {"beta", "gamma"}
    assert edge["similarity"] == 90
    assert edge["reason"] == "Shared concern"


def test_node_count_keeps_previous_value_on_partial_scan(vault, monkeypatch):
    svc = GraphService()

    # Healthy scan first: 3 pages (+0 registry items) cached.
    full_count = svc.get_node_count()
    assert full_count >= 3

    # Wedge the dir and invalidate the response → the partial graph must NOT
    # lower the last complete canonical count.
    _wedge(monkeypatch)
    GraphService.invalidate_response_cache()
    assert svc.get_node_count() == full_count


def test_api_graph_returns_200_with_partial_graph(vault, monkeypatch):
    """E2E: /api/graph serves the surviving nodes instead of a 500."""
    _wedge(monkeypatch)

    from fastapi.testclient import TestClient
    from backend.server import app

    # WITHOUT a context manager: the lifespan doesn't fire (scheduler/MCP).
    client = TestClient(app, raise_server_exceptions=False)
    client.headers.update({"X-User-ID": "ismael-legacy"})

    r = client.get("/api/graph")
    assert r.status_code == 200, r.text
    data = r.json()
    ids = {n["id"] for n in data["nodes"]}
    assert {"alpha", "gamma"} <= ids
    assert "beta" not in ids
    assert data["partial"] is True
    assert data["skipped_dirs"] == [WEDGED_DIRNAME]


def test_warmup_failure_is_logged_at_warning(vault, monkeypatch, caplog):
    """A warmup that genuinely fails must be visible in the logs.

    The except in _request_dir_warmup only sees real failures — the "does not
    apply here" cases (wrong mode, throttled) return early without raising. At
    debug level a broken warmup looked exactly like a working one, which is how
    the throttle bug (#890) went unnoticed: the request was dropped in silence.
    """
    def boom(cmd, *args, **kwargs):
        raise OSError("no LaunchServices in this session")

    monkeypatch.setattr(gs.subprocess, "Popen", boom)
    monkeypatch.setenv("ONEDRIVE_WARMUP_MODE", "open")
    _wedge(monkeypatch)

    with caplog.at_level(logging.WARNING, logger=gs.log.name):
        get_markdown_files_efficient(vault, [])

    warmup_warnings = [
        r for r in caplog.records
        if r.levelno == logging.WARNING and "warmup request failed" in r.message
    ]
    assert warmup_warnings, "a failing warmup left no trace at WARNING level"
    assert WEDGED_DIRNAME in warmup_warnings[0].message
