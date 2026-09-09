"""Media-root resolution and lazy folder-tree traversal."""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable, Iterator, Mapping
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Protocol

from backend.domains.media.types import MediaRootDefinition, MediaRootItem, TreeNode


_resolved_roots: ContextVar[dict[tuple[Path, str], Path | None] | None] = ContextVar(
    "media_read_roots", default=None
)

# Shared across requests: concurrent galleries cannot each start four scans.
_TREE_SCAN_CONCURRENCY = 4
_TREE_SCAN_SLOTS = threading.BoundedSemaphore(_TREE_SCAN_CONCURRENCY)
_TREE_EXECUTOR = ThreadPoolExecutor(max_workers=_TREE_SCAN_CONCURRENCY, thread_name_prefix="media-tree")
_TreeKey = tuple[str, str, frozenset[str]]
_TREE_INFLIGHT: dict[_TreeKey, Future[list[TreeNode]]] = {}
_TREE_INFLIGHT_LOCK = threading.Lock()


@contextmanager
def reuse_root_resolution() -> Iterator[None]:
    """Resolve each vault/root once during one media batch, never across requests."""
    token = _resolved_roots.set({})
    try:
        yield
    finally:
        _resolved_roots.reset(token)


class RootService(Protocol):
    """Facade capabilities required by root and tree operations."""

    @property
    def media_dir(self) -> Path: ...

    def _root_dir(self, root: str = "images") -> Path | None: ...

    def _resolve_album_dir(self, album: str | None, root: str = "images") -> Path | None: ...


def root_dir(
    root: str,
    *,
    active_vault_path: Callable[[], Path],
    resolve_library: Callable[[Path], Path],
    logger: logging.Logger,
) -> Path | None:
    """Resolve a configured root without creating optional directories."""
    base = active_vault_path()
    cache = _resolved_roots.get()
    key = (base, root)
    if cache is not None and key in cache:
        return cache[key]
    directory = _resolve_root(base, root, resolve_library, logger)
    if cache is not None:
        cache[key] = directory
    return directory


def _resolve_root(
    base: Path,
    root: str,
    resolve_library: Callable[[Path], Path],
    logger: logging.Logger,
) -> Path | None:
    if root == "images":
        directory = base / "Images"
        try:
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "General").mkdir(parents=True, exist_ok=True)
        except Exception as error:
            logger.warning(f"Could not create the media directory at {directory}: {error}")
        return directory
    if root == "assets":
        return base / "Assets"
    if root == "library":
        return resolve_library(base)
    if root == "vault":
        return base
    logger.warning(f"Root desconegut: {root!r}")
    return None


def get_roots(
    service: RootService,
    media_roots: Mapping[str, MediaRootDefinition],
) -> list[MediaRootItem]:
    """Return configured roots in declaration order with availability."""
    items: list[MediaRootItem] = []
    for key, metadata in media_roots.items():
        directory = service._root_dir(key)
        items.append(
            {
                "key": key,
                "label": metadata["label"],
                "url_prefix": metadata["url_prefix"],
                "available": bool(directory and directory.exists()),
            }
        )
    return items


def resolve_album_dir(
    service: RootService,
    album: str | None,
    root: str,
    logger: logging.Logger,
) -> Path | None:
    """Resolve a contained album path beneath one media root."""
    root_directory = service._root_dir(root)
    if root_directory is None or not root_directory.exists():
        return None
    if not album:
        return root_directory
    candidate = (root_directory / album).resolve()
    try:
        candidate.relative_to(root_directory.resolve())
    except ValueError:
        logger.warning(f"Album outside root {root!r}: {album!r}")
        return None
    return candidate


def get_albums(service: RootService) -> list[str]:
    """Return the immediate folders under the historical Images root."""
    media_directory = service.media_dir
    if not media_directory.exists():
        return []
    return [directory.name for directory in media_directory.iterdir() if directory.is_dir()]


def _has_visible_child(entry: os.DirEntry[str], skip_dirs: set[str]) -> bool:
    try:
        with _TREE_SCAN_SLOTS, os.scandir(entry.path) as children:
            for child in children:
                if child.name.startswith(".") or child.name in skip_dirs:
                    continue
                if child.is_dir(follow_symlinks=False):
                    return True
    except OSError:
        pass
    return False


def _visible_directory(entry: os.DirEntry[str], skip_dirs: set[str]) -> bool:
    if entry.name.startswith(".") or entry.name in skip_dirs:
        return False
    try:
        return entry.is_dir(follow_symlinks=False)
    except OSError:
        return False


def _tree_node(
    entry: os.DirEntry[str],
    parent_path: str | None,
    skip_dirs: set[str],
) -> TreeNode | None:
    if not _visible_directory(entry, skip_dirs):
        return None
    relative = (Path(parent_path) / entry.name).as_posix() if parent_path else entry.name
    return {
        "name": entry.name,
        "path": relative,
        "has_children": _has_visible_child(entry, skip_dirs),
    }


def _read_tree_node(
    target: Path,
    path: str | None,
    skip_dirs: set[str],
    logger: logging.Logger,
) -> list[TreeNode]:
    try:
        with _TREE_SCAN_SLOTS, os.scandir(target) as entries:
            candidates = [entry for entry in entries if _visible_directory(entry, skip_dirs)]
    except OSError as error:
        logger.warning(f"scandir tree {target}: {error}")
        return []
    remaining = iter(enumerate(candidates))
    pending: dict[Future[TreeNode | None], int] = {}
    results: dict[int, TreeNode] = {}

    def submit_next() -> None:
        candidate = next(remaining, None)
        if candidate is not None:
            index, entry = candidate
            pending[_TREE_EXECUTOR.submit(_tree_node, entry, path, skip_dirs)] = index

    try:
        for _ in range(_TREE_SCAN_CONCURRENCY):
            submit_next()
        while pending:
            completed, _unfinished = wait(pending, return_when=FIRST_COMPLETED)
            for future in completed:
                index = pending.pop(future)
                node = future.result()
                if node is not None:
                    results[index] = node
                submit_next()
    finally:
        for future in pending:
            future.cancel()
    # Keep scandir order for equal case-insensitive names, as before.
    nodes = [results[index] for index in sorted(results)]
    nodes.sort(key=lambda node: node["name"].lower())
    return nodes


def get_tree_node(
    service: RootService,
    path: str | None,
    root: str,
    vault_skip_dirs: set[str],
    logger: logging.Logger,
) -> list[TreeNode]:
    """Share only an in-flight read; later requests always read current folders."""
    target = service._resolve_album_dir(path, root=root)
    if target is None or not target.exists():
        return []
    skip_dirs = vault_skip_dirs if root == "vault" else set()
    key = (str(target), path or "", frozenset(skip_dirs))
    with _TREE_INFLIGHT_LOCK:
        future = _TREE_INFLIGHT.get(key)
        owner = future is None
        if future is None:
            future = Future()
            _TREE_INFLIGHT[key] = future
    if owner:
        try:
            future.set_result(_read_tree_node(target, path, skip_dirs, logger))
        except BaseException as error:
            future.set_exception(error)
            raise
        finally:
            with _TREE_INFLIGHT_LOCK:
                if _TREE_INFLIGHT.get(key) is future:
                    _TREE_INFLIGHT.pop(key, None)
    return [node.copy() for node in future.result()]
