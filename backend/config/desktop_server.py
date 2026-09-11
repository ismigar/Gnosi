"""Keep Electron's private listener separate from configured native services."""

from __future__ import annotations

import re
from collections.abc import Mapping


def desktop_server_address(environment: Mapping[str, str]) -> tuple[str, int] | None:
    """Honor the parent's port only for a correlated desktop child."""
    if not environment.get("GNOSI_DESKTOP_INSTANCE"):
        return None
    if not re.fullmatch(r"[a-f0-9]{64}", environment["GNOSI_DESKTOP_INSTANCE"]):
        raise ValueError("Invalid desktop process identity")
    value = environment.get("BACKEND_PORT", "")
    if not re.fullmatch(r"[0-9]{1,5}", value) or not 1 <= int(value) <= 65535:
        raise ValueError("Invalid desktop listener port")
    return "127.0.0.1", int(value)
