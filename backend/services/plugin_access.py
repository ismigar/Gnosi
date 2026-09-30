"""FastAPI guards for optional per-vault capabilities."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.services import builtin_plugins
from backend.services.context_vars import active_vault_path, get_active_vault_path


def plugins_enabled_now(*plugin_ids: str, vault_path: Path | None = None) -> bool:
    """Fail closed against current state in the operation's originating vault."""
    from backend.domains.configuration import plugin_state
    from backend.utils.safe_io import safe_write_json

    try:
        vault = vault_path if vault_path is not None else get_active_vault_path()
    except Exception:
        return False
    if vault is None:
        return False
    token = active_vault_path.set(vault)
    try:
        state = plugin_state.load_with_dependencies(
            plugin_state.PluginStateDependencies(
                path=lambda: vault / ".gnosi" / "plugins.json",
                normalize_state=builtin_plugins.normalize_state,
                write_json=safe_write_json,
                logger=logging.getLogger(__name__),
            )
        )
        return all(builtin_plugins.is_enabled(state, plugin_id) for plugin_id in plugin_ids)
    except Exception:
        logging.getLogger(__name__).warning("Optional operation paused: plugin state unavailable")
        return False
    finally:
        active_vault_path.reset(token)


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
