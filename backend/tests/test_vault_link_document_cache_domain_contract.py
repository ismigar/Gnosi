"""Behavior and architecture contracts for persistent Vault document caches."""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager, nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.domains.vault.links import document_cache
from backend.utils.safe_io import safe_write_json


class _CachePersistence:
    """Own real workers, holding each save until the test releases it."""

    def __init__(self) -> None:
        self.body_state = document_cache._PersistState()
        self.parsed_state = document_cache._PersistState()
        self.threads: list[threading.Thread] = []
        self._releases: list[threading.Event] = []

    def thread(self, *, target: Callable[[], None], daemon: bool, name: str) -> threading.Thread:
        release = threading.Event()

        def run() -> None:
            release.wait()
            target()

        worker = threading.Thread(target=run, daemon=daemon, name=name)
        self._releases.append(release)
        self.threads.append(worker)
        return worker

    def drain(self) -> None:
        # Release every worker before joining any, including during failed-test cleanup.
        for release in self._releases:
            release.set()
        for worker in self.threads:
            worker.join(timeout=5)
        assert not [worker.name for worker in self.threads if worker.is_alive()]
        assert not self.body_state.pending
        assert not self.parsed_state.pending


@contextmanager
def _isolated_cache_persistence() -> Iterator[_CachePersistence]:
    persistence = _CachePersistence()
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(document_cache, "_body_persist_state", persistence.body_state)
        patch.setattr(document_cache, "_parsed_persist_state", persistence.parsed_state)
        # Replace only this module's thread factory, never the shared threading module.
        patch.setattr(document_cache, "threading", SimpleNamespace(Thread=persistence.thread))
        try:
            yield persistence
        finally:
            # Keep the isolated states installed until every owned save has finished.
            persistence.drain()


@pytest.fixture
def cache_persistence() -> Iterator[_CachePersistence]:
    with _isolated_cache_persistence() as persistence:
        yield persistence


def _dependencies(
    tmp_path: Path,
    body_cache: document_cache.BodyCache,
    parsed_cache: document_cache.ParsedDocumentCache,
    parse_calls: list[str],
) -> document_cache.DocumentCacheDependencies:
    def write_json(path: Path, payload: object) -> None:
        safe_write_json(path, payload, indent=None, ensure_ascii=False)

    def parse_frontmatter(raw: str, path: Path) -> tuple[document_cache.Metadata, str]:
        parse_calls.append(path.name)
        return {"title": path.stem}, raw

    return document_cache.DocumentCacheDependencies(
        body_cache=body_cache,
        body_lock=threading.Lock(),
        parsed_cache=parsed_cache,
        parsed_lock=threading.Lock(),
        page_index_cache_path=lambda: tmp_path / "cache" / "page-index.json",
        data_dir=lambda: tmp_path,
        write_json=write_json,
        parse_frontmatter=parse_frontmatter,
        body_persist_debounce=0.0,
        parsed_persist_debounce=0.0,
        logger=logging.getLogger(__name__),
    )


def test_cache_fixture_writer_keeps_previous_json_until_atomic_replace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dependencies = _dependencies(tmp_path, {}, {}, [])
    path = document_cache.cache_path("body", dependencies)
    path.parent.mkdir(parents=True)
    previous = {"Page.md": {"mtime_ns": 1, "body": "first"}}
    updated = {"Page.md": {"mtime_ns": 2, "body": "second — actualització"}}
    dependencies.write_json(path, previous)
    snapshots: list[object] = []
    replacements: list[object] = []
    replace = os.replace

    def observe_replace(source: str, destination: Path) -> None:
        assert destination == path
        assert Path(source).parent == path.parent
        snapshots.append(json.loads(path.read_text(encoding="utf-8")))
        replacements.append(json.loads(Path(source).read_text(encoding="utf-8")))
        replace(source, destination)

    monkeypatch.setattr(os, "replace", observe_replace)
    dependencies.write_json(path, updated)

    assert snapshots == [previous]
    assert replacements == [updated]
    assert json.loads(path.read_text(encoding="utf-8")) == updated
    assert list(path.parent.iterdir()) == [path]


def test_body_cache_round_trip_and_mtime_invalidation(
    tmp_path: Path, cache_persistence: _CachePersistence
) -> None:
    source = tmp_path / "Page.md"
    source.write_text("first", encoding="utf-8")
    body_cache: document_cache.BodyCache = {}
    parsed_cache: document_cache.ParsedDocumentCache = {}
    dependencies = _dependencies(tmp_path, body_cache, parsed_cache, [])

    assert document_cache.body_for_path(source, dependencies) == "first"
    assert document_cache.body_for_path(source, dependencies) == "first"

    first_mtime = source.stat().st_mtime_ns
    source.write_text("second", encoding="utf-8")
    os.utime(source, ns=(first_mtime + 1_000_000_000, first_mtime + 1_000_000_000))
    assert document_cache.body_for_path(source, dependencies) == "second"

    path = document_cache.cache_path("body", dependencies)
    assert [worker.name for worker in cache_persistence.threads] == ["body-cache-persist"]
    assert cache_persistence.threads[0].is_alive()
    assert cache_persistence.body_state.pending
    assert not path.exists()
    cache_persistence.drain()
    expected = {str(source): {"mtime_ns": source.stat().st_mtime_ns, "body": "second"}}
    assert json.loads(path.read_text(encoding="utf-8")) == expected

    document_cache.save_body_cache(dependencies)
    body_cache.clear()
    assert document_cache.load_body_cache(dependencies) is True
    assert body_cache == {str(source): (source.stat().st_mtime_ns, "second")}


