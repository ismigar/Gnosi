"""Expired graph snapshots are reused only after complete source revalidation."""

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock
import json
import os

import pytest

from backend.domains.graph import cache_inputs, service


class Config(SimpleNamespace):
    def get(self, key, default=None):
        return getattr(self, key, default)


@pytest.fixture(autouse=True)
def isolated_managed_snapshots(monkeypatch):
    monkeypatch.setattr(cache_inputs, "_MANAGED_STATE_CACHE", OrderedDict())


@pytest.fixture
def graph_state(monkeypatch, tmp_path):
    cls = service.GraphService
    cfg = Config(paths={"GNOSI_CONFIG": tmp_path / ".gnosi"}, colors={}, app={})
    current = [cache_inputs.GraphInputs(cfg, [], {}, [], [], "semantic", "initial")]
    monkeypatch.setattr(service, "load_params", lambda **_: cfg)
    monkeypatch.setattr(service, "_resolve_active_vault_path", lambda _: tmp_path)
    for name in ("_graph_cache", "_last_graph_time", "_graph_input_revisions", "_NODE_SEMANTIC_REVISION", "_NODE_DATA_CACHE"):
        monkeypatch.setattr(cls, name, {})
    monkeypatch.setattr(cls, "_NODE_CACHE_DIRTY", set())
    capture = Mock(side_effect=lambda *_: current[0])
    monkeypatch.setattr(cls, "_capture_inputs", capture)
    monkeypatch.setattr(cls, "_load_registry", lambda _: {})
    save = Mock(side_effect=lambda path: cls._NODE_CACHE_DIRTY.discard(str(path)))
    monkeypatch.setattr(cls, "_save_node_cache", save)
    for name in ("_load_node_cache", "_add_contact_nodes", "_add_structural_edges", "_add_suggestion_edges"):
        monkeypatch.setattr(cls, name, lambda *_: None)
    builds = []

    def populate(instance, graph):
        builds.append(1)
        graph.add_node("page", label=instance._inputs.revision if instance._inputs else "fallback")
        return [], []

    monkeypatch.setattr(cls, "_add_page_nodes", populate)
    return cls, current, capture, save, builds, tmp_path


def test_expiry_revalidates_inputs_and_keeps_the_same_projection(graph_state):
    cls, _, capture, save, builds, vault = graph_state
    original = cls().build_unified_graph()
    assert capture.call_count == 2  # Captured inputs and verification after build.
    cls._last_graph_time[str(vault)] = 0
    assert cls().build_unified_graph() is original
    assert capture.call_count == 3
    assert len(builds) == 1 and save.call_count == 1
    assert cls().build_unified_graph() is original
    assert capture.call_count == 3


@pytest.mark.parametrize("changed", ["index", "registry", "contacts", "suggestions", "config", "sidecar"])
def test_changed_sources_rebuild_and_semantic_changes_clear_only_their_vault(graph_state, changed):
    cls, current, _, _, builds, vault = graph_state
    original = cls().build_unified_graph()
    local, foreign = str(vault / "page.md"), str(vault.parent / "other" / "page.md")
    cls._NODE_DATA_CACHE.update({local: {"id": "local"}, foreign: {"id": "foreign"}})
    current[0] = replace(current[0], revision=changed,
                         semantic=changed if changed in ("config", "sidecar") else "semantic")
    cls._last_graph_time[str(vault)] = 0
    updated = cls().build_unified_graph()
    assert updated is not original and len(builds) == 2
    assert updated["nodes"][0]["label"] == changed
    assert foreign in cls._NODE_DATA_CACHE
    assert (local in cls._NODE_DATA_CACHE) is (changed not in ("config", "sidecar"))


def test_missing_index_falls_back_to_normal_rebuilds(graph_state):
    cls, current, _, _, builds, vault = graph_state
    original = cls().build_unified_graph()
    current[0] = None
    cls._last_graph_time[str(vault)] = 0
    assert cls().build_unified_graph() is not original
    assert str(vault) not in cls._graph_input_revisions
    cls._last_graph_time[str(vault)] = 0
    cls().build_unified_graph()
    assert len(builds) == 3


