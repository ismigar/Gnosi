"""Single owner for the per-vault citation-key index."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from types import TracebackType
from typing import Any, Protocol


class LockLike(Protocol):
    def __enter__(self) -> object: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...


@dataclass
class CitationIndexState:
    indexes: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    sizes_at_build: dict[str, int] = field(default_factory=dict)
    lock: LockLike = field(default_factory=threading.Lock)


citation_index_state = CitationIndexState()


__all__ = ["CitationIndexState", "LockLike", "citation_index_state"]
