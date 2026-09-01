"""Identity-preserving guards for open registry and extension records."""

from __future__ import annotations

from typing import Protocol, TypeGuard

from backend.domains.vault.registry.state import RegistryData


class RecordReader(Protocol):
    """Read-only named fields, shared by open records and typed projections."""

    def get(self, key: str, /) -> object: ...


def is_record(value: object) -> TypeGuard[RegistryData]:
    """Accept an existing dictionary without changing any key or value."""
    return isinstance(value, dict)


def is_object_list(value: object) -> TypeGuard[list[object]]:
    """Narrow a real mutable list without copying extension-owned items."""
    return isinstance(value, list)
