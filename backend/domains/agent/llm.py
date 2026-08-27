"""Typed language-model selection and provider adapters."""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Iterable

from langchain_core.language_models import BaseChatModel
from pydantic import SecretStr

from backend.config.app_config import load_params
from backend.security.ai_credentials import resolve_provider_api_key

cfg = load_params(strict_env=False)
log = logging.getLogger(__name__)


LOCAL_PROVIDERS = {"ollama", "llama-cpp", "lmstudio", "local", "generic"}


def _provider_is_available(
    provider_name: str,
    provider_cfg: dict[str, Any] | None,
) -> bool:
    normalized = (provider_name or "").strip().lower()
    cfg = provider_cfg or {}

    # Check if disabled by user
    if not cfg.get("enabled", True):
        return False

    if normalized in LOCAL_PROVIDERS:
        return True
    return bool(resolve_provider_api_key(normalized, cfg))


def _resolve_auto_llm(
    message: str,
    providers_cfg: dict[str, Any],
    fallback_provider: str,
    fallback_model: str | None,
) -> tuple[str, str | None]:
    """Automatic model selection: delegates to the budget-aware, data-driven router.

    Modern path: `model_router.route_model` (editable registry + capability + availability
    + tokens/cost). If the router doesn't resolve, keeps the agent's fallback. Replaces the
    old hardcoded stacks (cf. directive `vault_knowledge_agents.md`).

    """
    try:
        from backend.agent.model_router import UsageStore, load_registry, route_model
    except Exception:
        return fallback_provider, fallback_model

    registry = load_registry()

    def _avail(provider_name: str) -> bool:
        return _provider_is_available(provider_name, (providers_cfg or {}).get(provider_name) or {})

    usage: dict[str, Any] = {}
    budget: dict[str, Any] = {}
    try:
        from datetime import datetime

        period = datetime.now().strftime("%Y-%m")
        usage = UsageStore().usage_for(period)
        configured_ai = cfg.ai if isinstance(cfg.ai, dict) else {}
        configured_budget = configured_ai.get("budget")
        budget = dict(configured_budget) if isinstance(configured_budget, dict) else {}
    except Exception:
        pass
    try:
        # Money cap: convert the Settings-currency cap to USD and inject the
        # period spend so route_model can hard-stop at the ceiling.
        from backend.agent.model_router import budget_status

        status = budget_status()
        if status.get("cap_usd"):
            budget["cost_cap_usd"] = status["cap_usd"]
            budget["spent_usd"] = status["spent_usd"]
    except Exception:
        pass

    decision = route_model(message, registry, is_available=_avail, usage=usage, budget=budget)
    if decision.get("provider") and decision.get("model_id"):
        return decision["provider"], decision["model_id"]
    return fallback_provider, fallback_model


def _timeout_kwargs(timeout: float | None) -> dict[str, Any]:
    return {"timeout": timeout, "max_retries": 0} if timeout is not None else {}


def _ollama_llm(
    model: str | None,
    base_url: str | None,
    timeout: float | None,
) -> BaseChatModel:
    from langchain_ollama import ChatOllama

    from backend.config.env_config import default_ollama_base_url

    log.debug("Instantiating ChatOllama with model %s", model or "llama3.2")
    return ChatOllama(
        model=model or "llama3.2",
        base_url=base_url or default_ollama_base_url(),
        client_kwargs={"timeout": timeout if timeout is not None else 60},
    )


def _openai_family_llm(
    provider: str,
    model: str | None,
    api_key: str | None,
    base_url: str | None,
    timeout: float | None,
) -> BaseChatModel | None:
    from langchain_openai import ChatOpenAI

    key = api_key or os.environ.get(f"{provider.upper()}_API_KEY")
    if not key and provider == "openai":
        log.debug("OpenAI API Key missing")
        return None
    default_models = {
        "openai": "gpt-4o",
        "deepseek": "deepseek-chat",
        "mistral": "mistral-large-latest",
        "openrouter": "openai/gpt-4o-mini",
    }
    default_urls = {
        "openai": "https://api.openai.com/v1",
        "deepseek": "https://api.deepseek.com",
        "mistral": "https://api.mistral.ai/v1",
        "openrouter": "https://openrouter.ai/api/v1",
    }
    log.debug("Instantiating %s via OpenAI interface with model %s", provider, model)
    return ChatOpenAI(
        model=model or default_models[provider],
        api_key=SecretStr(key or "no-key"),
        base_url=base_url or default_urls[provider],
        **_timeout_kwargs(timeout),
    )


