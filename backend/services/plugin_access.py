"""FastAPI guards for optional per-vault capabilities."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import HTTPException

from backend.services import builtin_plugins


def require_plugins(*plugin_ids: str) -> Callable[[], Awaitable[None]]:
    """Return a dependency that rejects requests for disabled capabilities."""

    required = tuple(dict.fromkeys(str(plugin_id) for plugin_id in plugin_ids))

    async def dependency() -> None:
        await assert_plugins_enabled(*required)

    return dependency


async def assert_plugins_enabled(*plugin_ids: str) -> None:
    """Reject unless every requested capability is enabled in the active vault."""
    from backend.api.vault_routes import _load_plugins_state

    state: dict[str, Any] = await asyncio.to_thread(_load_plugins_state)
    missing = [
        plugin_id for plugin_id in plugin_ids if not builtin_plugins.is_enabled(state, plugin_id)
    ]
    if missing:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "plugin_disabled",
                "plugins": missing,
                "settings": {"tab": "plugins", "pluginId": missing[0]},
            },
        )