def test_parsed_cache_reuses_parse_and_invalidates_after_rewrite(
    tmp_path: Path, cache_persistence: _CachePersistence
) -> None:
    source = tmp_path / "Document.md"
    source.write_text("original", encoding="utf-8")
    parse_calls: list[str] = []
    dependencies = _dependencies(tmp_path, {}, {}, parse_calls)

    assert document_cache.parsed_document(source, dependencies) == (
        {"title": "Document"},
        "original",
    )
    assert document_cache.parsed_document(source, dependencies) == (
        {"title": "Document"},
        "original",
    )
    assert parse_calls == ["Document.md"]

    first_mtime = source.stat().st_mtime_ns
    source.write_text("updated", encoding="utf-8")
    os.utime(source, ns=(first_mtime + 1_000_000_000, first_mtime + 1_000_000_000))
    assert document_cache.parsed_document(source, dependencies) == (
        {"title": "Document"},
        "updated",
    )
    assert parse_calls == ["Document.md", "Document.md"]

    path = document_cache.cache_path("parsed_doc", dependencies)
    assert [worker.name for worker in cache_persistence.threads] == [
        "body-cache-persist", "parsed-doc-cache-persist"
    ]
    assert all(worker.is_alive() for worker in cache_persistence.threads)
    assert cache_persistence.body_state.pending
    assert cache_persistence.parsed_state.pending
    assert not path.exists()
    cache_persistence.drain()
    expected = {
        str(source): {
            "mtime_ns": source.stat().st_mtime_ns,
            "metadata": {"title": "Document"},
            "body": "updated",
        }
    }
    assert json.loads(path.read_text(encoding="utf-8")) == expected

    document_cache.save_parsed_cache(dependencies)
    dependencies.parsed_cache.clear()
    assert document_cache.load_parsed_cache(dependencies) is True
    assert dependencies.parsed_cache == {
        str(source): (source.stat().st_mtime_ns, {"title": "Document"}, "updated")
    }
    assert document_cache.parsed_document(source, dependencies) == (
        {"title": "Document"}, "updated"
    )
    assert parse_calls == ["Document.md", "Document.md"]


@pytest.mark.parametrize("failed_test", [False, True], ids=["normal-exit", "failed-test"])
def test_cache_fixture_isolates_pending_state_and_joins_writers_on_exit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failed_test: bool
) -> None:
    # A prior fixture's pending save must neither suppress ours nor have its flag reset.
    previous_body = document_cache._PersistState(pending=True)
    previous_parsed = document_cache._PersistState(pending=True)
    monkeypatch.setattr(document_cache, "_body_persist_state", previous_body)
    monkeypatch.setattr(document_cache, "_parsed_persist_state", previous_parsed)
    source = tmp_path / "Pending.md"
    source.write_text("pending", encoding="utf-8")
    dependencies = _dependencies(tmp_path, {}, {}, [])

    outcome = (
        pytest.raises(AssertionError, match="synthetic test failure")
        if failed_test else nullcontext()
    )
    with outcome:
        with _isolated_cache_persistence() as persistence:
            assert document_cache.parsed_document(source, dependencies) == (
                {"title": "Pending"}, "pending"
            )
            assert len(persistence.threads) == 2
            assert all(worker.is_alive() for worker in persistence.threads)
            assert persistence.body_state.pending
            assert persistence.parsed_state.pending
            if failed_test:
                raise AssertionError("synthetic test failure")

    assert all(not worker.is_alive() for worker in persistence.threads)
    assert not persistence.body_state.pending
    assert not persistence.parsed_state.pending
    assert document_cache._body_persist_state is previous_body
    assert document_cache._parsed_persist_state is previous_parsed
    assert previous_body.pending and previous_parsed.pending
    dependencies.body_cache.clear()
    dependencies.parsed_cache.clear()
    assert document_cache.load_body_cache(dependencies) is True
    assert document_cache.load_parsed_cache(dependencies) is True
    assert dependencies.body_cache == {str(source): (source.stat().st_mtime_ns, "pending")}
    assert dependencies.parsed_cache == {
        str(source): (source.stat().st_mtime_ns, {"title": "Pending"}, "pending")
    }


def test_document_cache_domain_does_not_import_http_facade() -> None:
    source_path = Path(document_cache.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