def _groq_llm(
    model: str | None,
    api_key: str | None,
    base_url: str | None,
    timeout: float | None,
) -> BaseChatModel | None:
    from langchain_openai import ChatOpenAI

    key = api_key if api_key and api_key.strip() else os.environ.get("GROQ_API_KEY")
    if not key:
        log.debug("Groq API Key missing.")
        return None
    selected_model = model or "llama-3.3-70b-versatile"
    log.debug("Instantiating Groq via OpenAI shim with model %s", selected_model)
    return ChatOpenAI(
        model=selected_model,
        api_key=SecretStr(key),
        base_url=base_url or "https://api.groq.com/openai/v1",
        **_timeout_kwargs(timeout),
    )


def _anthropic_llm(
    model: str | None,
    api_key: str | None,
    timeout: float | None,
) -> BaseChatModel | None:
    from langchain_anthropic import ChatAnthropic

    key = api_key if api_key and api_key.strip() else os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        log.debug("Anthropic API Key missing.")
        return None
    selected_model = model or "claude-sonnet-4-5"
    log.debug("Instantiating ChatAnthropic with model %s", selected_model)
    return ChatAnthropic(
        model_name=selected_model,
        api_key=SecretStr(key),
        **_timeout_kwargs(timeout),
    )


def _generic_llm(
    provider: str,
    model: str | None,
    api_key: str | None,
    base_url: str | None,
    timeout: float | None,
) -> BaseChatModel:
    from langchain_openai import ChatOpenAI

    log.debug("Instantiating Generic/Universal ChatOpenAI (Provider: %s)", provider)
    return ChatOpenAI(
        model=model or "local-model",
        api_key=SecretStr(api_key or "no-key"),
        base_url=base_url or "http://localhost:8000/v1",
        **_timeout_kwargs(timeout),
    )


def _catalog_llm(
    provider: str,
    model: str | None,
    api_key: str | None,
    timeout: float | None,
) -> BaseChatModel | None:
    from backend.agent.model_catalog import catalog_base_url

    compat_url = catalog_base_url(provider)
    if not compat_url or not model:
        return None
    from langchain_openai import ChatOpenAI

    log.debug(
        "Instantiating catalog provider '%s' via OpenAI-compatible URL %s",
        provider,
        compat_url,
    )
    return ChatOpenAI(
        model=model,
        api_key=SecretStr(api_key or "no-key"),
        base_url=compat_url,
        **_timeout_kwargs(timeout),
    )


def get_llm(
    provider: str,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout: float | None = None,
) -> BaseChatModel | None:
    """
        Instantiate an LLM according to the provider and configuration.

    `timeout` (seconds): REAL network limit applied when building the client. langchain
    IGNORES `config={"timeout": ...}` in `.invoke()` (it's not a RunnableConfig key), so
    the limit MUST go here. For OpenAI-compatible providers it translates to
    `request_timeout` (httpx client timeout) and we disable the SDK's retries
    (`max_retries=0`) so that `timeout` is a real ceiling and not per-attempt. `timeout=None`
    keeps the classic behavior (agent path: no hard limit, default retries).
    See directive `ai_error_handling.md`.

    """
    # Treat empty strings as None to force the fallback to env vars
    if not api_key:
        api_key = None
    if not base_url:
        base_url = None

    try:
        if provider == "ollama":
            return _ollama_llm(model, base_url, timeout)
        if provider in {"openai", "deepseek", "mistral", "openrouter"}:
            return _openai_family_llm(provider, model, api_key, base_url, timeout)
        if provider == "groq":
            return _groq_llm(model, api_key, base_url, timeout)
        if provider == "anthropic":
            return _anthropic_llm(model, api_key, timeout)
        if provider in {"local", "generic", "lmstudio", "llama-cpp"} or base_url:
            return _generic_llm(provider, model, api_key, base_url, timeout)
        return _catalog_llm(provider, model, api_key, timeout)

    except Exception as e:
        log.error(f"❌ Error instantiating LLM for provider '{provider}': {e}")
        return None

    # Fallback if the provider isn't recognized and there's no URL
    return None


