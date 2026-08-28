"""Media-root resolution and lazy folder-tree traversal."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol

from backend.domains.media.types import MediaRootDefinition, MediaRootItem, TreeNode


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
        with os.scandir(entry.path) as children:
            for child in children:
                if child.name.startswith(".") or child.name in skip_dirs:
                    continue
                if child.is_dir(follow_symlinks=False):
                    return True
    except OSError:
        pass
    return False


def _tree_node(
    entry: os.DirEntry[str],
    parent_path: str | None,
    skip_dirs: set[str],
) -> TreeNode | None:
    if entry.name.startswith(".") or entry.name in skip_dirs:
        return None
    try:
        if not entry.is_dir(follow_symlinks=False):
            return None
    except OSError:
        return None
    relative = (Path(parent_path) / entry.name).as_posix() if parent_path else entry.name
    return {
        "name": entry.name,
        "path": relative,
        "has_children": _has_visible_child(entry, skip_dirs),
    }


def get_tree_node(
    service: RootService,
    path: str | None,
    root: str,
    vault_skip_dirs: set[str],
    logger: logging.Logger,
) -> list[TreeNode]:
    """Read one level of the folder tree and report expandable nodes."""
    target = service._resolve_album_dir(path, root=root)
    if target is None or not target.exists():
        return []
    skip_dirs = vault_skip_dirs if root == "vault" else set()
    nodes: list[TreeNode] = []
    try:
        with os.scandir(target) as entries:
            for entry in entries:
                node = _tree_node(entry, path, skip_dirs)
                if node is not None:
                    nodes.append(node)
    except OSError as error:
        logger.warning(f"scandir tree {target}: {error}")
        return []
    nodes.sort(key=lambda node: node["name"].lower())
    return nodes