@pytest.mark.parametrize("failure", ["changed-during-build", "partial", "read-error"])
def test_incomplete_inputs_never_publish_a_response_or_persistent_marker(graph_state, monkeypatch, failure):
    cls, current, _, save, _, _ = graph_state

    def populate(instance, graph):
        graph.add_node("page", label="Page")
        if failure == "changed-during-build":
            current[0] = replace(current[0], revision="changed")
        elif failure == "read-error":
            instance._input_read_failed = True
        return [], ["Unreadable"] if failure == "partial" else []

    monkeypatch.setattr(cls, "_add_page_nodes", populate)
    assert cls().build_unified_graph()["partial"] is True
    assert cls._graph_cache == {} and cls._graph_input_revisions == {}
    save.assert_not_called()


def test_concurrent_expired_readers_share_one_revalidation(graph_state, monkeypatch):
    cls, current, _, _, builds, vault = graph_state
    original = cls().build_unified_graph()
    cls._last_graph_time[str(vault)] = 0
    entered, release = Event(), Event()
    calls = []

    def capture(*_):
        calls.append(1)
        entered.set()
        assert release.wait(timeout=2)
        return current[0]

    monkeypatch.setattr(cls, "_capture_inputs", capture)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(cls().build_unified_graph)
        assert entered.wait(timeout=1)
        second = pool.submit(cls().build_unified_graph)
        release.set()
        assert first.result(timeout=2) is original
        assert second.result(timeout=2) is original
    assert len(calls) == 1 and len(builds) == 1


def test_invalidation_during_revalidation_cannot_restore_the_retired_snapshot(graph_state, monkeypatch):
    cls, current, _, _, _, vault = graph_state
    original = cls().build_unified_graph()
    cls._last_graph_time[str(vault)] = 0
    invalidated = False

    def capture(*_):
        nonlocal invalidated
        if not invalidated:
            invalidated = True
            cls.invalidate_response_cache()
        return current[0]

    monkeypatch.setattr(cls, "_capture_inputs", capture)
    assert cls().build_unified_graph() is not original
    assert cls._graph_cache == {} and cls._graph_input_revisions == {}


def test_source_fingerprint_covers_each_input_and_scopes_sidecars(monkeypatch, tmp_path):
    cfg = Config(paths={"GNOSI_CONFIG": tmp_path / "a"}, colors={}, app={})
    files = [(tmp_path / "one.md", 1.0)]
    registry = {"tables": []}
    contacts = []
    monkeypatch.setattr(cache_inputs, "read_contact_nodes", lambda _: contacts)
    baseline = cache_inputs.capture_graph_inputs(cfg, files, registry)
    assert cache_inputs.capture_graph_inputs(cfg, files, registry).revision == baseline.revision
    assert cache_inputs.capture_graph_inputs(cfg, [(files[0][0], 2.0)], registry).revision != baseline.revision
    assert cache_inputs.capture_graph_inputs(cfg, files, {"tables": [{"id": "table"}]}).revision != baseline.revision
    contacts.append({"id": "contact", "label": "Updated"})
    assert cache_inputs.capture_graph_inputs(cfg, files, registry).revision != baseline.revision
    contacts.clear()
    cfg.paths["GNOSI_CONFIG"].mkdir()
    queue = cfg.paths["GNOSI_CONFIG"] / "llm_wiki_suggestions.json"
    queue.write_text(json.dumps({"suggestions": [{"id": "proposal", "member_ids": ["one", "two"]}]}))
    assert cache_inputs.capture_graph_inputs(cfg, files, registry).revision != baseline.revision
    queue.unlink()
    cfg.colors = {"node_types": {"page": {"bg": "#123456"}}}
    assert cache_inputs.capture_graph_inputs(cfg, files, registry).semantic != baseline.semantic
    cfg.colors = {}
    cfg.app = {"type_property": "kind"}
    assert cache_inputs.capture_graph_inputs(cfg, files, registry).semantic != baseline.semantic
    cfg.app = {}
    states = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages"
    states.mkdir(parents=True)
    (states / "one.json").write_text('{"metadata":{"title":"Changed"}}')
    assert cache_inputs.capture_graph_inputs(cfg, files, registry).semantic != baseline.semantic
    other = Config(paths={"GNOSI_CONFIG": tmp_path / "b"}, colors={}, app={})
    before = cache_inputs.semantic_revision(other)
    (states / "one.json").write_text('{"metadata":{"title":"Changed again"}}')
    assert cache_inputs.semantic_revision(other) == before


