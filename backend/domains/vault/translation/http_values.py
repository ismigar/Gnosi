"""Text narrowing at JSON request boundaries, without coercing malformed input."""

from __future__ import annotations

import operator


def stripped_request_text(value: object) -> str:
    """Keep native strip errors; JSON text is the only successful HTTP input.

    Callers retain their existing false-value fallback before this operation.
    JSON numbers/arrays/objects still fail at the original attribute lookup,
    not at a newly introduced request validator. A non-text return can only
    come from a non-JSON Python caller, and cannot be asserted to be a string.
    """
    result: object = operator.methodcaller("strip")(value)
    if not isinstance(result, str):
        raise TypeError("HTTP text fields must produce a string")
    return result
