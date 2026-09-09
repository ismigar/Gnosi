"""Per-request graph diagnostics are optional and contain only aggregate timing data."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import vault_graph_routes as routes
from backend.domains.graph import service, timing


def test_timing_header_is_opt_in_and_never_reused_with_the_cached_body(monkeypatch):
    payload = {
        "nodes": [], "edges": [], "legend": {"kinds": [], "clusters": []},
        "extension": {"private_fixture": "must-not-appear-in-diagnostics"},
    }
    monkeypatch.setattr(routes, "_cached_graph", None)
    monkeypatch.setattr(routes, "_cached_graph_json", None)
    monkeypatch.setattr(routes, "_cached_graph_gzip", None)

    def build():
        timing.graph_cache_hit("graph", True)
        return payload

    monkeypatch.setattr(routes, "GraphService", lambda: SimpleNamespace(build_unified_graph=build))
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        enabled = client.get("/graph", headers={"X-Gnosi-Graph-Timing": "1", "Accept-Encoding": "gzip"})
        assert enabled.status_code == 200
        assert enabled.json() == payload
        metrics = enabled.headers["server-timing"]
        assert "graph;dur=" in metrics and "json;dur=" in metrics and "gzip;dur=" in metrics
        assert 'graph_cache;desc="hit"' in metrics
        assert 'json_cache;desc="miss"' in metrics
        assert 'nodes;desc="0"' in metrics
        assert "must-not-appear" not in metrics and "private_fixture" not in metrics
        again = client.get("/graph", headers={"X-Gnosi-Graph-Timing": "1", "Accept-Encoding": "gzip"})
        assert 'json_cache;desc="hit"' in again.headers["server-timing"]
        assert 'gzip_cache;desc="hit"' in again.headers["server-timing"]
        for headers in ({}, {"X-Gnosi-Graph-Timing": "0"}):
            normal = client.get("/graph", headers=headers)
            assert normal.json() == payload
            assert "server-timing" not in normal.headers


def test_disabled_and_failed_timing_contexts_do_not_affect_later_requests(monkeypatch):
    clock = Mock(side_effect=[1.0, 1.025])
    monkeypatch.setattr(timing, "perf_counter", clock)
    with pytest.raises(RuntimeError):
        with timing.collect_graph_timing(True) as enabled:
            with timing.graph_phase("project"):
                raise RuntimeError("Synthetic failure")
    assert enabled is not None
    assert enabled.phases["project"] == pytest.approx(0.025)
    with timing.collect_graph_timing(False) as disabled:
        with timing.graph_phase("graph"):
            timing.graph_cache_hit("graph", True)
    with timing.graph_phase("json"):
        pass
    assert disabled is None
    assert clock.call_count == 2
    assert enabled.cache_hits == {}
    assert list(enabled.phases) == ["project"]


def test_concurrent_graph_timing_contexts_keep_independent_metrics():
    barrier = Barrier(2)

    def collect(hit):
        with timing.collect_graph_timing(True) as metrics:
            with timing.graph_phase("graph"):
                timing.graph_cache_hit("graph", hit)
                barrier.wait(timeout=2)
            assert metrics is not None
            return metrics.header(1 if hit else 2)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.map(collect, (True, False))
    assert 'graph_cache;desc="hit"' in first and 'nodes;desc="1"' in first
    assert 'graph_cache;desc="miss"' in second and 'nodes;desc="2"' in second


def test_graph_build_records_phases_and_preserves_response_cache(monkeypatch, tmp_path):
    cls = service.GraphService
    monkeypatch.setattr(service, "load_params", lambda **_: SimpleNamespace(paths={}))
    monkeypatch.setattr(service, "_resolve_active_vault_path", lambda _: tmp_path)
    monkeypatch.setattr(cls, "_graph_cache", {})
    monkeypatch.setattr(cls, "_last_graph_time", {})
    monkeypatch.setattr(cls, "_load_registry", lambda _: {})
    monkeypatch.setattr(cls, "_add_page_nodes", lambda *_: ([], []))
    for name in ("_load_node_cache", "_save_node_cache", "_add_contact_nodes", "_add_structural_edges", "_add_suggestion_edges"):
        monkeypatch.setattr(cls, name, lambda *_: None)
    with timing.collect_graph_timing(True) as cold:
        graph = cls().build_unified_graph()
    assert cold is not None
    assert cold.cache_hits == {"graph": False}
    assert set(cold.phases) == {
        "resolve", "revalidate", "registry", "node_cache_load", "pages", "node_cache_save",
        "contacts", "edges", "suggestions", "project", "input_sidecars",
    }
    with timing.collect_graph_timing(True) as warm:
        assert cls().build_unified_graph() is graph
    assert warm is not None
    assert warm.cache_hits == {"graph": True}
    assert set(warm.phases) == {"resolve"}


@pytest.mark.parametrize("fail", [False, True])
def test_graph_profile_is_opt_in_and_stops_even_when_the_read_fails(monkeypatch, fail):
    calls = []

    class SyntheticProfile:
        def run(self, function, *args, **kwargs):
            calls.append("run")
            return function(*args, **kwargs)

        def stop(self):
            calls.append("stop")
            return "a" * 24

    def start(enabled):
        calls.append(enabled)
        return SyntheticProfile() if enabled else None

    def build(**_kwargs):
        if fail:
            raise RuntimeError("Synthetic graph failure")
        return routes.GraphJSONResponse(content=b'{"nodes":[]}')

    monkeypatch.setattr(routes, "start_request_profile", start)
    monkeypatch.setattr(routes, "_build_graph_response", build)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        normal = client.get("/graph")
        assert normal.status_code == (500 if fail else 200)
        assert "x-gnosi-request-profile-id" not in normal.headers
        assert calls == [False]
        calls.clear()
        profiled = client.get("/graph", headers={"X-Gnosi-Graph-Profile": "1"})
    assert profiled.status_code == normal.status_code
    assert calls == [True, "run", "stop"]
    if fail:
        assert "x-gnosi-request-profile-id" not in profiled.headers
    else:
        assert profiled.content == normal.content
        assert profiled.headers["x-gnosi-request-profile-id"] == "a" * 24
