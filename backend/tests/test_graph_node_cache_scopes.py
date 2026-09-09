"""Persistent graph caches load and save independently for each vault."""

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.domains.graph import service


@pytest.fixture()
def cache(monkeypatch, tmp_path):
    graph_type = service.GraphService
    monkeypatch.setattr(graph_type, '_NODE_CACHE_LOADED', set())
    monkeypatch.setattr(graph_type, '_NODE_CACHE_DIRTY', set())
    monkeypatch.setattr(graph_type, '_NODE_DATA_CACHE', {})
    monkeypatch.setattr(graph_type, '_NODE_SEMANTIC_REVISION', {})
    monkeypatch.setattr(service, 'load_params', lambda **_: SimpleNamespace(
        paths={'LOCAL_CACHE': tmp_path / 'cache'},
    ))
    (tmp_path / 'cache').mkdir()
    return graph_type


def test_legacy_cache_migrates_only_requested_vault_and_then_is_not_read(cache, tmp_path, monkeypatch):
    vault = tmp_path / 'vault'
    neighbor = tmp_path / 'vault-neighbor'
    current = {str(vault / 'one.md'): {'mtime': 1, 'id': 'one'}}
    foreign = {str(neighbor / 'two.md'): {'mtime': 2, 'id': 'two'}}
    legacy = cache._node_cache_path()
    legacy.write_text(json.dumps({**current, **foreign}), encoding='utf-8')
    original = legacy.read_bytes()
    cache._load_node_cache(vault)
    assert cache._NODE_DATA_CACHE == current
    assert cache._NODE_CACHE_DIRTY == {str(vault)}
    cache._save_node_cache(vault)
    scoped = cache._node_cache_path(vault)
    assert json.loads(scoped.read_bytes()) == current
    assert legacy.read_bytes() == original

    cache._NODE_CACHE_LOADED.clear()
    cache._NODE_DATA_CACHE.clear()
    original_open = Path.open
    reads = []

    def checked_open(path, *args, **kwargs):
        if not path.name.endswith('.meta.json'):
            reads.append(path)
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'open', checked_open)
    cache._load_node_cache(vault)
    assert cache._NODE_DATA_CACHE == current
    assert reads == [scoped]
    assert not cache._NODE_CACHE_DIRTY

    # Loading a second vault in the same process still performs its own read.
    cache._load_node_cache(neighbor)
    assert reads == [scoped, legacy]
    assert cache._NODE_DATA_CACHE == {**current, **foreign}
    assert cache._NODE_CACHE_LOADED == {str(vault), str(neighbor)}
    assert cache._NODE_CACHE_DIRTY == {str(neighbor)}


def test_saving_one_vault_keeps_other_vaults_dirty_and_out_of_its_file(cache, tmp_path):
    vaults = [tmp_path / 'a', tmp_path / 'b']
    entries = [{str(vault / 'page.md'): {'id': f'page-{i}'}} for i, vault in enumerate(vaults)]
    cache._NODE_DATA_CACHE.update({**entries[0], **entries[1]})
    cache._NODE_CACHE_DIRTY.update(str(vault) for vault in vaults)
    cache._save_node_cache(vaults[0])
    assert cache._NODE_CACHE_DIRTY == {str(vaults[1])}
    assert not cache._node_cache_path(vaults[1]).exists()
    cache._save_node_cache(vaults[1])
    assert not cache._NODE_CACHE_DIRTY
    for vault, expected in zip(vaults, entries):
        assert json.loads(cache._node_cache_path(vault).read_bytes()) == expected


