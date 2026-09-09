"""Graph construction must release temporary storage without waiting for cyclic GC."""

from __future__ import annotations

import gc
import weakref
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.domains.graph import service


@pytest.mark.parametrize('outcome', ['complete', 'partial', 'failure'])
def test_temporary_attributes_are_released_before_return_or_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outcome: str,
) -> None:
    graph_type = service.GraphService
    monkeypatch.setattr(service, 'load_params', lambda **_: SimpleNamespace(paths={}))
    monkeypatch.setattr(service, '_resolve_active_vault_path', lambda _: tmp_path)
    monkeypatch.setattr(graph_type, '_graph_cache', {})
    monkeypatch.setattr(graph_type, '_last_graph_time', {})
    monkeypatch.setattr(graph_type, '_load_registry', lambda _: {})
    monkeypatch.setattr(graph_type, '_load_node_cache', classmethod(lambda *_: None))
    monkeypatch.setattr(graph_type, '_save_node_cache', classmethod(lambda *_: None))
    monkeypatch.setattr(graph_type, '_add_contact_nodes', lambda *_: None)
    monkeypatch.setattr(graph_type, '_add_structural_edges', lambda *_: None)
    monkeypatch.setattr(graph_type, '_add_suggestion_edges', lambda *_: None)

    class TemporaryAttribute:
        pass

    references: list[weakref.ReferenceType[TemporaryAttribute]] = []

    def populate(_self, graph):
        temporary = TemporaryAttribute()
        references.append(weakref.ref(temporary))
        graph.add_node('one', label='One', metadata={'custom': {'values': [1, 'two']}})
        graph.add_node('two', label='Two', metadata={})
        graph.add_edge('one', 'two', kind='relation', temporary=temporary)
        # Access the same cached view used by projection. It keeps a reference
        # back to the graph, so dropping the local variable alone is insufficient.
        assert graph.edges['one', 'two']['temporary'] is temporary
        return [], ['unreadable'] if outcome == 'partial' else []

    monkeypatch.setattr(graph_type, '_add_page_nodes', populate)
    if outcome == 'failure':
        def fail_projection(_graph):
            raise RuntimeError('Projection failed')

        monkeypatch.setattr(service, 'project_edges', fail_projection)

    was_enabled = gc.isenabled()
    gc.disable()
    try:
        if outcome == 'failure':
            with pytest.raises(RuntimeError, match='Projection failed'):
                graph_type().build_unified_graph()
        else:
            result = graph_type().build_unified_graph()
            assert result['nodes'][0]['metadata'] == {'custom': {'values': [1, 'two']}}
            assert result['edges'][0]['source'] == 'one'
            assert result['edges'][0]['target'] == 'two'
            assert result['edges'][0]['kind'] == 'relation'
            assert 'temporary' not in result['edges'][0]
            if outcome == 'complete':
                assert graph_type().build_unified_graph() is result
                assert len(references) == 1
            else:
                assert result['partial'] is True
                assert result['skipped_dirs'] == ['unreadable']
        assert references and all(reference() is None for reference in references)
    finally:
        if was_enabled:
            gc.enable()
