"""Compatibility facade for the canonical :mod:`backend.domains.agent` package."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from langgraph.graph import StateGraph

from backend.agent.agent_context import build_context_tools
from backend.config.app_config import load_params
from backend.domains.agent.context import (
    INVENTORY_QUERY_STOPWORDS,
    INVENTORY_REQUEST_TYPE_PATTERNS,
    _deterministic_personal_resources_call,
    _deterministic_reader_context_call,
    _deterministic_vault_context_call,
    _inventory_continuation_requested,
    _inventory_request_arguments,
    _latest_context_tool_since_latest_user,
    _latest_reader_analysis_job_id,
    _personal_resource_authorship_requested,
    _previous_inventory_arguments,
    _repeated_tool_call_since_latest_user,
    _required_reader_context_tool,
    _required_vault_context_tool,
    _tool_results_since_latest_user,
    _vault_context_is_relevant,
    build_agent_turn_plan,
)
from backend.domains.agent.intent import _obvious_route, _request_mode
from backend.domains.agent.llm import (
    _get_hybrid_llm,
    _provider_is_available,
    _resolve_auto_llm,
    get_default_llm_with_meta,
    get_llm,
)
from backend.domains.agent.llm import (
    _provider_fallbacks as _domain_provider_fallbacks,
)
from backend.domains.agent.llm import (
    generate_text as _domain_generate_text,
)
from backend.domains.agent.messages import (
    MAX_MODEL_MESSAGE_CHARS,
    _bounded_model_messages,
)
from backend.domains.agent.policy import _tool_policy_wrapper
from backend.domains.agent.responses import (
    _authored_resources_response,
    _inventory_context_response,
    _reader_job_response,
    _response_language,
)
from backend.domains.agent.runtime_tools import (
    _authorized_brain_write_tools,
    _coder_read_only_tools,
    _latest_tool_batch_requires_confirmation,
    _model_context_window,
    _model_supports_tools,
    _omitted_runtime_tool_ids,
    _rejected_mcp_names,
    _resolve_runtime_capabilities,
    _safe_mcp_definitions,
    _select_agent_profile,
    _turn_model_tools,
    prepare_agent_runtime,
)
from backend.domains.agent.workflow import (
    WorkflowDependencies,
)
from backend.domains.agent.workflow import (
    create_agent_workflow as _domain_create_agent_workflow,
)
from backend.domains.agent.write_intent import (
    _explicit_brain_write_tool_names,
    _reader_context_analysis_requested,
)
from backend.security.ai_credentials import resolve_provider_api_key

__all__ = [
    "INVENTORY_QUERY_STOPWORDS",
    "INVENTORY_REQUEST_TYPE_PATTERNS",
    "MAX_MODEL_MESSAGE_CHARS",
    "_authorized_brain_write_tools",
    "_authored_resources_response",
    "_bounded_model_messages",
    "_coder_read_only_tools",
    "_deterministic_personal_resources_call",
    "_deterministic_reader_context_call",
    "_deterministic_vault_context_call",
    "_explicit_brain_write_tool_names",
    "_get_hybrid_llm",
    "_inventory_context_response",
    "_inventory_continuation_requested",
    "_inventory_request_arguments",
    "_latest_context_tool_since_latest_user",
    "_latest_reader_analysis_job_id",
    "_latest_tool_batch_requires_confirmation",
    "_model_context_window",
    "_model_supports_tools",
    "_obvious_route",
    "_omitted_runtime_tool_ids",
    "_personal_resource_authorship_requested",
    "_previous_inventory_arguments",
    "_provider_fallbacks",
    "_reader_context_analysis_requested",
    "_reader_job_response",
    "_rejected_mcp_names",
    "_repeated_tool_call_since_latest_user",
    "_request_mode",
    "_required_reader_context_tool",
    "_required_vault_context_tool",
    "_response_language",
    "_safe_mcp_definitions",
    "_tool_policy_wrapper",
    "_tool_results_since_latest_user",
    "_turn_model_tools",
    "_vault_context_is_relevant",
    "build_agent_turn_plan",
    "build_context_tools",
    "create_agent_workflow",
    "generate_text",
    "get_default_llm_with_meta",
    "get_llm",
    "load_params",
    "prepare_agent_runtime",
    "resolve_provider_api_key",
]


def _provider_fallbacks(
    primary_provider: str,
    primary_model: str,
    providers: dict[str, Any],
    *,
    timeout: int,
    allowed_routes: Iterable[dict[str, str]] | None = None,
    llm_factory: Any = None,
) -> list[tuple[str, str, Any]]:
    """Preserve the factory's historical model-constructor monkeypatch seam."""
    return list(
        _domain_provider_fallbacks(
            primary_provider,
            primary_model,
            providers,
            timeout=timeout,
            allowed_routes=allowed_routes,
            llm_factory=llm_factory or get_llm,
        )
    )