def test_failed_save_keeps_its_vault_pending_after_another_save_succeeds(cache, tmp_path, monkeypatch):
    vaults = [tmp_path / 'a', tmp_path / 'b']
    cache._NODE_DATA_CACHE.update({str(vault / 'page.md'): {'id': 'page'} for vault in vaults})
    cache._NODE_CACHE_DIRTY.update(str(vault) for vault in vaults)
    write = service.safe_write_text

    def selective_failure(path, text):
        if path == cache._node_cache_path(vaults[0]):
            raise OSError('Temporary failure')
        write(path, text)

    monkeypatch.setattr(service, 'safe_write_text', selective_failure)
    for vault in vaults:
        cache._save_node_cache(vault)
    assert cache._NODE_CACHE_DIRTY == {str(vaults[0])}
    monkeypatch.setattr(service, 'safe_write_text', write)
    cache._save_node_cache(vaults[0])
    assert not cache._NODE_CACHE_DIRTY
    assert cache._node_cache_path(vaults[0]).exists()


def test_scoped_files_cannot_load_neighboring_vault_entries(cache, tmp_path):
    vault = tmp_path / 'a'
    scoped = cache._node_cache_path(vault)
    scoped.parent.mkdir()
    scoped.write_text(json.dumps({
        str(vault / 'page.md'): {'id': 'local'},
        str(tmp_path / 'a-neighbor' / 'page.md'): {'id': 'foreign'},
    }))
    cache._load_node_cache(vault)
    assert cache._NODE_DATA_CACHE == {str(vault / 'page.md'): {'id': 'local'}}


@pytest.mark.parametrize('raw', ['{"truncated":', '[]'])
def test_invalid_disk_cache_does_not_break_loading_or_poison_another_vault(cache, tmp_path, raw):
    broken = tmp_path / 'broken'
    healthy = tmp_path / 'healthy'
    path = cache._node_cache_path(broken)
    path.parent.mkdir()
    path.write_text(raw)
    good = {str(healthy / 'page.md'): {'id': 'healthy'}}
    cache._node_cache_path(healthy).write_text(json.dumps(good))
    cache._load_node_cache(broken)
    assert cache._NODE_DATA_CACHE == {}
    cache._load_node_cache(healthy)
    assert cache._NODE_DATA_CACHE == good


def test_semantic_marker_survives_restart_only_for_the_corresponding_saved_cache(cache, tmp_path):
    vault = tmp_path / 'vault'
    key = str(vault / 'page.md')
    cache._NODE_DATA_CACHE[key] = {'id': 'page'}
    cache._NODE_SEMANTIC_REVISION[str(vault)] = 'semantic-one'
    cache._NODE_CACHE_DIRTY.add(str(vault))
    cache._save_node_cache(vault)
    marker = cache._node_cache_path(vault).with_suffix('.meta.json')
    assert json.loads(marker.read_text())['semantic'] == 'semantic-one'
    cache._NODE_CACHE_LOADED.clear()
    cache._NODE_DATA_CACHE.clear()
    cache._NODE_SEMANTIC_REVISION.clear()
    cache._load_node_cache(vault)
    assert cache._NODE_SEMANTIC_REVISION[str(vault)] == 'semantic-one'
    cache._prepare_node_semantics(vault, 'semantic-one')
    assert key in cache._NODE_DATA_CACHE
    other = str(tmp_path / 'neighbor' / 'page.md')
    cache._NODE_DATA_CACHE[other] = {'id': 'neighbor'}
    cache._prepare_node_semantics(vault, 'semantic-two')
    assert key not in cache._NODE_DATA_CACHE and other in cache._NODE_DATA_CACHE
    assert str(vault) in cache._NODE_CACHE_DIRTY


def test_marker_write_failure_does_not_certify_a_new_cache_file(cache, tmp_path, monkeypatch):
    vault = tmp_path / 'vault'
    key = str(vault / 'page.md')
    cache._NODE_DATA_CACHE[key] = {'id': 'old'}
    cache._NODE_SEMANTIC_REVISION[str(vault)] = 'old'
    cache._NODE_CACHE_DIRTY.add(str(vault))
    cache._save_node_cache(vault)
    write = service.safe_write_text

    def unavailable_marker(path, text):
        if path.name.endswith('.meta.json'):
            raise OSError('Synthetic marker write failure')
        return write(path, text)

    monkeypatch.setattr(service, 'safe_write_text', unavailable_marker)
    cache._NODE_DATA_CACHE[key] = {'id': 'new'}
    cache._NODE_SEMANTIC_REVISION[str(vault)] = 'new'
    cache._NODE_CACHE_DIRTY.add(str(vault))
    cache._save_node_cache(vault)
    assert str(vault) in cache._NODE_CACHE_DIRTY
    cache._NODE_DATA_CACHE.clear()
    cache._NODE_CACHE_LOADED.clear()
    cache._NODE_SEMANTIC_REVISION.clear()
    cache._load_node_cache(vault)
    assert str(vault) not in cache._NODE_SEMANTIC_REVISION
    cache._prepare_node_semantics(vault, 'new')
    assert key not in cache._NODE_DATA_CACHE


