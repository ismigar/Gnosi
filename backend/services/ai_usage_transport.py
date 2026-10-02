"""Observe raw provider responses before LangChain/tool output conversion."""
from __future__ import annotations

import inspect
import logging
import threading
import time
from contextvars import ContextVar
from decimal import Decimal
from typing import Any, AsyncIterator, Iterator

from langchain_core.callbacks import BaseCallbackHandler

from backend.services import ai_usage_ledger as ledger

log = logging.getLogger(__name__)
_active: ContextVar[dict[str, Any] | None] = ContextVar("ai_usage_call", default=None)


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return value.model_dump() if callable(getattr(value, "model_dump", None)) else {}


def observe(value: Any) -> None:
    state = _active.get()
    if state is None:
        return
    payload = _mapping(value)
    response = _mapping(payload.get("response")) or payload
    usage = _mapping(response.get("usage"))
    if usage:
        state["raw_usage"] = usage
        state["actual_model"] = str(response.get("model") or state["model"])


class ObservedStream:
    def __init__(self, stream: Any) -> None:
        self.stream = stream
    def __iter__(self) -> Iterator[Any]:
        for value in self.stream:
            observe(value)
            yield value
    async def __aiter__(self) -> AsyncIterator[Any]:
        async for value in self.stream:
            observe(value)
            yield value
    def __enter__(self) -> ObservedStream:
        self.stream.__enter__()
        return self
    def __exit__(self, *args: Any) -> Any:
        return self.stream.__exit__(*args)
    async def __aenter__(self) -> ObservedStream:
        await self.stream.__aenter__()
        return self
    async def __aexit__(self, *args: Any) -> Any:
        return await self.stream.__aexit__(*args)
    def __getattr__(self, name: str) -> Any:
        return getattr(self.stream, name)


def _observed_result(value: Any) -> Any:
    observe(value)
    if not isinstance(value, (dict, str)) and not hasattr(value, "model_dump") and (hasattr(value, "__iter__") or hasattr(value, "__aiter__")):
        return ObservedStream(value)
    return value


