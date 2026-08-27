"""Agent workflow coordination and compatibility-preserving dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from langgraph.graph import StateGraph

from backend.agent.agent_context import build_context_tools
from backend.agent.context_safety import source_trust_label
from backend.config.app_config import load_params
from backend.domains.agent.llm import (
    _get_hybrid_llm,
    _provider_fallbacks,
    _provider_is_available,
    _resolve_auto_llm,
    get_llm,
)
from backend.domains.agent.runtime_tools import (
    _resolve_runtime_capabilities,
    _select_agent_profile,
    prepare_agent_runtime,
)
from backend.domains.agent.workflow_setup import (
    ModelSetup,
    ProfileSetup,
    PromptSetup,
    ToolSetup,
    build_prompts,
    build_tool_workflow,
    prepare_profile,
    resolve_model,
)
from backend.security.ai_credentials import resolve_provider_api_key
from backend.services.provider_health import snapshot as provider_health_snapshot

cfg = load_params(strict_env=False)
INSTRUCTIONS_DIR = cfg.paths.get("AGENT_INSTRUCTIONS") or (
    Path(__file__).resolve().parents[2] / "agent" / "instructions"
)


@dataclass(frozen=True)
class WorkflowDependencies:
    """Injectable seams retained for the historical factory facade."""

    prepare_agent_runtime: Callable[..., Any] = prepare_agent_runtime
    select_agent_profile: Callable[..., Any] = _select_agent_profile
    resolve_runtime_capabilities: Callable[..., Any] = _resolve_runtime_capabilities
    resolve_auto_llm: Callable[..., Any] = _resolve_auto_llm
    provider_is_available: Callable[..., Any] = _provider_is_available
    resolve_provider_api_key: Callable[..., Any] = resolve_provider_api_key
    get_llm: Callable[..., Any] = get_llm
    get_hybrid_llm: Callable[..., Any] = _get_hybrid_llm
    provider_fallbacks: Callable[..., Any] = _provider_fallbacks
    build_context_tools: Callable[..., Any] = build_context_tools


DEFAULT_WORKFLOW_DEPENDENCIES = WorkflowDependencies()

MAX_SKILL_INSTRUCTION_CHARS = 24_000
MAX_SYSTEM_PROMPT_CHARS = 32_000

DEFAULT_SUPERVISOR_PROMPT = (
    "You are the Gnosi Supervisor.\n"
    "Your job is to coordinate the expert team and resolve the user's request.\n"
    "\n"
    "TEAM MEMBERS:\n"
    "1. **Coder**: Senior software engineer specializing in Python, Git, testing, "
    "and file systems.\n"
    "2. **Brain**: Sovereign knowledge and automation manager specializing in the "
    "Gnosi Vault and long-term memory.\n"
    "\n"
    "ROUTING INSTRUCTIONS:\n"
    "- Route code-change requests to `Coder`.\n"
    "- Route personal-information, Gnosi Vault, directive, and procedure requests "
    "to `Brain`.\n"
    "- Handle general conversation and simple questions through `General`.\n"
    "- Return `FINISH` when an agent has completed the work.\n"
    "\n"
    "Return ONLY the next worker's name: 'Coder', 'Brain', 'General', or 'FINISH'.\n"
)


def _model_strategy_metadata(profile: ProfileSetup, model: ModelSetup) -> dict[str, Any]:
    """Render the public model-strategy subset without internal candidates."""
    return {
        "mode": model.strategy.get("mode", "pinned"),
        "primary": model.strategy.get("primary")
        or {
            "provider": profile.agent_data.get("provider"),
            "model": profile.agent_data.get("model"),
        },
        "selection_reason": model.strategy.get("selection_reason"),
        "rejected_models": model.strategy.get("rejected_models") or [],
    }


def _runtime_unavailable_tool_ids(profile: ProfileSetup, tools: ToolSetup) -> list[str]:
    """Combine unresolved and capacity-omitted capabilities deterministically."""
    runtime_ids = (
        []
        if tools.notebook_context_only
        else list(getattr(profile.resolved_runtime, "unavailable_tool_ids", ()) or ())
    )
    return sorted(set(runtime_ids + tools.omitted_runtime_tool_ids))


def _context_ref_metadata(context_refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return bounded, portable context references with their trust label."""
    return [
        {
            key: ref.get(key)
            for key in ("id", "type", "ref", "label", "scope")
            if ref.get(key) not in (None, "", {})
        }
        | {"trust": source_trust_label(ref.get("type"))}
        for ref in context_refs[:16]
    ]


