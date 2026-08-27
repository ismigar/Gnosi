"""Dependency-aware plugin lifecycle and runtime transitions."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from fastapi import HTTPException, Request

from backend.domains.configuration.api.plugin_models import PluginLifecycleRequest
from backend.services import builtin_plugins

PluginState = dict[str, Any]
StateLoader = Callable[[], PluginState]
StateSaver = Callable[[PluginState], PluginState]
LifecycleTransition = Callable[[bool], PluginState]


@dataclass(frozen=True)
class PluginLifecycleDependencies:
    load_state: StateLoader
    save_state: StateSaver
    mutation_lock: Callable[[], asyncio.Lock]
    config_dir: Callable[[], Path]
    reconcile: Callable[[], PluginState]
    refresh_runtime: Callable[[Request, PluginState], Awaitable[None]]
    logger: logging.Logger


def _validate_installed_plugin(plugin_id: str, config_dir: Path) -> None:
    if plugin_id in builtin_plugins.BUILTIN_PLUGIN_IDS:
        return
    from backend.services import plugin_system

    plugin_system.read_manifest(config_dir, plugin_id)


def _enable_plugin(
    state: PluginState,
    plugin_id: str,
    payload: PluginLifecycleRequest,
    enabled_builtin: set[str],
) -> tuple[PluginState, list[str]]:
    missing = [
        requirement
        for requirement in builtin_plugins.required_plugins(plugin_id)
        if requirement not in enabled_builtin
    ]
    if missing and not payload.confirm_dependencies:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "plugin_dependency_confirmation_required",
                "plugin_id": plugin_id,
                "enable": missing,
                "disable": [],
            },
        )
    affected: list[str] = []
    for requirement in missing:
        state = builtin_plugins.set_enabled(state, requirement, True)
        affected.append(requirement)
    return builtin_plugins.set_enabled(state, plugin_id, True), affected


def _disable_plugin(
    state: PluginState,
    plugin_id: str,
    payload: PluginLifecycleRequest,
    enabled_builtin: set[str],
) -> tuple[PluginState, list[str]]:
    dependents = list(builtin_plugins.dependent_plugins(plugin_id, enabled_builtin))
    needs_confirmation = bool(dependents) or plugin_id == "llm-wiki"
    if needs_confirmation and not (payload.confirm_dependencies or payload.confirm_disable):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "plugin_dependency_confirmation_required",
                "plugin_id": plugin_id,
                "enable": [],
                "disable": dependents,
            },
        )
    affected: list[str] = []
    for dependent in reversed(dependents):
        state = builtin_plugins.set_enabled(state, dependent, False)
        affected.append(dependent)
    return builtin_plugins.set_enabled(state, plugin_id, False), affected


def _transition_plugin_state(
    state: PluginState,
    plugin_id: str,
    payload: PluginLifecycleRequest,
) -> tuple[PluginState, list[str]]:
    enabled_builtin = {str(value) for value in (state.get("enabled_builtin") or [])}
    if payload.enabled:
        return _enable_plugin(state, plugin_id, payload, enabled_builtin)
    return _disable_plugin(state, plugin_id, payload, enabled_builtin)


def _update_llm_wiki_schedule(
    state: PluginState,
    logger: logging.Logger,
) -> None:
    from backend.scheduler.manager import scheduler_manager

    try:
        task = scheduler_manager.get_task("llm_wiki_maintenance")
        interval = float((task or {}).get("interval_minutes") or 1440)
        scheduler_manager.update_task(
            "llm_wiki_maintenance",
            interval_minutes=interval,
            enabled=builtin_plugins.is_enabled(state, "llm-wiki"),
        )
    except Exception as exc:
        logger.warning(
            "Could not update the LLM Wiki maintenance task: %s",
            exc,
        )


def _apply_lifecycle_mutation(
    plugin_id: str,
    payload: PluginLifecycleRequest,
    dependencies: PluginLifecycleDependencies,
    transition_agent: LifecycleTransition,
) -> PluginState:
    state = dependencies.load_state()
    _validate_installed_plugin(plugin_id, dependencies.config_dir())
    state, affected = _transition_plugin_state(state, plugin_id, payload)
    affected.append(plugin_id)

    agent_result: PluginState = {}
    if "llm-wiki" in affected:
        agent_result = transition_agent(builtin_plugins.is_enabled(state, "llm-wiki"))

    saved = dependencies.save_state(state)
    if "llm-wiki" in affected:
        _update_llm_wiki_schedule(saved, dependencies.logger)
    dependencies.reconcile()
    return {
        **saved,
        **agent_result,
        "plugin_id": plugin_id,
        "enabled": builtin_plugins.is_enabled(saved, plugin_id),
        "affected": affected,
        "builtins": builtin_plugins.public_registry(),
    }


async def change_plugin_lifecycle(
    plugin_id: str,
    payload: PluginLifecycleRequest,
    request: Request,
    dependencies: PluginLifecycleDependencies,
) -> PluginState:
    """Apply one dependency-aware plugin lifecycle mutation."""
    from backend.services.llm_wiki_agent import LlmWikiAgentError, transition_agent

    try:
        async with dependencies.mutation_lock():
            result = await asyncio.to_thread(
                _apply_lifecycle_mutation,
                plugin_id,
                payload,
                dependencies,
                transition_agent,
            )
    except LlmWikiAgentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await dependencies.refresh_runtime(request, result)
    cache = getattr(request.app.state, "agent_cache", None)
    if cache:
        cache.clear()
    return result


async def _refresh_mail_runtime(state: PluginState, logger: logging.Logger) -> None:
    try:
        from backend.services.imap_idle_service import idle_manager

        if builtin_plugins.is_enabled(state, "mail"):
            await asyncio.to_thread(idle_manager.start_all)
        else:
            await asyncio.to_thread(idle_manager.stop_all)
    except Exception as exc:
        logger.warning("Could not refresh Mail background workers: %s", exc)


async def _start_ai_runtime(request: Request) -> None:
    from backend.agent.factory import create_agent_workflow
    from backend.config.mcp_config import MCP_SERVERS
    from backend.mcp.client import MultiServerMCPClient

    mcp_client = MultiServerMCPClient(MCP_SERVERS)
    start_client = cast(Callable[[], Awaitable[None]], mcp_client.start)
    get_all_tools = cast(
        Callable[[], Awaitable[list[Any]]],
        mcp_client.get_all_tools,
    )
    await start_client()
    tools_list = await get_all_tools()
    request.app.state.mcp_client = mcp_client
    request.app.state.tools_list = tools_list
    workflow, _ = await create_agent_workflow(
        tools_list,
        mcp_client,
        agent_id="gnosy",
    )
    if workflow:
        request.app.state.agent_workflow = workflow
        request.app.state.agent_app = workflow.compile()


async def refresh_plugin_runtime(
    request: Request,
    state: PluginState,
    logger: logging.Logger,
) -> None:
    """Apply safe runtime transitions after state has been committed."""
    affected = {str(value) for value in (state.get("affected") or [])}
    if "mail" in affected:
        await _refresh_mail_runtime(state, logger)

    should_start_ai = (
        "ai-platform" in affected
        and builtin_plugins.is_enabled(state, "ai-platform")
        and not getattr(request.app.state, "mcp_client", None)
    )
    if not should_start_ai:
        return
    try:
        await _start_ai_runtime(request)
    except Exception as exc:
        logger.warning("Could not start the AI plugin runtime: %s", exc)
