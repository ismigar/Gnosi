"""Shared option-catalog value types."""

from __future__ import annotations

from typing import Any, TypeAlias

Metadata: TypeAlias = dict[str, Any]
Option: TypeAlias = dict[str, Any]
Seed: TypeAlias = tuple[str, str]

__all__ = ["Metadata", "Option", "Seed"]
