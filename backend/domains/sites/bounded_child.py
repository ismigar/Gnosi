"""Apply a single SSH deadline even when the maintained driver uses the child directly."""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Protocol


class Child(Protocol):
    timeout: float
    delaybeforesend: float | None
    @property
    def before(self) -> str: ...
    @property
    def match(self) -> re.Match[str]: ...
    def expect(self, pattern: object) -> int: ...
    def sendline(self, value: str) -> int: ...
    def send(self, value: str) -> int: ...
    def isalive(self) -> bool: ...
    def close(self, force: bool = True) -> None: ...


class DeadlineChild:
    """Preserve the PTY interface while charging every wait to its owner's deadline."""

    def __init__(self, child: Child, remaining: Callable[[], float]) -> None:
        self._child = child
        self._remaining = remaining

    @property
    def timeout(self) -> float:
        return self._child.timeout

    @timeout.setter
    def timeout(self, value: float) -> None:
        self._child.timeout = value

    @property
    def delaybeforesend(self) -> float | None:
        return self._child.delaybeforesend

    @delaybeforesend.setter
    def delaybeforesend(self, value: float | None) -> None:
        self._child.delaybeforesend = value

    @property
    def before(self) -> str:
        return self._child.before

    @property
    def match(self) -> re.Match[str]:
        return self._child.match

    def expect(self, pattern: object) -> int:
        self._child.timeout = self._remaining()
        result = self._child.expect(pattern)
        self._remaining()
        return result

    def sendline(self, value: str) -> int:
        self._remaining()
        result = self._child.sendline(value)
        self._remaining()
        return result

    def send(self, value: str) -> int:
        self._remaining()
        result = self._child.send(value)
        self._remaining()
        return result

    def isalive(self) -> bool:
        return self._child.isalive()

    def close(self, force: bool = True) -> None:
        self._child.close(force=force)
