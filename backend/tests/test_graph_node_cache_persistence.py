"""Repeated graph builds must not rewrite unchanged parsed notes."""
from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.domains.graph import service
from backend.domains.graph.timing import collect_graph_timing


@pytest.mark.parametrize('raw', [
    '{"metadata":{"title":"Catal\\u00e0 \\ud83d\\udcda","enabled":true,"empty":null},"links":["a","b"]}',
    '{"same":1,"other":0,"same":2}',
    '[{"number":1.25},false,null,"中文"]',
    '"scalar"',
    'null',
    '"\\ud800"',
    '[' * 256 + '0' + ']' * 256,
])
def test_node_cache_parser_preserves_json_values_and_stdlib_fallbacks(raw):
    assert service.GraphService._parse_node_cache(raw) == json.loads(raw)


def test_node_cache_parser_preserves_big_integers_and_nonfinite_numbers():
    huge = 10 ** 120 + 17
    raw = '{"large":' + str(huge) + ',"negative":' + str(-huge) + (
        ',"nan":NaN,"infinity":Infinity,"negative_infinity":-Infinity,"zero":-0.0}'
    )
    parsed = service.GraphService._parse_node_cache(raw)

    assert type(parsed['large']) is int and parsed['large'] == huge
    assert type(parsed['negative']) is int and parsed['negative'] == -huge
    assert math.isnan(parsed['nan'])
    assert parsed['infinity'] == math.inf
    assert parsed['negative_infinity'] == -math.inf
    assert math.copysign(1.0, parsed['zero']) == -1.0


@pytest.mark.parametrize('raw', [
    '{"synthetic-private-marker":[1,2',
    '{"synthetic-private-marker":1,}',
    '{"synthetic-private-marker":1} false',
    '{"synthetic-private-marker":"unescaped\ncontrol"}',
])
def test_node_cache_parser_keeps_stdlib_corruption_errors_without_core_context(raw):
    with pytest.raises(json.JSONDecodeError) as expected:
        json.loads(raw)
    with pytest.raises(json.JSONDecodeError) as actual:
        service.GraphService._parse_node_cache(raw)

    assert type(actual.value) is type(expected.value)
    assert (actual.value.msg, actual.value.pos, actual.value.lineno, actual.value.colno) == (
        expected.value.msg, expected.value.pos, expected.value.lineno, expected.value.colno,
    )
    assert actual.value.__context__ is None
    assert 'synthetic-private-marker' not in str(actual.value)


@pytest.fixture()
def graph_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    class Config(SimpleNamespace):
        def get(self, _key, default=None):
            return default

    cfg = Config(paths={'VAULT': tmp_path, 'GNOSI_CONFIG': tmp_path / '.gnosi'}, colors={})
    monkeypatch.setattr(service, 'load_params', lambda **_: cfg)
    monkeypatch.setattr(service, '_resolve_active_vault_path', lambda _: tmp_path)
    graph_type = service.GraphService
    monkeypatch.setattr(graph_type, '_graph_cache', {})
    monkeypatch.setattr(graph_type, '_last_graph_time', {})
    monkeypatch.setattr(graph_type, '_NODE_DATA_CACHE', {})
    monkeypatch.setattr(graph_type, '_NODE_CACHE_LOADED', {str(tmp_path)})
    monkeypatch.setattr(graph_type, '_NODE_CACHE_DIRTY', set())
    cache_file = tmp_path / 'cache' / 'graph.json'
    monkeypatch.setattr(graph_type, '_node_cache_path', staticmethod(lambda _vault=None: cache_file))
    monkeypatch.setattr(graph_type, '_load_registry', lambda _: {})
    monkeypatch.setattr(graph_type, '_add_contact_nodes', lambda *_: None)
    monkeypatch.setattr(graph_type, '_add_suggestion_edges', lambda *_: None)
    files = [tmp_path / 'one.md', tmp_path / 'two.md']
    files[0].write_text('---\nid: one\ntitle: One\n---\n[[Two]]', encoding='utf-8')
    files[1].write_text('---\nid: two\ntitle: Two\n---\nBody', encoding='utf-8')
    monkeypatch.setattr(service, 'indexed_markdown_files', lambda _: [(p, p.stat().st_mtime) for p in files])
    return graph_type, cache_file, files


