"""Narrow native calls whose lookup order is part of the Knowledge contract."""

from __future__ import annotations

import operator
from dataclasses import dataclass


@dataclass(frozen=True)
class CapturedAppend:
    """One append callback resolved before its argument is evaluated."""

    callback: object

    def __call__(self, value: object) -> None:
        operator.call(self.callback, value)  # type: ignore[arg-type]


def capture_append(container: object) -> CapturedAppend:
    """Perform native attribute lookup now and defer only the invocation."""
    return CapturedAppend(getattr(container, "append"))


__all__ = ["CapturedAppend", "capture_append"]