def test_unreadable_or_invalid_source_is_not_an_empty_success(monkeypatch, tmp_path):
    cfg = Config(paths={"GNOSI_CONFIG": tmp_path}, colors={}, app={})
    monkeypatch.setattr(cache_inputs, "read_contact_nodes", lambda _: [])
    (tmp_path / "llm_wiki_suggestions.json").write_text('{"truncated":')
    with pytest.raises(ValueError):
        cache_inputs.capture_graph_inputs(cfg, [], {})


@pytest.mark.parametrize("source", ["sidecars", "suggestions", "contacts", "registry"])
def test_graph_input_diagnostics_never_include_exception_messages_or_paths(caplog, source):
    error = OSError(35, "private fixture contents", "/private/fixture/path.json")
    with pytest.raises(OSError) as caught:
        with cache_inputs.graph_input_source(source):
            raise error
    assert caught.value is error
    assert f"source={source} type={type(error).__name__} errno=35" in caplog.text
    assert "private fixture" not in caplog.text and "/private/fixture" not in caplog.text


def test_changed_config_and_sidecars_refresh_nodes_without_a_markdown_edit(monkeypatch, tmp_path):
    cls = service.GraphService
    cfg = Config(paths={"VAULT": tmp_path, "GNOSI_CONFIG": tmp_path / ".gnosi"},
                 colors={"node_types": {"page": {"bg": "#123456"}}}, app={})
    page = tmp_path / "one.md"
    page.write_text('---\nid: one\ntitle: Portable title\ncustom_kind: contact\n---\nBody')
    mtime = page.stat().st_mtime
    monkeypatch.setattr(service, "load_params", lambda **_: cfg)
    monkeypatch.setattr(service, "_resolve_active_vault_path", lambda _: tmp_path)
    monkeypatch.setattr(service, "indexed_markdown_files", lambda _: [(page, mtime)])
    monkeypatch.setattr(cache_inputs, "read_contact_nodes", lambda _: [])
    monkeypatch.setattr(cls, "_load_registry", lambda _: {})
    for name in ("_graph_cache", "_last_graph_time", "_graph_input_revisions", "_NODE_SEMANTIC_REVISION", "_NODE_DATA_CACHE"):
        monkeypatch.setattr(cls, name, {})
    monkeypatch.setattr(cls, "_NODE_CACHE_LOADED", {str(tmp_path)})
    monkeypatch.setattr(cls, "_NODE_CACHE_DIRTY", set())
    monkeypatch.setattr(cls, "_save_node_cache", lambda path: cls._NODE_CACHE_DIRTY.discard(str(path)))

    def rebuild():
        cls._last_graph_time[str(tmp_path)] = 0
        result = cls().build_unified_graph()
        assert not result.get("partial")
        return result["nodes"][0]

    first = rebuild()
    assert first["label"] == "Portable title" and first["color"] == "#123456"
    cfg.colors = {"node_types": {"page": {"bg": "#654321"}}}
    assert rebuild()["color"] == "#654321"
    cfg.app = {"type_property": "custom_kind"}
    assert rebuild()["kind"] == "contact"
    sidecar = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages" / "one.json"
    sidecar.parent.mkdir(parents=True)
    sidecar.write_text('{"metadata":{"title":"Managed title"}}')
    assert rebuild()["label"] == "Managed title"
    sidecar.unlink()
    assert rebuild()["label"] == "Portable title"
    assert page.stat().st_mtime == mtime


