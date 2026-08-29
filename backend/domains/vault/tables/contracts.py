"""Public HTTP contracts for vault registry collections."""

from __future__ import annotations

from pydantic import JsonValue, RootModel


class RegistryRecord(RootModel[dict[str, JsonValue]]):
    """One JSON-compatible database or table registry record."""


__all__ = ["RegistryRecord"]