def test_legacy_cache_without_marker_requires_one_semantic_refresh(cache, tmp_path):
    vault = tmp_path / 'vault'
    key = str(vault / 'page.md')
    path = cache._node_cache_path(vault)
    path.parent.mkdir()
    path.write_text(json.dumps({key: {'id': 'legacy'}}))
    cache._load_node_cache(vault)
    assert key in cache._NODE_DATA_CACHE
    cache._prepare_node_semantics(vault, 'current')
    assert key not in cache._NODE_DATA_CACHE
    assert str(vault) in cache._NODE_CACHE_DIRTY


def test_marker_cannot_certify_a_file_replaced_by_another_writer(cache, tmp_path, monkeypatch):
    vault = tmp_path / 'vault'
    key = str(vault / 'page.md')
    path = cache._node_cache_path(vault)
    cache._NODE_DATA_CACHE[key] = {'id': 'our-writer'}
    cache._NODE_SEMANTIC_REVISION[str(vault)] = 'our-semantic'
    cache._NODE_CACHE_DIRTY.add(str(vault))
    original_write = service.safe_write_text
    other = json.dumps({key: {'id': 'other-writer'}})

    def interleaved_write(target, text):
        original_write(target, text)
        if target == path:
            original_write(path, other)

    monkeypatch.setattr(service, 'safe_write_text', interleaved_write)
    cache._save_node_cache(vault)
    marker = json.loads(path.with_suffix('.meta.json').read_text())
    assert marker['cache_digest'] != hashlib.sha256(other.encode()).hexdigest()
    cache._NODE_DATA_CACHE.clear()
    cache._NODE_CACHE_LOADED.clear()
    cache._NODE_SEMANTIC_REVISION.clear()
    cache._load_node_cache(vault)
    assert str(vault) not in cache._NODE_SEMANTIC_REVISION
    cache._prepare_node_semantics(vault, 'our-semantic')
    assert key not in cache._NODE_DATA_CACHE


def test_marker_matches_the_content_read_even_if_the_path_changes_during_parse(cache, tmp_path, monkeypatch):
    vault = tmp_path / 'vault'
    key = str(vault / 'page.md')
    path = cache._node_cache_path(vault)
    cache._NODE_DATA_CACHE[key] = {'id': 'original'}
    cache._NODE_SEMANTIC_REVISION[str(vault)] = 'original'
    cache._NODE_CACHE_DIRTY.add(str(vault))
    cache._save_node_cache(vault)
    parse = cache._parse_node_cache
    replacement = json.dumps({key: {'id': 'replacement'}})

    def replace_after_read(raw):
        parsed = parse(raw)
        service.safe_write_text(path, replacement)
        service.safe_write_text(path.with_suffix('.meta.json'), json.dumps({
            'semantic': 'replacement',
            'cache_digest': hashlib.sha256(replacement.encode()).hexdigest(),
        }))
        return parsed

    monkeypatch.setattr(cache, '_parse_node_cache', staticmethod(replace_after_read))
    cache._NODE_DATA_CACHE.clear()
    cache._NODE_CACHE_LOADED.clear()
    cache._NODE_SEMANTIC_REVISION.clear()
    cache._load_node_cache(vault)
    assert cache._NODE_DATA_CACHE[key]['id'] == 'original'
    assert str(vault) not in cache._NODE_SEMANTIC_REVISION