def _get_hybrid_llm(
    timeout: float | None = None,
) -> tuple[BaseChatModel | None, str | None, str | None]:
    """Fallback logic looking for any available provider beyond the primary choice.

    Returns (llm, provider, model) so callers can attribute usage; (None, None,
    None) when no fallback provider has a key."""
    # List of fallback providers to check in order of quality/availability
    fallbacks = [
        ("openai", "gpt-4o-mini"),
        ("anthropic", "claude-haiku-4-5"),
        ("openrouter", "openai/gpt-4o-mini"),
        ("groq", "llama-3.1-8b-instant"),
        ("ollama", "llama3.2:latest"),
    ]

    from backend.config.app_config import load_params
    from backend.security.ai_credentials import resolve_provider_api_key

    # We need a fresh check of providers from config
    p_cfg = load_params(strict_env=False).ai.get("providers", {})

    for p_name, m_name in fallbacks:
        key = resolve_provider_api_key(p_name, p_cfg.get(p_name))
        if key:
            log.info(f"Using emergency fallback LLM: {p_name} / {m_name}")
            llm = get_llm(
                provider=p_name,
                model=m_name,
                api_key=key,
                base_url=p_cfg.get(p_name, {}).get("base_url"),
                timeout=timeout,
            )
            if llm:
                return llm, p_name, m_name

    return None, None, None


def get_default_llm(
    user_message: str = "",
    timeout: float | None = None,
) -> BaseChatModel | None:
    """Returns an LLM ready for one-shot calls (content generation,
    summaries, meeting agendas…).

    `timeout` (seconds) is propagated to the client constructor (REAL network timeout,
    cf. `get_llm`). None → no hard limit.

    Resolves the provider/model the same way the agent does: active agent → `auto`
    selection based on the message → hybrid fallback (any provider with a key). Uses the
    FRESH config from params.yaml (not the one cached at import time) so it picks up
    providers added on the fly. Returns None if none is available.

    NOTE: this is the MODERN path (get_llm + resolve_provider_api_key), unlike
    the legacy client `pipeline/ai_client.py` which expects `model_url`/`model_name`
    per provider (incompatible with the current provider schema).

    """
    llm, _, _ = get_default_llm_with_meta(user_message=user_message, timeout=timeout)
    return llm


def get_default_llm_with_meta(
    user_message: str = "",
    timeout: float | None = None,
    agent_id: str = "",
) -> tuple[BaseChatModel | None, str | None, str | None]:
    """Like `get_default_llm` but returns (llm, provider, model) so callers can
    attribute token usage to the model that actually answered."""
    raw_ai_cfg = load_params(strict_env=False).ai
    ai_cfg = dict(raw_ai_cfg) if isinstance(raw_ai_cfg, dict) else {}
    providers = ai_cfg.get("providers", {}) or {}
    agents = ai_cfg.get("agents", []) or []

    target_id = str(agent_id or ai_cfg.get("active_agent_id") or "")
    agent_data = next((a for a in agents if a.get("id") == target_id), None)
    if not agent_data and agents:
        agent_data = next((a for a in agents if a.get("enabled", True)), agents[0])

    provider_name = (agent_data or {}).get("provider")
    model_name = (agent_data or {}).get("model")

    # With no agent defined (or no provider), pick automatically based on the text.
    if not provider_name:
        provider_name, model_name = _resolve_auto_llm(
            message=user_message,
            providers_cfg=providers,
            fallback_provider="groq",
            fallback_model=model_name,
        )

    llm = None
    if provider_name:
        p_cfg = providers.get(provider_name, {})
        key = resolve_provider_api_key(provider_name, p_cfg)
        llm = get_llm(
            provider=provider_name,
            model=model_name,
            api_key=key,
            base_url=p_cfg.get("base_url"),
            timeout=timeout,
        )

    if not llm:
        llm, provider_name, model_name = _get_hybrid_llm(timeout=timeout)
    if not llm:
        return None, None, None
    # The model actually instantiated (get_llm applies its own defaults when
    # model_name is None) — read it back so the usage ledger stays truthful.
    actual_model = getattr(llm, "model_name", None) or getattr(llm, "model", None) or model_name
    return llm, provider_name, str(actual_model) if actual_model else None


def generate_text(
    prompt: str,
    user_message: str = "",
    timeout: int = 60,
    agent_id: str = "",
    *,
    selector: Callable[..., tuple[BaseChatModel | None, str | None, str | None]] | None = None,
) -> tuple[str, str]:
    """One-shot call to the default LLM. Returns (text, model_label).

    Raises RuntimeError if no AI provider is available, so that the
    caller can gracefully degrade (HTTP 503 / reminder without an agenda).

    """
    from langchain_core.messages import HumanMessage

    select_llm = selector or get_default_llm_with_meta
    if agent_id:
        llm, provider_name, model_name = select_llm(
            user_message=user_message or prompt[:200],
            timeout=timeout,
            agent_id=agent_id,
        )
    else:
        llm, provider_name, model_name = select_llm(
            user_message=user_message or prompt[:200],
            timeout=timeout,
        )
    if not llm:
        raise RuntimeError("No AI provider available")
    # The timeout already lives in the client (get_default_llm→get_llm). Do NOT pass
    # config={"timeout": ...}: langchain ignores it (it's not a RunnableConfig key).
    resp = llm.invoke([HumanMessage(content=prompt)])
    text = getattr(resp, "content", "") or ""
    if not isinstance(text, str):
        text = str(text)

    # Feed the spend ledger (best-effort, never breaks the response)
    from backend.agent.model_router import record_llm_usage, usage_from_message

    usage = usage_from_message(resp)
    if usage:
        record_llm_usage(provider_name, model_name, usage[0], usage[1])

    label = getattr(llm, "model_name", None) or getattr(llm, "model", None) or "ai"
    return text, str(label)


