"""Shared citation-normalizer value types."""

from __future__ import annotations

from typing import Any, TypeAlias

ZoteroItem: TypeAlias = dict[str, Any]
Creator: TypeAlias = dict[str, str]
MetaPair: TypeAlias = tuple[str, str]

__all__ = ["Creator", "MetaPair", "ZoteroItem"]
