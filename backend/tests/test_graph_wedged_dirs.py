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
import os
import sys
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

    GraphService._graph_cache = None
    GraphService._last_graph_time = 0
    GraphService._node_count_cache = 0
    GraphService._last_count_time = 0
    GraphService._NODE_DATA_CACHE = {}
    GraphService._ID_TO_PATH_CACHE = {}
    GraphService._LAYOUT_CACHE = {}
    GraphService._LAYOUT_HASH = None
    # Skip disk cache loads: keep the test hermetic regardless of prior runs.
    GraphService._NODE_CACHE_LOADED = True
    GraphService._LAYOUT_CACHE_LOADED = True
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


@pytest.mark.skipif(
    sys.platform != "darwin",
    reason=(
        "Asserts the macOS-only warmup path: mode 'open' shells out to "
        "/usr/bin/open (LaunchServices) to hydrate a wedged File Provider "
        "directory. On other platforms _default_warmup_mode() never returns "
        "'open', so forcing it via the env var tests a configuration that "
        "cannot occur there."
    ),
)
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
    assert GraphService._graph_cache is None

    # OneDrive recovers → the very next build is complete and cacheable
    # (no TTL wait, precisely because the partial result was not cached).
    state["on"] = False
    result2 = svc.build_unified_graph()
    ids2 = {n["id"] for n in result2["nodes"]}
    assert {"alpha", "beta", "gamma"} <= ids2
    assert "partial" not in result2
    assert GraphService._graph_cache is result2


def test_node_count_keeps_previous_value_on_partial_scan(vault, monkeypatch):
    svc = GraphService()

    # Healthy scan first: 3 pages (+0 registry items) cached.
    full_count = svc.get_node_count()
    assert full_count >= 3

    # Wedge the dir, expire caches → the partial rescan must NOT lower the count.
    _wedge(monkeypatch)
    GraphService._last_count_time = 0
    GraphService._NODE_DATA_CACHE = {}  # force the disk-scan fallback branch
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
