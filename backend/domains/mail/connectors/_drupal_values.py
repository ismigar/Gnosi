"""Native operations on opaque Drupal values; no application schema assertions.

Do not validate or coerce decoder values before their original operation: doing
so changes errors, duck protocols, identity and partial discovery results. Method
results stay object. The input-only exceptions below are at the actual dict and
sorting builtins and native unpacking, whose protocols decide supported inputs.

Note: do not wrap unpacking in a generator, because it turns StopIteration from
items() into RuntimeError. Unpack eagerly instead. Do not use iterate_values in
a for expression, because iterators receive an extra __iter__ call; use the
existing iterable_values adapter, which defers the single native iteration.
"""

from collections.abc import Callable


def get_default(value: object, key: object, default: object) -> object:
    """Preserve the explicit second argument to native get."""
    result: object = getattr(value, "get")(key, default)
    return result


def method_value(value: object, name: str, *args: object) -> object:
    """Call a native method without asserting the receiver or return shape."""
    result: object = getattr(value, name)(*args)
    return result


def unpack_pair(value: object) -> tuple[object, object]:
    """Build a pair only after native unpacking validates the exact item count."""
    first: object
    second: object
    first, second = value  # type: ignore[misc]
    return first, second


def copy_attributes(value: object) -> dict[object, object]:
    """Construct a dict using native mapping/iterable inputs and errors."""
    result: dict[object, object] = dict(value)  # type: ignore[call-overload]
    return result


def sort_rows(rows: list[dict[str, object]], key: Callable[[dict[str, object]], object]) -> None:
    """Let list.sort compare opaque keys; do not assert lower() returns text."""
    rows.sort(key=key)  # type: ignore[arg-type]


def sorted_values(values: set[object]) -> list[object]:
    """Let sorted apply the original comparison protocol to opaque targets."""
    return sorted(values)  # type: ignore[type-var]