def _is_local_provider(provider: str) -> bool:
    from backend.services.agent_model_strategy import is_local_provider

    return is_local_provider(provider) or str(provider or "").strip().lower() == "llama.cpp"


def _create_fallback_candidate(
    name: str,
    model: str,
    config: dict[str, Any],
    timeout: int,
    create_llm: Callable[..., Any],
) -> tuple[str, str, Any] | None:
    candidate = create_llm(
        provider=name,
        model=model,
        api_key=resolve_provider_api_key(name, config),
        base_url=config.get("base_url"),
        timeout=timeout,
    )
    return (name, model, candidate) if candidate is not None else None


def _allowed_route_fallbacks(
    routes: Iterable[dict[str, str]],
    providers: dict[str, Any],
    primary_local: bool,
    timeout: int,
    create_llm: Callable[..., Any],
) -> list[tuple[str, str, Any]]:
    candidates: list[tuple[str, str, Any]] = []
    for route in routes:
        if not isinstance(route, dict):
            continue
        name = str(route.get("provider") or "").strip().lower()
        model = str(route.get("model") or "").strip()
        config = dict((providers or {}).get(name) or {})
        if (
            not name
            or not model
            or not config.get("enabled", True)
            or _is_local_provider(name) != primary_local
        ):
            continue
        candidate = _create_fallback_candidate(
            name,
            model,
            config,
            timeout,
            create_llm,
        )
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def _configured_fallback_models(name: str, config: dict[str, Any]) -> list[Any]:
    models = config.get("fallback_models") or config.get("models") or []
    if not models:
        models = {
            "openai": ["gpt-4o-mini"],
            "anthropic": ["claude-haiku-4-5"],
            "groq": ["llama-3.1-8b-instant"],
            "deepseek": ["deepseek-chat"],
            "mistral": ["mistral-small-latest"],
            "openrouter": ["openai/gpt-4o-mini"],
            "ollama": ["llama3.2:latest"],
        }.get(name, [])
    return [models] if isinstance(models, str) else list(models)


def _configured_provider_fallbacks(
    primary_provider: str,
    providers: dict[str, Any],
    primary_local: bool,
    timeout: int,
    create_llm: Callable[..., Any],
) -> list[tuple[str, str, Any]]:
    candidates: list[tuple[str, str, Any]] = []
    primary_name = str(primary_provider or "").strip().lower()
    for raw_name, raw_config in (providers or {}).items():
        name = str(raw_name or "").strip().lower()
        config = dict(raw_config or {}) if isinstance(raw_config, dict) else {}
        if name == primary_name or not config.get("enabled", True):
            continue
        if _is_local_provider(name) != primary_local:
            continue
        for raw_model in _configured_fallback_models(name, config):
            model = str(raw_model or "").strip()
            if not model:
                continue
            candidate = _create_fallback_candidate(
                name,
                model,
                config,
                timeout,
                create_llm,
            )
            if candidate is not None:
                candidates.append(candidate)
    return candidates


def _provider_fallbacks(
    primary_provider: str,
    primary_model: str,
    providers: dict[str, Any],
    *,
    timeout: int,
    allowed_routes: Iterable[dict[str, str]] | None = None,
    llm_factory: Callable[..., Any] | None = None,
) -> list[tuple[str, str, Any]]:
    """Build same-trust fallback candidates from explicitly configured providers."""
    create_llm = llm_factory or get_llm
    primary_local = _is_local_provider(primary_provider)
    if allowed_routes is not None:
        return _allowed_route_fallbacks(
            allowed_routes,
            providers,
            primary_local,
            timeout,
            create_llm,
        )
    return _configured_provider_fallbacks(
        primary_provider,
        providers,
        primary_local,
        timeout,
        create_llm,
    )
