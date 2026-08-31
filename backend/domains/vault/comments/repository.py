"""Filesystem repositories for page and inline comments."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from fastapi import HTTPException

from backend.domains.vault.comments.state import page_comments_io_lock
from backend.domains.vault.registry.records import is_object_list, is_record


Comment = dict[str, object]
# Stored JSON is only checked at its root; HTTP models validate comment shapes.
PageCommentMap = dict[object, object]
InlineComments = list[object]


class JsonWriter(Protocol):
    def __call__(
        self,
        path: Path,
        data: object,
        /,
        *,
        indent: int | None = None,
        ensure_ascii: bool = True,
    ) -> None: ...


def comments_path(get_path: Callable[[str], Path]) -> Path:
    return get_path("GNOSI_CONFIG") / "page_comments.json"


def load_page_comments(resolve_path: Callable[[], Path]) -> PageCommentMap:
    with page_comments_io_lock:
        try:
            path = resolve_path()
            if not path.exists():
                return {}
            data: object = json.loads(path.read_text(encoding="utf-8"))
            if not is_record(data):
                return {}
            return data
        except Exception:
            return {}


def save_page_comments(
    resolve_path: Callable[[], Path],
    write_json: JsonWriter,
    data: PageCommentMap,
) -> None:
    with page_comments_io_lock:
        path = resolve_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json(path, data, indent=2, ensure_ascii=False)


def inline_comments_path(
    page_id: str,
    active_vault_path: Callable[[], str | Path | None],
) -> Path:
    vault = active_vault_path()
    if not vault:
        raise HTTPException(status_code=503, detail="No hi ha cap vault actiu")
    safe_id = re.sub(r"[^\w\-]", "", str(page_id))[:80]
    directory = Path(vault) / ".gnosi" / "inline_comments"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{safe_id}.json"


def load_inline_comments(resolve_path: Callable[[str], Path], page_id: str) -> InlineComments:
    path = resolve_path(page_id)
    if not path.exists():
        return []
    try:
        data: object = json.loads(path.read_text(encoding="utf-8"))
        if not is_object_list(data):
            return []
        return data
    except Exception:
        return []


__all__ = [
    "Comment",
    "InlineComments",
    "JsonWriter",
    "PageCommentMap",
    "comments_path",
    "inline_comments_path",
    "load_inline_comments",
    "load_page_comments",
    "save_page_comments",
]