@pytest.mark.parametrize("failure", ["invalid-json", "read-error"])
def test_sidecar_read_failure_recovers_without_a_stat_change(monkeypatch, tmp_path, failure):
    from backend.domains.graph import nodes
    from backend.services import llm_wiki_storage

    cfg = Config(paths={"GNOSI_CONFIG": tmp_path / ".gnosi"}, colors={}, app={})
    sidecar = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages" / "one.json"
    sidecar.parent.mkdir(parents=True)
    sidecar.write_text('{"metadata":{"title":"Managed title"}}')
    page = tmp_path / "one.md"
    page.write_text('---\nid: one\ntitle: Portable title\n---\nBody')
    monkeypatch.setattr(cache_inputs, "read_contact_nodes", lambda _: [])
    before = cache_inputs.capture_graph_inputs(cfg, [], {})
    # The failure concerns a file without any previously successful strict read.
    cache_inputs._MANAGED_STATE_CACHE.clear()
    stat = sidecar.stat()
    read_text = Path.read_text
    mode = [failure]

    def read_state(path, *args, **kwargs):
        if path == sidecar:
            if mode[0] == "invalid-json":
                return '{"metadata":'
            if mode[0] == "read-error":
                raise OSError("Synthetic transient read failure")
        return read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_state)
    with pytest.raises((ValueError, OSError)):
        cache_inputs.capture_graph_inputs(cfg, [], {})
    assert cache_inputs._MANAGED_STATE_CACHE == {}
    assert sidecar.stat() == stat
    mode[0] = "recovered"
    recovered = cache_inputs.capture_graph_inputs(cfg, [], {})
    assert recovered.revision == before.revision
    # A prior permissive read may already have cached {} under this same stat.
    monkeypatch.setattr(llm_wiki_storage, "_PAGE_STATE_CACHE", {
        str(sidecar): (stat.st_mtime_ns, stat.st_size, {}),
    })
    data = nodes.load_page_data(page, page.name, page.stat().st_mtime, cfg, {}, recovered.managed_states)
    assert data["title"] == "Managed title"
    assert sidecar.stat() == stat


