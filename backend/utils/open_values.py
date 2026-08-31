"""Native operations on opaque extension values, without schema assertions.

Python's builtins validate their own protocol inputs. Typeshed deliberately
describes narrower accepted inputs, so these input-only exceptions retain native
errors and legacy sequence protocols. No adapter asserts an application-shaped
result or catches/converts a native exception.
"""

from __future__ import annotations

import operator
from collections.abc import Iterable, Iterator
from dataclasses import dataclass


@dataclass(frozen=True)
class _NativeIterable:
    value: object

    def __iter__(self) -> Iterator[object]:
        return iterate_values(self.value)


def iterable_values(value: object) -> Iterable[object]:
    """Defer the original iter call to the consuming for loop, exactly once."""
    return _NativeIterable(value)


def list_values(value: object) -> list[object]:
    """Use list's original iterable and length-hint protocols without wrapping."""
    result: list[object] = list(value)  # type: ignore[call-overload]
    return result


def iterate_values(value: object) -> Iterator[object]:
    """Retain native iterability checks, including legacy __getitem__ sequences."""
    result: Iterator[object] = iter(value)  # type: ignore[call-overload]
    return result


def contains_value(container: object, value: object) -> bool:
    """Retain membership coercion and errors for arbitrary Python containers."""
    return operator.contains(container, value)  # type: ignore[arg-type]


def integer_value(value: object) -> int:
    """Retain int's numeric/string protocols, conversion order and exceptions."""
    result: int = int(value)  # type: ignore[call-overload]
    return result


def float_value(value: object) -> float:
    """Retain float's numeric/string protocols and native exceptions."""
    return float(value)  # type: ignore[arg-type]


def length_value(value: object) -> int:
    """Retain native len validation without iterating or using length hints."""
    return len(value)  # type: ignore[arg-type]


def append_value(container: object, value: object) -> None:
    """Preserve attribute lookup/call errors and discard the append result."""
    container.append(value)  # type: ignore[attr-defined]


def get_value(container: object, key: object) -> object:
    """Call native get with one key, retaining errors and arbitrary values."""
    result: object = container.get(key)  # type: ignore[attr-defined]
    return result


def set_value(container: object, key: object, value: object) -> None:
    """Use native item assignment without asserting a dictionary shape."""
    container[key] = value  # type: ignore[index]


def pop_value(container: object, key: object, default: object) -> object:
    """Preserve native pop lookup, explicit default and arbitrary result."""
    result: object = container.pop(key, default)  # type: ignore[attr-defined]
    return result