def _selection_metadata(
    *,
    llm_mode: str,
    profile: ProfileSetup,
    model: ModelSetup,
    prompts: PromptSetup,
    tools: ToolSetup,
) -> dict[str, Any]:
    """Build the stable model, capability and context selection response."""
    notebook_only = tools.notebook_context_only
    return {
        "mode": llm_mode,
        "provider": model.provider_name,
        "model": model.model_name,
        "fallbacks": model.fallback_metadata,
        "model_strategy": _model_strategy_metadata(profile, model),
        "provider_health": provider_health_snapshot(),
        "connector_health": profile.connector_health[:32],
        "assigned_skill_ids": ([] if notebook_only else list(prompts.assigned_runtime_skill_ids)),
        "active_skill_ids": ([] if notebook_only else list(prompts.active_runtime_skill_ids)),
        "missing_skill_ids": (
            []
            if notebook_only
            else list(getattr(profile.resolved_runtime, "missing_skill_ids", ()) or ())
        ),
        "unavailable_tool_ids": _runtime_unavailable_tool_ids(profile, tools),
        "catalog_revision": str(getattr(profile.resolved_runtime, "catalog_revision", "") or ""),
        "supports_tools": tools.supports_tools,
        "tool_count": len(tools.bound_tool_names),
        "context_window_tokens": prompts.context_window_tokens,
        "message_budget_chars": tools.message_budget_chars,
        "tools": [
            {key: value for key, value in item.items() if not key.startswith("_")}
            for item in tools.runtime_tool_metadata
        ],
        "turn_grant_tool_names": sorted(tools.explicitly_activated_tool_names),
        "context_refs": _context_ref_metadata(prompts.context_refs),
    }


async def create_agent_workflow(
    mcp_tools_list: list[dict[str, Any]],
    mcp_client: Any,
    agent_id: str = "gnosy",
    llm_mode: str = "agent_default",
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    user_message: str = "",
    timeout: int = 60,
    active_skill_ids: Optional[Iterable[str]] = None,
    vault_path: Optional[Path] = None,
    prepared_ai_cfg: dict[str, Any] | None = None,
    prepared_agent_data: dict[str, Any] | None = None,
    runtime_capabilities: Any = None,
    memory_user_id: str = "",
    reviewed_memory_rows: Optional[Iterable[dict[str, Any]]] = None,
    dependencies: WorkflowDependencies | None = None,
) -> tuple[StateGraph[Any, None, Any, Any] | None, dict[str, Any]]:
    """Create an uncompiled multi-agent graph and its selection metadata."""
    deps = dependencies or DEFAULT_WORKFLOW_DEPENDENCIES
    profile = await prepare_profile(
        mcp_client=mcp_client,
        agent_id=agent_id,
        active_skill_ids=active_skill_ids,
        vault_path=vault_path,
        prepared_ai_cfg=prepared_ai_cfg,
        prepared_agent_data=prepared_agent_data,
        runtime_capabilities=runtime_capabilities,
        dependencies=deps,
    )
    if profile is None:
        return None, {}
    model, failure_metadata = resolve_model(
        profile,
        llm_mode=llm_mode,
        llm_provider=llm_provider,
        llm_model=llm_model,
        user_message=user_message,
        timeout=timeout,
        dependencies=deps,
    )
    if model is None:
        return None, failure_metadata
    prompts = build_prompts(
        profile,
        model,
        active_skill_ids=active_skill_ids,
        vault_path=vault_path,
        memory_user_id=memory_user_id,
        reviewed_memory_rows=reviewed_memory_rows,
        user_message=user_message,
        instructions_dir=INSTRUCTIONS_DIR,
        default_vault_path=cfg.paths.get("VAULT"),
        max_skill_instruction_chars=MAX_SKILL_INSTRUCTION_CHARS,
        max_system_prompt_chars=MAX_SYSTEM_PROMPT_CHARS,
        default_supervisor_prompt=DEFAULT_SUPERVISOR_PROMPT,
    )
    tools = build_tool_workflow(
        profile,
        model,
        prompts,
        mcp_tools_list=mcp_tools_list,
        mcp_client=mcp_client,
        active_skill_ids=active_skill_ids,
        dependencies=deps,
    )
    return tools.workflow, _selection_metadata(
        llm_mode=llm_mode,
        profile=profile,
        model=model,
        prompts=prompts,
        tools=tools,
    )