def test_strict_sidecar_snapshots_read_only_changes_and_do_not_share_mutable_metadata(monkeypatch, tmp_path):
    cfg = Config(paths={"GNOSI_CONFIG": tmp_path / ".gnosi"}, colors={}, app={})
    states = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages"
    states.mkdir(parents=True)
    one, two = states / "one.json", states / "two.json"
    one.write_text('{"metadata":{"title":"AAA","values":["original"]}}')
    two.write_text('{"metadata":{"title":"Two"}}')
    reads = []
    read_text = Path.read_text

    def record_read(path, *args, **kwargs):
        reads.append(path)
        return read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", record_read)
    first_revision, first = cache_inputs.capture_managed_state(cfg)
    first["one"]["values"].append("changed by consumer")
    repeated_revision, repeated = cache_inputs.capture_managed_state(cfg)
    assert repeated_revision == first_revision and repeated["one"]["values"] == ["original"]
    assert len(reads) == 2
    stat = one.stat()
    one.write_text('{"metadata":{"title":"BBB","values":["original"]}}')
    os.utime(one, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    changed_stat = one.stat()
    assert changed_stat.st_mtime_ns == stat.st_mtime_ns and changed_stat.st_size == stat.st_size
    assert changed_stat.st_ctime_ns != stat.st_ctime_ns
    changed_revision, changed = cache_inputs.capture_managed_state(cfg)
    assert changed_revision != first_revision and changed["one"]["title"] == "BBB"
    assert reads.count(one) == 2 and reads.count(two) == 1
    two.unlink()
    assert "two" not in cache_inputs.capture_managed_state(cfg)[1]
    assert (str(cfg.paths["GNOSI_CONFIG"]), "two.json") not in cache_inputs._MANAGED_STATE_CACHE


def test_strict_sidecar_cache_is_bounded_and_separate_for_each_vault(monkeypatch, tmp_path):
    monkeypatch.setattr(cache_inputs, "_MANAGED_CACHE_LIMIT", 2)
    configs = [Config(paths={"GNOSI_CONFIG": tmp_path / label}, colors={}, app={}) for label in ("a", "b")]
    for cfg, title in zip(configs, ("A", "B"), strict=True):
        states = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages"
        states.mkdir(parents=True)
        (states / "shared.json").write_text(json.dumps({"metadata": {"title": title}}))
        assert cache_inputs.capture_managed_state(cfg)[1]["shared"]["title"] == title
    assert len(cache_inputs._MANAGED_STATE_CACHE) == 2
    extra = configs[0].paths["GNOSI_CONFIG"] / "llm_wiki" / "pages" / "extra.json"
    extra.write_text('{"metadata":{"title":"Extra"}}')
    cache_inputs.capture_managed_state(configs[0])
    assert len(cache_inputs._MANAGED_STATE_CACHE) == 2
    assert cache_inputs.capture_managed_state(configs[1])[1]["shared"]["title"] == "B"
    assert len(cache_inputs._MANAGED_STATE_CACHE) == 2


@pytest.fixture
def synthetic_sidecar_scan(monkeypatch):
    """Exercise scan order and strict signatures without reading actual files."""
    configs = [Config(paths={"GNOSI_CONFIG": Path("/synthetic-graph-inputs") / label},
                      colors={}, app={}) for label in ("a", "b")]
    directories = {cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages" for cfg in configs}
    files = {}
    reads = []
    read_text, path_stat, scandir = Path.read_text, Path.stat, os.scandir

    def put(cfg, name, title):
        path = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages" / name
        raw = json.dumps({"metadata": {"title": title, "values": ["original"]}})
        previous = files.get(path)
        stat = SimpleNamespace(
            st_dev=1, st_ino=previous[0].st_ino if previous else len(files) + 1,
            st_mode=0o100600, st_mtime_ns=1,
            st_ctime_ns=previous[0].st_ctime_ns + 1 if previous else 1,
            st_size=len(raw), st_blocks=8,
        )
        files[path] = (stat, raw)
        return path

    def record_read(path, *args, **kwargs):
        if path.parent not in directories:
            return read_text(path, *args, **kwargs)
        reads.append((path.parent.parent.parent.name, path.name))
        return files[path][1]

    def stat(path, *args, **kwargs):
        return files[path][0] if path.parent in directories else path_stat(path, *args, **kwargs)

    class SyntheticEntries:
        def __init__(self, values):
            self._iterator = iter(values)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def __iter__(self):
            return self

        def __next__(self):
            return next(self._iterator)

    def entries(directory):
        if directory not in directories:
            return scandir(directory)
        return SyntheticEntries([
            SimpleNamespace(name=path.name, path=str(path), stat=lambda value=value: value[0])
            for path, value in files.items() if path.parent == directory
        ])

    monkeypatch.setattr(cache_inputs, "_MANAGED_CACHE_LIMIT", 2)
    monkeypatch.setattr(Path, "read_text", record_read)
    monkeypatch.setattr(Path, "stat", stat)
    monkeypatch.setattr(cache_inputs.os, "scandir", entries)
    return SimpleNamespace(configs=configs, put=put, files=files, reads=reads)


@pytest.mark.parametrize("count, repeated_reads", [(2, []), (3, [("a", "c.json")])])
def test_sequential_sidecar_scan_keeps_its_hits_when_larger_than_cache(
    synthetic_sidecar_scan, count, repeated_reads,
):
    state = synthetic_sidecar_scan
    cfg = state.configs[0]
    for name in ("a.json", "b.json", "c.json")[:count]:
        state.put(cfg, name, name)
    revision, first = cache_inputs.capture_managed_state(cfg)
    assert len(state.reads) == count
    first["a"]["values"].append("consumer mutation")
    state.reads.clear()
    repeated_revision, repeated = cache_inputs.capture_managed_state(cfg)
    assert repeated_revision == revision
    assert repeated["a"]["values"] == ["original"]
    assert state.reads == repeated_reads
    assert len(cache_inputs._MANAGED_STATE_CACHE) == 2
    assert [key[1] for key in cache_inputs._MANAGED_STATE_CACHE] == ["a.json", "b.json"]


def test_full_sidecar_cache_admits_other_vault_without_sharing_same_named_metadata(synthetic_sidecar_scan):
    state = synthetic_sidecar_scan
    first, second = state.configs
    for cfg, title in ((first, "First"), (second, "Second")):
        state.put(cfg, "a.json", title)
        state.put(cfg, "b.json", title)
    cache_inputs.capture_managed_state(first)
    cache_inputs.capture_managed_state(second)
    assert {key[0] for key in cache_inputs._MANAGED_STATE_CACHE} == {str(second.paths["GNOSI_CONFIG"])}
    state.reads.clear()
    assert cache_inputs.capture_managed_state(second)[1]["a"]["title"] == "Second"
    assert state.reads == []
    assert cache_inputs.capture_managed_state(first)[1]["a"]["title"] == "First"
    assert state.reads == [("a", "a.json"), ("a", "b.json")]
    assert len(cache_inputs._MANAGED_STATE_CACHE) == 2
    assert {key[0] for key in cache_inputs._MANAGED_STATE_CACHE} == {str(first.paths["GNOSI_CONFIG"])}


def test_full_sidecar_cache_rereads_changes_and_recovers_space_after_deletion(synthetic_sidecar_scan):
    state = synthetic_sidecar_scan
    cfg = state.configs[0]
    paths = [state.put(cfg, name, "AAA") for name in ("a.json", "b.json", "c.json")]
    original_revision, _ = cache_inputs.capture_managed_state(cfg)
    state.reads.clear()
    state.put(cfg, "a.json", "BBB")  # Same size and mtime; ctime changes.
    changed_revision, changed = cache_inputs.capture_managed_state(cfg)
    assert changed_revision != original_revision and changed["a"]["title"] == "BBB"
    assert state.reads == [("a", "a.json"), ("a", "c.json")]
    del state.files[paths[1]]
    deleted_revision, remaining = cache_inputs.capture_managed_state(cfg)
    assert deleted_revision != changed_revision and set(remaining) == {"a", "c"}
    assert (str(cfg.paths["GNOSI_CONFIG"]), "b.json") not in cache_inputs._MANAGED_STATE_CACHE
    # The deleted entry is pruned after the scan, admitting the remaining file
    # on the next pass. Subsequent passes can reuse both strict reads.
    cache_inputs.capture_managed_state(cfg)
    state.reads.clear()
    cache_inputs.capture_managed_state(cfg)
    assert state.reads == [] and len(cache_inputs._MANAGED_STATE_CACHE) == 2


def test_sidecar_changed_during_read_is_not_memorized(monkeypatch, tmp_path):
    cfg = Config(paths={"GNOSI_CONFIG": tmp_path / ".gnosi"}, colors={}, app={})
    sidecar = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages" / "one.json"
    sidecar.parent.mkdir(parents=True)
    sidecar.write_text('{"metadata":{"title":"Original"}}')
    read_text = Path.read_text

    def replace_during_read(path, *args, **kwargs):
        raw = read_text(path, *args, **kwargs)
        path.write_text('{"metadata":{"title":"Replacement"}}')
        return raw

    monkeypatch.setattr(Path, "read_text", replace_during_read)
    with pytest.raises(OSError):
        cache_inputs.capture_managed_state(cfg)
    assert cache_inputs._MANAGED_STATE_CACHE == {}
    monkeypatch.setattr(Path, "read_text", read_text)
    assert cache_inputs.capture_managed_state(cfg)[1]["one"]["title"] == "Replacement"


def test_oversized_valid_sidecars_are_used_without_retaining_them(monkeypatch, tmp_path):
    monkeypatch.setattr(cache_inputs, "_MANAGED_CACHE_MAX_SOURCE_SIZE", 1)
    cfg = Config(paths={"GNOSI_CONFIG": tmp_path / ".gnosi"}, colors={}, app={})
    sidecar = cfg.paths["GNOSI_CONFIG"] / "llm_wiki" / "pages" / "one.json"
    sidecar.parent.mkdir(parents=True)
    sidecar.write_text('{"metadata":{"title":"Available"}}')
    assert cache_inputs.capture_managed_state(cfg)[1]["one"]["title"] == "Available"
    assert cache_inputs._MANAGED_STATE_CACHE == {}


def test_contextual_vault_scopes_registry_sidecars_and_suggestions(monkeypatch, tmp_path):
    from backend.services.context_vars import active_vault_path

    cls = service.GraphService
    vault_a, vault_b = tmp_path / "a", tmp_path / "b"
    for vault, label in ((vault_a, "A"), (vault_b, "B")):
        states = vault / ".gnosi" / "llm_wiki" / "pages"
        states.mkdir(parents=True)
        (states / "shared.json").write_text(json.dumps({"metadata": {"title": label}}))
        (vault / "shared.md").write_text(
            '---\nid: shared\ntitle: Portable\ntable_id: table\n'
            'RelationA: "[[Target|target]]"\nRelationB: "[[Target|target]]"\n---\nBody'
        )
        for node_id in ("target", "third"):
            (vault / f"{node_id}.md").write_text(f'---\nid: {node_id}\ntitle: {node_id}\n---\nBody')
        (vault / "BD").mkdir()
        (vault / "BD" / "vault_db_registry.json").write_text(json.dumps({"tables": [{
            "id": "table", "properties": [{"name": f"Relation{label}", "type": "relation"}],
        }]}))
        (vault / ".gnosi" / "llm_wiki_suggestions.json").write_text(json.dumps({"suggestions": [{
            "id": "proposal", "member_ids": ["shared", "third"], "question": label,
        }]}))
    cfg = Config(paths={"VAULT": vault_a, "GNOSI_CONFIG": vault_a / ".gnosi",
                        "REGISTRY": vault_a / "BD" / "vault_db_registry.json"}, colors={}, app={})
    monkeypatch.setattr(service, "load_params", lambda **_: cfg)
    monkeypatch.setattr(service, "indexed_markdown_files", lambda vault: [
        (vault / f"{node_id}.md", (vault / f"{node_id}.md").stat().st_mtime)
        for node_id in ("shared", "target", "third")
    ])
    monkeypatch.setattr(cache_inputs, "read_contact_nodes", lambda _: [])
    for name in ("_graph_cache", "_last_graph_time", "_graph_input_revisions", "_NODE_SEMANTIC_REVISION", "_NODE_DATA_CACHE"):
        monkeypatch.setattr(cls, name, {})
    monkeypatch.setattr(cls, "_NODE_CACHE_LOADED", {str(vault_a), str(vault_b)})
    monkeypatch.setattr(cls, "_NODE_CACHE_DIRTY", set())
    monkeypatch.setattr(cls, "_save_node_cache", lambda path: cls._NODE_CACHE_DIRTY.discard(str(path)))

    def build(vault):
        token = active_vault_path.set(vault)
        try:
            result = cls().build_unified_graph()
            assert not result.get("partial")
            return result
        finally:
            active_vault_path.reset(token)

    graph_a = build(vault_a)
    graph_b = build(vault_b)
    shared = next(node for node in graph_b["nodes"] if node["id"] == "shared")
    assert shared["label"] == "B"
    assert shared["metadata"]["RelationB"] == "target"
    assert shared["metadata"]["RelationA"] == "[[Target|target]]"
    assert [edge["reason"] for edge in graph_b["edges"] if edge["kind"] == "suggestion"] == ["B"]
    assert cfg.paths["VAULT"] == vault_a and cfg.paths["GNOSI_CONFIG"] == vault_a / ".gnosi"
    (vault_b / ".gnosi" / "llm_wiki" / "pages" / "shared.json").write_text(
        '{"metadata":{"title":"B updated"}}'
    )
    cls._last_graph_time[str(vault_b)] = 0
    updated_b = build(vault_b)
    assert next(node for node in updated_b["nodes"] if node["id"] == "shared")["label"] == "B updated"
    assert build(vault_a) is graph_a
    assert next(node for node in graph_a["nodes"] if node["id"] == "shared")["label"] == "A"
