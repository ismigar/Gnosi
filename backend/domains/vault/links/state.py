"""Single process-wide owner for the reverse-link index."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from types import TracebackType
from typing import Protocol


Metadata = dict[str, object]
Backlink = dict[str, str]


class LockLike(Protocol):
    def __enter__(self) -> object: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...


@dataclass(frozen=True)
class LinkIndexView:
    outlinks_by_source: dict[str, set[str]]
    outlink_kinds_by_source: dict[str, dict[str, str]]
    backlinks_by_target: dict[str, list[Backlink]]
    backlinks_by_target_title: dict[str, list[Backlink]]
    tokens_by_source: dict[str, frozenset[str]]
    page_meta_by_id: dict[str, Metadata]
    lock: LockLike
    built: bool
    build_ts: float
    source_count: int
    rebuild_in_progress: bool
    rebuild_state_lock: LockLike


@dataclass
class LinkIndexState:
    outlinks_by_source: dict[str, set[str]] = field(default_factory=dict)
    outlink_kinds_by_source: dict[str, dict[str, str]] = field(default_factory=dict)
    backlinks_by_target: dict[str, list[Backlink]] = field(default_factory=dict)
    backlinks_by_target_title: dict[str, list[Backlink]] = field(default_factory=dict)
    tokens_by_source: dict[str, frozenset[str]] = field(default_factory=dict)
    page_meta_by_id: dict[str, Metadata] = field(default_factory=dict)
    lock: LockLike = field(default_factory=threading.RLock)
    built: bool = False
    build_ts: float = 0.0
    source_count: int = 0
    persist_pending: bool = False
    persist_lock: LockLike = field(default_factory=threading.Lock)
    rebuild_in_progress: bool = False
    rebuild_state_lock: LockLike = field(default_factory=threading.Lock)

    def view(self) -> LinkIndexView:
        return LinkIndexView(
            outlinks_by_source=self.outlinks_by_source,
            outlink_kinds_by_source=self.outlink_kinds_by_source,
            backlinks_by_target=self.backlinks_by_target,
            backlinks_by_target_title=self.backlinks_by_target_title,
            tokens_by_source=self.tokens_by_source,
            page_meta_by_id=self.page_meta_by_id,
            lock=self.lock,
            built=self.built,
            build_ts=self.build_ts,
            source_count=self.source_count,
            rebuild_in_progress=self.rebuild_in_progress,
            rebuild_state_lock=self.rebuild_state_lock,
        )


link_index_state = LinkIndexState()


__all__ = [
    "Backlink",
    "LinkIndexState",
    "LinkIndexView",
    "LockLike",
    "Metadata",
    "link_index_state",
]
