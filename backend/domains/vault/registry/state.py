"""Single process-wide owner for registry caches and synchronization."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any


RegistryData = dict[str, Any]


@dataclass
class RegistryState:
    """Mutable process state shared by all registry readers and writers."""

    cache: dict[str, RegistryData] = field(default_factory=dict)
    cache_mtime: dict[str, float] = field(default_factory=dict)
    cache_timestamp: dict[str, float] = field(default_factory=dict)
    cache_ttl_seconds: int = 30
    ensured_tables: set[str] = field(default_factory=set)
    seen_nondegenerate: set[str] = field(default_factory=set)
    mutation_lock: threading.RLock = field(default_factory=threading.RLock)


registry_state = RegistryState()

__all__ = ["RegistryData", "RegistryState", "registry_state"]
