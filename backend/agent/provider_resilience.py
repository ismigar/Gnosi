"""Provider failover that is safe for cached, request-independent workflows."""

from __future__ import annotations

import logging
from typing import Any, Iterable


log = logging.getLogger(__name__)


def is_retryable_provider_error(error: BaseException) -> bool:
    """Classify transport/transient failures, never auth or content failures."""
    if isinstance(error, (TimeoutError, ConnectionError, OSError)):
        return True
    text = str(error or "").lower()
    if any(marker in text for marker in ("401", "403", "invalid api", "authentication", "content filter", "policy")):
        return False
    return any(marker in text for marker in ("429", "500", "502", "503", "504", "timeout", "timed out", "temporarily unavailable", "connection reset"))


def _model_label(model: Any) -> str:
    return str(getattr(model, "model_name", None) or getattr(model, "model", None) or "ai")


class ProviderFallbackModel:
    """A small Runnable-compatible proxy that tries equivalent candidates."""

    def __init__(self, candidates: Iterable[tuple[str, str, Any]]) -> None:
        self._candidates = [(str(p), str(m), model) for p, m, model in candidates if model is not None]
        if not self._candidates:
            raise ValueError("at least one provider candidate is required")
        self.fallback_events: list[dict[str, str]] = []
        self.model_name = self._candidates[0][1]
        self.model = self.model_name

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        last: BaseException | None = None
        for index, (provider, model_name, candidate) in enumerate(self._candidates):
            try:
                response = candidate.invoke(input, config=config, **kwargs) if config is not None else candidate.invoke(input, **kwargs)
                if index:
                    metadata = getattr(response, "additional_kwargs", None)
                    if not isinstance(metadata, dict):
                        metadata = {}
                    metadata["gnosi_provider_fallback"] = {
                        "from": self._candidates[0][0],
                        "to": provider,
                        "model": model_name,
                        "reason": type(last).__name__ if last else "transient_error",
                    }
                    try:
                        response.additional_kwargs = metadata
                    except Exception:  # pragma: no cover - provider message may be immutable
                        pass
                return response
            except Exception as error:  # noqa: BLE001
                last = error
                if not is_retryable_provider_error(error) or index == len(self._candidates) - 1:
                    raise
                self.fallback_events.append({
                    "from": provider,
                    "to": self._candidates[index + 1][0],
                    "model": self._candidates[index + 1][1],
                    "reason": type(error).__name__,
                })
                log.warning("Provider %s/%s failed transiently; trying %s/%s", provider, model_name, self._candidates[index + 1][0], self._candidates[index + 1][1])
        raise last or RuntimeError("all provider candidates failed")

    def bind_tools(self, tools: Any, **kwargs: Any) -> "ProviderFallbackModel":
        bound: list[tuple[str, str, Any]] = []
        for provider, model_name, candidate in self._candidates:
            try:
                bound.append((provider, model_name, candidate.bind_tools(tools, **kwargs)))
            except Exception as error:  # noqa: BLE001
                if not is_retryable_provider_error(error):
                    raise
                log.warning("Provider %s/%s could not bind tools; excluding it", provider, model_name)
        return ProviderFallbackModel(bound or [(self._candidates[0][0], self._candidates[0][1], self._candidates[0][2])])

    def __getattr__(self, name: str) -> Any:
        return getattr(self._candidates[0][2], name)


def wrap_provider_candidates(primary: tuple[str, str, Any], fallbacks: Iterable[tuple[str, str, Any]]) -> ProviderFallbackModel:
    """Create a proxy while preserving the configured primary candidate first."""
    return ProviderFallbackModel([primary, *list(fallbacks)])
