"""Overlapping graph reads share a build without extending its freshness."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.domains.graph import service
from backend.services.context_vars import active_vault_path


@pytest.fixture
def graph_service(monkeypatch, tmp_path):
    cls = service.GraphService
    monkeypatch.setattr(service, "load_params", lambda **_: SimpleNamespace(paths={}))
    monkeypatch.setattr(service, "_resolve_active_vault_path", lambda _: active_vault_path.get() or tmp_path)
    monkeypatch.setattr(cls, "_graph_cache", {})
    monkeypatch.setattr(cls, "_last_graph_time", {})
    monkeypatch.setattr(cls, "_load_registry", Mock(return_value={}))
    for name in ("_load_node_cache", "_save_node_cache", "_add_contact_nodes", "_add_structural_edges", "_add_suggestion_edges"):
        monkeypatch.setattr(cls, name, lambda *_: None)
    return cls


def test_concurrent_readers_share_one_build_and_hits_do_not_read_registry(graph_service, monkeypatch):
    entered, release = Event(), Event()
    calls = []

    def populate(_self, graph):
        calls.append(1)
        entered.set()
        assert release.wait(3)
        graph.add_node("one", label="One")
        return [], []

    monkeypatch.setattr(graph_service, "_add_page_nodes", populate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(graph_service().build_unified_graph)
        assert entered.wait(2)
        second = pool.submit(graph_service().build_unified_graph)
        release.set()
        one, two = first.result(timeout=3), second.result(timeout=3)
    assert one is two
    assert calls == [1]
    graph_service._load_registry.assert_called_once()
    assert graph_service().build_unified_graph() is one
    graph_service._load_registry.assert_called_once()


def test_different_vaults_build_independently(graph_service, monkeypatch, tmp_path):
    barrier = Barrier(2)

    def populate(_self, graph):
        barrier.wait(timeout=3)
        graph.add_node("one", label=active_vault_path.get().name)
        return [], []

    def build(name):
        token = active_vault_path.set(tmp_path / name)
        try:
            return graph_service().build_unified_graph()
        finally:
            active_vault_path.reset(token)

    monkeypatch.setattr(graph_service, "_add_page_nodes", populate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(build, ("first", "second")))
    assert [result["nodes"][0]["label"] for result in results] == ["first", "second"]


def test_invalidation_during_build_is_not_overwritten_by_late_result(graph_service, monkeypatch):
    entered, release = Event(), Event()
    calls = []

    def populate(_self, graph):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            assert release.wait(3)
        graph.add_node("one", label=str(len(calls)))
        return [], []

    monkeypatch.setattr(graph_service, "_add_page_nodes", populate)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(graph_service().build_unified_graph)
        assert entered.wait(2)
        graph_service.invalidate_response_cache()
        release.set()
        assert first.result(timeout=3)["nodes"][0]["label"] == "1"
    assert graph_service().build_unified_graph()["nodes"][0]["label"] == "2"


def test_expired_snapshot_still_rebuilds(graph_service, monkeypatch):
    populate = Mock(return_value=([], []))
    monkeypatch.setattr(graph_service, "_add_page_nodes", populate)
    first = graph_service().build_unified_graph()
    for key in graph_service._last_graph_time:
        graph_service._last_graph_time[key] = 0
    assert graph_service().build_unified_graph() is not first
    assert populate.call_count == 2
    assert graph_service._load_registry.call_count == 2