def test_persistent_cache_read_times_read_parse_and_hash_without_content(graph_cache, monkeypatch):
    graph_type, cache_file, files = graph_cache
    payload = {str(files[0]): {'title': 'Synthetic timing marker', 'mtime': 12.5}}
    cache_file.parent.mkdir()
    cache_file.write_text(json.dumps(payload), encoding='utf-8')
    monkeypatch.setattr(graph_type, '_NODE_CACHE_LOADED', set())

    with collect_graph_timing(True) as timing:
        graph_type._load_node_cache(files[0].parent)

    assert graph_type._NODE_DATA_CACHE == payload
    assert timing is not None
    assert set(timing.phases) == {'node_cache_read', 'node_cache_parse', 'node_cache_hash'}
    assert all(duration >= 0 for duration in timing.phases.values())
    header = timing.header(1)
    assert str(files[0]) not in header
    assert 'Synthetic timing marker' not in header


def test_corrupt_persistent_cache_never_publishes_partial_content_or_logs_input(
    graph_cache, monkeypatch, caplog,
):
    graph_type, cache_file, files = graph_cache
    private_marker = 'synthetic-private-cache-marker'
    cache_file.parent.mkdir()
    prefix = json.dumps({str(files[0]): {'title': private_marker}})[:-1]
    cache_file.write_text(prefix + ', "broken": ]}', encoding='utf-8')
    previous = {'other-vault-synthetic': {'title': 'Previous valid snapshot'}}
    monkeypatch.setattr(graph_type, '_NODE_DATA_CACHE', previous.copy())
    monkeypatch.setattr(graph_type, '_NODE_CACHE_LOADED', set())

    graph_type._load_node_cache(files[0].parent)

    assert graph_type._NODE_DATA_CACHE == previous
    assert 'Could not load the graph node cache' in caplog.text
    assert private_marker not in caplog.text


def test_rebuilds_write_only_changes_and_reload_the_same_graph(graph_cache, monkeypatch):
    graph_type, cache_file, files = graph_cache
    writes = []
    original_write = service.safe_write_text

    def record_write(path, text):
        if path == cache_file:
            writes.append(path)
        original_write(path, text)

    monkeypatch.setattr(service, 'safe_write_text', record_write)
    first = graph_type().build_unified_graph()
    assert cache_file.exists()
    assert not graph_type._NODE_CACHE_DIRTY
    graph_type.invalidate_response_cache()
    assert graph_type().build_unified_graph() == first
    assert len(writes) == 1

    previous_mtime = files[0].stat().st_mtime
    files[0].write_text('---\nid: one\ntitle: Renamed\n---\n[[Two]]\n[[Missing]]', encoding='utf-8')
    os.utime(files[0], (previous_mtime + 1, previous_mtime + 1))
    graph_type.invalidate_response_cache()
    updated = graph_type().build_unified_graph()
    assert any(node['label'] == 'Renamed' for node in updated['nodes'])
    assert len(updated['edges']) == len(first['edges']) + 1
    assert len(writes) == 2

    graph_type._NODE_DATA_CACHE = {}
    graph_type._NODE_CACHE_LOADED = set()
    graph_type.invalidate_response_cache()
    assert graph_type().build_unified_graph() == updated
    assert len(writes) == 2