def generate_text(
    prompt: str,
    user_message: str = "",
    timeout: int = 60,
    agent_id: str = "",
) -> tuple[str, str]:
    """Preserve the factory's historical selector monkeypatch seam."""
    text, label = _domain_generate_text(
        prompt,
        user_message=user_message,
        timeout=timeout,
        agent_id=agent_id,
        selector=get_default_llm_with_meta,
    )
    return str(text), str(label)


def _compat_prepare_agent_runtime(
    agent_id: str,
    *,
    vault_path: Path | None = None,
    active_skill_ids: Iterable[str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None, Any]:
    """Resolve runtime state through facade-level compatibility collaborators."""
    loaded = load_params(strict_env=False)
    if isinstance(loaded, dict):
        raw_ai_cfg = loaded["ai"] if "ai" in loaded else {}
    else:
        raw_ai_cfg = loaded.ai
    ai_cfg = dict(raw_ai_cfg) if isinstance(raw_ai_cfg, dict) else {}
    agent_data = _select_agent_profile(ai_cfg, agent_id)
    runtime = (
        _resolve_runtime_capabilities(
            agent_data,
            vault_path=vault_path,
            active_skill_ids=active_skill_ids,
        )
        if agent_data
        else None
    )
    return ai_cfg, agent_data, runtime


async def create_agent_workflow(
    mcp_tools_list: list[dict[str, Any]],
    mcp_client: Any,
    agent_id: str = "gnosy",
    llm_mode: str = "agent_default",
    llm_provider: str | None = None,
    llm_model: str | None = None,
    user_message: str = "",
    timeout: int = 60,
    active_skill_ids: Iterable[str] | None = None,
    vault_path: Path | None = None,
    prepared_ai_cfg: dict[str, Any] | None = None,
    prepared_agent_data: dict[str, Any] | None = None,
    runtime_capabilities: Any = None,
    memory_user_id: str = "",
    reviewed_memory_rows: Iterable[dict[str, Any]] | None = None,
) -> tuple[StateGraph[Any, None, Any, Any] | None, dict[str, Any]]:
    """Delegate to the canonical workflow with explicit compatibility seams."""
    dependencies = WorkflowDependencies(
        prepare_agent_runtime=_compat_prepare_agent_runtime,
        select_agent_profile=_select_agent_profile,
        resolve_runtime_capabilities=_resolve_runtime_capabilities,
        resolve_auto_llm=_resolve_auto_llm,
        provider_is_available=_provider_is_available,
        resolve_provider_api_key=resolve_provider_api_key,
        get_llm=get_llm,
        get_hybrid_llm=_get_hybrid_llm,
        provider_fallbacks=_provider_fallbacks,
        build_context_tools=build_context_tools,
    )
    workflow, metadata = await _domain_create_agent_workflow(
        mcp_tools_list,
        mcp_client,
        agent_id=agent_id,
        llm_mode=llm_mode,
        llm_provider=llm_provider,
        llm_model=llm_model,
        user_message=user_message,
        timeout=timeout,
        active_skill_ids=active_skill_ids,
        vault_path=vault_path,
        prepared_ai_cfg=prepared_ai_cfg,
        prepared_agent_data=prepared_agent_data,
        runtime_capabilities=runtime_capabilities,
        memory_user_id=memory_user_id,
        reviewed_memory_rows=reviewed_memory_rows,
        dependencies=dependencies,
    )
    return workflow, dict(metadata)