class ObservedResource:
    """Preserve the SDK surface, including raw-response parse and streams."""
    def __init__(self, resource: Any) -> None:
        self.resource = resource
    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self.resource, name)
        if name in {"with_raw_response", "with_streaming_response"}:
            return ObservedResource(attribute)
        if name not in {"create", "parse", "stream"} or not callable(attribute):
            return attribute
        def call(*args: Any, **kwargs: Any) -> Any:
            result = attribute(*args, **kwargs)
            if inspect.isawaitable(result):
                async def finish() -> Any:
                    return _observed_result(await result)
                return finish()
            if callable(getattr(result, "parse", None)) and not hasattr(result, "model_dump"):
                raw_response = getattr(result, "http_response", None)
                if raw_response is not None and getattr(raw_response, "is_stream_consumed", False):
                    try:
                        observe(raw_response.json())
                    except (ValueError, RuntimeError):
                        pass
                return ObservedResource(result)
            return _observed_result(result)
        return call


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def normalize(usage: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    input_details = _mapping(usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or metadata.get("input_token_details"))
    output_details = _mapping(usage.get("completion_tokens_details") or usage.get("output_tokens_details") or metadata.get("output_token_details"))
    return {
        "input_tokens": _count(usage.get("prompt_tokens", usage.get("input_tokens", metadata.get("input_tokens")))),
        "output_tokens": _count(usage.get("completion_tokens", usage.get("output_tokens", metadata.get("output_tokens")))),
        "cached_tokens": _count(input_details.get("cached_tokens", input_details.get("cache_read"))),
        "reasoning_tokens": _count(output_details.get("reasoning_tokens", output_details.get("reasoning"))),
    }


def price(provider: str, model: str, tokens: dict[str, Any], raw: dict[str, Any], rates: dict[str, Any] | None) -> tuple[Decimal | None, str]:
    reported = ledger.decimal_cost(raw.get("cost"))
    if reported is not None:
        return reported, "reported"
    if provider in {"ollama", "local", "lmstudio", "llama-cpp", "llama.cpp"}:
        return Decimal(0), "local"
    if rates is not None and tokens["input_tokens"] is not None and tokens["output_tokens"] is not None:
        value = (Decimal(tokens["input_tokens"]) * Decimal(str(rates["cost_in"])) + Decimal(tokens["output_tokens"]) * Decimal(str(rates["cost_out"]))) / Decimal(1_000_000)
        return value, "estimated"
    return None, "unknown"


class UsageCallback(BaseCallbackHandler):
    run_inline = True
    def __init__(self, provider: str, model: str) -> None:
        self.provider, self.model = provider, model
        self.pending: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
    def on_chat_model_start(self, serialized: Any, messages: Any, *, run_id: Any, **kwargs: Any) -> None:
        state: dict[str, Any] = {"id": str(run_id), "provider": self.provider, "model": self.model, "started": time.time(), "attribution": ledger.context_metadata(), "raw_usage": {}}
        try:
            from backend.agent.model_catalog import catalog_model_cost
            from backend.agent.model_router import load_registry
            rates = catalog_model_cost(self.provider, self.model)
            registry = load_registry(with_catalog_prices=False)
            row = next((r for r in registry if r.get("provider") == self.provider and r.get("model_id") == self.model), {})
            if rates is None and "cost_in" in row and "cost_out" in row and (row["cost_in"] or row["cost_out"] or row.get("is_free")):
                rates = {"cost_in": row["cost_in"], "cost_out": row["cost_out"]}
            state["rates"] = rates
            profile = row.get("profile")
            if not profile:
                from backend.services.artificial_analysis import _read_cache
                cached = _read_cache() or {}
                profile = next((item.get("profile") for item in cached.get("models", [])
                    if any(route.get("provider") == self.provider and route.get("model_id") == self.model
                           for route in item.get("routes", []))), None)
            state["attribution"]["profile"] = str(profile or "unrated")
        except Exception:
            state["rates"] = None
        with self.lock:
            self.pending[str(run_id)] = state
        _active.set(state)
    def _finish(self, run_id: Any, result: Any = None, error: Any = None) -> None:
        with self.lock:
            state = self.pending.pop(str(run_id), None)
        if state is None:
            return
        try:
            messages = [g.message for group in getattr(result, "generations", []) for g in group if hasattr(g, "message")]
            message = messages[0] if messages else None
            metadata = getattr(message, "usage_metadata", None) or {}
            raw = state["raw_usage"] or _mapping(getattr(result, "llm_output", None)).get("token_usage") or _mapping(getattr(message, "response_metadata", None)).get("token_usage") or {}
            tokens = normalize(raw, metadata)
            model = state.get("actual_model") or self.model
            # Estimates use the route's tariff frozen at invocation time, never
            # a native vendor's tariff inferred from an OpenRouter model prefix.
            cost, source = price(self.provider, model, tokens, raw, state.get("rates"))
            added = ledger.write_call(provider=self.provider, model_id=model, **tokens,
                cost_usd=cost, cost_source=source, call_id=state["id"], created=state["started"],
                duration_ms=(time.time() - state["started"]) * 1000,
                status="cancelled" if isinstance(error, BaseException) and (type(error).__name__ in {"CancelledError", "AgentTurnCancelled"}) else "failed" if error is not None else "completed",
                metadata=state["attribution"])
            for item in messages:
                item.additional_kwargs["gnosi_usage_recorded"] = True
            if added and state["attribution"]["run_id"] and tokens["input_tokens"] is not None:
                from backend.services.agent_execution_scope import current_scope
                from backend.services.agent_execution_store import increment_usage
                increment_usage(current_scope(), state["attribution"]["run_id"], self.provider, model, tokens["input_tokens"], tokens["output_tokens"] or 0)
        except Exception:
            log.exception("Could not persist model usage metadata")
        finally:
            if _active.get() is state:
                _active.set(None)
    def on_llm_end(self, response: Any, *, run_id: Any, **kwargs: Any) -> None:
        self._finish(run_id, response)
    def on_llm_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        self._finish(run_id, result=kwargs.get("response"), error=error)


def instrument(model: Any, provider: str, model_id: str | None) -> Any:
    from langchain_core.language_models import BaseChatModel
    if not isinstance(model, BaseChatModel):
        return model
    actual = str(getattr(model, "model_name", None) or getattr(model, "model", None) or model_id or "")
    callback = UsageCallback(provider, actual)
    if model.callbacks is not None and not isinstance(model.callbacks, list):
        manager = model.callbacks.copy()
        manager.add_handler(callback, inherit=True)
        model.callbacks = manager
    else:
        model.callbacks = [*(model.callbacks or []), callback]
    if hasattr(model, "stream_usage"):
        model.stream_usage = True
    for field in ("client", "async_client"):
        client = getattr(model, field, None)
        if client is not None and hasattr(client, "create"):
            setattr(model, field, ObservedResource(client))
    for field in ("root_client", "root_async_client"):
        client = getattr(model, field, None)
        if client is not None and hasattr(client, "responses"):
            client.responses = ObservedResource(client.responses)
        if client is not None and hasattr(client, "chat"):
            client.chat.completions = ObservedResource(client.chat.completions)
    return model