def test_failed_save_is_retried_even_when_notes_have_not_changed(graph_cache, monkeypatch):
    graph_type, cache_file, _ = graph_cache
    original_write = service.safe_write_text

    def fail_write(*_):
        raise OSError('Temporary write failure')

    monkeypatch.setattr(service, 'safe_write_text', fail_write)
    first = graph_type().build_unified_graph()
    assert graph_type._NODE_CACHE_DIRTY
    assert not cache_file.exists()
    monkeypatch.setattr(service, 'safe_write_text', original_write)
    graph_type.invalidate_response_cache()
    assert graph_type().build_unified_graph() == first
    assert not graph_type._NODE_CACHE_DIRTY
    assert len(json.loads(cache_file.read_text())) == 2


def test_simultaneous_initial_reads_wait_for_one_complete_disk_cache(graph_cache, monkeypatch):
    graph_type, cache_file, _ = graph_cache
    graph_type().build_unified_graph()
    expected = dict(graph_type._NODE_DATA_CACHE)
    graph_type._NODE_DATA_CACHE = {}
    graph_type._NODE_CACHE_LOADED = set()
    entered = threading.Event()
    release = threading.Event()
    second_done = threading.Event()
    calls = 0
    original_load = graph_type._parse_node_cache

    def delayed_load(handle):
        nonlocal calls
        calls += 1
        entered.set()
        assert release.wait(timeout=2)
        return original_load(handle)

    monkeypatch.setattr(graph_type, '_parse_node_cache', staticmethod(delayed_load))
    vault = cache_file.parent.parent
    first = threading.Thread(target=lambda: graph_type._load_node_cache(vault))
    second = threading.Thread(target=lambda: (graph_type._load_node_cache(vault), second_done.set()))
    first.start()
    try:
        assert entered.wait(timeout=1)
        second.start()
        assert not second_done.wait(timeout=0.05)
    finally:
        release.set()
        first.join(timeout=2)
        if second.ident is not None:
            second.join(timeout=2)
    assert not first.is_alive() and not second.is_alive()
    assert calls == 1
    assert second_done.is_set()
    # JSON turns the pre-heading None key into "null", as in the existing format.
    assert graph_type._NODE_DATA_CACHE == json.loads(json.dumps(expected, default=str))
    assert cache_file.exists()


def test_an_edit_during_persistence_remains_dirty_until_saved(graph_cache, monkeypatch):
    graph_type, cache_file, files = graph_cache
    graph_type().build_unified_graph()
    previous_mtime = files[0].stat().st_mtime
    files[0].write_text('---\nid: one\ntitle: Concurrent edit\n---\nBody', encoding='utf-8')
    os.utime(files[0], (previous_mtime + 1, previous_mtime + 1))
    saving = threading.Event()
    release = threading.Event()
    updated = threading.Event()
    original_write = service.safe_write_text
    original_read = service.load_page_data

    def delayed_write(path, text):
        saving.set()
        assert release.wait(timeout=2)
        original_write(path, text)

    def record_read(*args):
        data = original_read(*args)
        if data['title'] == 'Concurrent edit':
            updated.set()
        return data

    monkeypatch.setattr(service, 'safe_write_text', delayed_write)
    monkeypatch.setattr(service, 'load_page_data', record_read)
    vault = cache_file.parent.parent
    graph_type._NODE_CACHE_DIRTY = {str(vault)}
    writer = threading.Thread(target=lambda: graph_type._save_node_cache(vault))
    reader = threading.Thread(target=lambda: graph_type()._add_page_nodes(service.directed_graph()))
    writer.start()
    try:
        assert saving.wait(timeout=1)
        reader.start()
        assert updated.wait(timeout=1)
    finally:
        release.set()
        writer.join(timeout=2)
        if reader.ident is not None:
            reader.join(timeout=2)
    assert not writer.is_alive() and not reader.is_alive()
    assert graph_type._NODE_CACHE_DIRTY
    monkeypatch.setattr(service, 'safe_write_text', original_write)
    graph_type._save_node_cache(vault)
    assert json.loads(cache_file.read_text())[str(files[0])]['title'] == 'Concurrent edit'
    assert not graph_type._NODE_CACHE_DIRTY
