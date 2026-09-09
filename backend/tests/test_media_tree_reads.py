"""Media tree reads share concurrent work without retaining directory state."""

from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import BoundedSemaphore, Event, Lock
from types import SimpleNamespace
import logging

import pytest

from backend.domains.media import roots

LOG = logging.getLogger(__name__)


@pytest.fixture(autouse=True)
def isolated_tree_reads(monkeypatch):
    monkeypatch.setattr(roots, "_TREE_INFLIGHT", {})
    monkeypatch.setattr(roots, "_TREE_SCAN_SLOTS", BoundedSemaphore(4))
    with ThreadPoolExecutor(max_workers=4) as executor:
        monkeypatch.setattr(roots, "_TREE_EXECUTOR", executor)
        yield


def _service(directory):
    return SimpleNamespace(_resolve_album_dir=lambda *_, **__: directory)


def test_concurrent_same_tree_shares_only_the_active_read(monkeypatch, tmp_path):
    entered, joined, release = Event(), Event(), Event()
    calls = []

    class ObservedFuture(Future):
        def result(self, timeout=None):
            joined.set()
            return super().result(timeout)

    def read(*_):
        calls.append(1)
        entered.set()
        assert release.wait(timeout=5)
        return [{"name": "Album", "path": "Album", "has_children": False}]

    monkeypatch.setattr(roots, "Future", ObservedFuture)
    monkeypatch.setattr(roots, "_read_tree_node", read)
    service = _service(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as callers:
        first = callers.submit(roots.get_tree_node, service, None, "images", set(), LOG)
        assert entered.wait(timeout=5)
        second = callers.submit(roots.get_tree_node, service, None, "images", set(), LOG)
        try:
            assert joined.wait(timeout=5)
        finally:
            release.set()
        result_one, result_two = first.result(timeout=5), second.result(timeout=5)
    assert len(calls) == 1 and roots._TREE_INFLIGHT == {}
    result_one[0]["name"] = "Changed by caller"
    assert result_two[0]["name"] == "Album"
    assert roots.get_tree_node(service, None, "images", set(), LOG) == result_two
    assert len(calls) == 2


def test_directory_scan_parallelism_is_bounded_across_different_vaults(monkeypatch, tmp_path):
    targets = [tmp_path / "a", tmp_path / "b"]
    for target in targets:
        for index in range(4):
            (target / f"{target.name}{index}" / "Child").mkdir(parents=True)
    original = roots.os.scandir
    entered, release = Event(), Event()
    guard = Lock()
    active = 0
    maximum = 0

    @contextmanager
    def tracked_scan(path):
        nonlocal active, maximum
        with guard:
            active += 1
            maximum = max(maximum, active)
            if active == 4:
                entered.set()
        try:
            if Path(path).parent in targets:
                assert release.wait(timeout=5)
            with original(path) as entries:
                yield entries
        finally:
            with guard:
                active -= 1

    monkeypatch.setattr(roots.os, "scandir", tracked_scan)
    with ThreadPoolExecutor(max_workers=2) as callers:
        futures = [callers.submit(roots.get_tree_node, _service(target), None, "images", set(), LOG)
                   for target in targets]
        try:
            assert entered.wait(timeout=5)
            with guard:
                assert maximum == 4
        finally:
            release.set()
        results = [future.result(timeout=5) for future in futures]
    assert maximum == 4 and active == 0
    for target, nodes in zip(targets, results, strict=True):
        assert [node["name"] for node in nodes] == [f"{target.name}{index}" for index in range(4)]
        assert all(node["has_children"] for node in nodes)


@pytest.mark.parametrize("failure_at", ["parent", "child"])
def test_failed_directory_reads_are_not_reused(monkeypatch, tmp_path, failure_at):
    album = tmp_path / "Album"
    (album / "Child").mkdir(parents=True)
    original = roots.os.scandir
    failing = True

    def scan(path):
        if failing and Path(path) == (tmp_path if failure_at == "parent" else album):
            raise OSError("Synthetic unavailable directory")
        return original(path)

    monkeypatch.setattr(roots.os, "scandir", scan)
    service = _service(tmp_path)
    unavailable = roots.get_tree_node(service, None, "images", set(), LOG)
    assert unavailable == ([] if failure_at == "parent" else [
        {"name": "Album", "path": "Album", "has_children": False},
    ])
    assert roots._TREE_INFLIGHT == {}
    failing = False
    assert roots.get_tree_node(service, None, "images", set(), LOG) == [
        {"name": "Album", "path": "Album", "has_children": True},
    ]


def test_parallel_tree_keeps_filters_order_and_album_containment(tmp_path):
    vault = tmp_path / "vault"
    outside = tmp_path / "outside"
    outside.mkdir()
    for name in ("Zulu", "alpha", ".hidden", "BD"):
        (vault / name).mkdir(parents=True)
    (vault / "Zulu" / "Child").mkdir()
    (vault / "alpha" / ".hidden-child").mkdir()
    (vault / "file.jpg").write_text("fixture")
    (vault / "outside-link").symlink_to(outside, target_is_directory=True)
    service = SimpleNamespace(_root_dir=lambda _: vault)
    service._resolve_album_dir = lambda path, root: roots.resolve_album_dir(service, path, root, LOG)
    assert roots.get_tree_node(service, None, "vault", {"BD"}, LOG) == [
        {"name": "alpha", "path": "alpha", "has_children": False},
        {"name": "Zulu", "path": "Zulu", "has_children": True},
    ]
    assert roots.get_tree_node(service, "../outside", "vault", {"BD"}, LOG) == []
    assert roots.get_tree_node(service, "outside-link", "vault", {"BD"}, LOG) == []
