"""A gallery batch reuses root work without retaining another request's roots."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest

from backend.domains.media import roots


def resolve(base: Path, root: str = "library") -> Path | None:
    return roots.root_dir(
        root,
        active_vault_path=lambda: base,
        resolve_library=lambda vault: vault / "Library",
        logger=logging.getLogger(__name__),
    )


def test_one_batch_resolves_each_vault_and_root_once(monkeypatch, tmp_path):
    calls = []
    original = roots._resolve_root

    def counted(*args):
        calls.append(args[:2])
        return original(*args)

    monkeypatch.setattr(roots, "_resolve_root", counted)
    with roots.reuse_root_resolution():
        for _ in range(50):
            assert resolve(tmp_path) == tmp_path / "Library"
        assert resolve(tmp_path, "assets") == tmp_path / "Assets"
        assert resolve(tmp_path / "second") == tmp_path / "second" / "Library"
    assert calls == [(tmp_path, "library"), (tmp_path, "assets"),
                     (tmp_path / "second", "library")]
    assert resolve(tmp_path) == tmp_path / "Library"
    assert len(calls) == 4


def test_batch_restores_outer_scope_after_failure(tmp_path):
    assert roots._resolved_roots.get() is None
    with roots.reuse_root_resolution():
        resolve(tmp_path)
        outer = roots._resolved_roots.get()
        with pytest.raises(ValueError), roots.reuse_root_resolution():
            resolve(tmp_path / "inner")
            raise ValueError("cancelled read")
        assert roots._resolved_roots.get() is outer
    assert roots._resolved_roots.get() is None


def test_parallel_batches_do_not_share_cached_roots(tmp_path):
    barrier = Barrier(2)

    def read_batch(base):
        with roots.reuse_root_resolution():
            resolve(base)
            barrier.wait(timeout=2)
            assert list(roots._resolved_roots.get()) == [(base, "library")]
        assert roots._resolved_roots.get() is None

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [executor.submit(read_batch, tmp_path / name) for name in ("one", "two")]
        for result in results:
            result.result(timeout=3)
