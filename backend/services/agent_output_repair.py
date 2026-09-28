"""Operation-owned, immutable partial repairs inside the existing call budget."""
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class OutputRepair:
    input: str
    output_schema: dict[str, Any]
    restore: Callable[[str], str]


RepairBuilder = Callable[[str, Exception], OutputRepair | None]
