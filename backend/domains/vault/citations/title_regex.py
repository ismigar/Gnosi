"""Typed regex adapter retaining native errors for historical raw titles."""

from __future__ import annotations

import re

_TITLE_PATTERN = re.compile(r"[a-zA-ZÀ-ÿ0-9]+")


def title_tokens(source: object) -> list[str]:
    """Return textual tokens or raise the regex engine's original input error.

    Citation metadata can contain arbitrary YAML values. Unsupported titles
    must fail only when this fallback is used, with the same exception as re.
    Reconstructing those exceptions loses native type names and buffer errors.
    """
    if isinstance(source, str):
        return _TITLE_PATTERN.findall(source)
    # Library-adapter exception: deliberately send invalid input to re's own
    # validator. No unchecked result flows into the typed application.
    _TITLE_PATTERN.findall(source)  # type: ignore[call-overload]
    raise TypeError("The regex engine unexpectedly accepted a non-text title")
