"""Cooperative cancellation for streamed agent turns.

Only an opaque token is stored in graph state.  The event stream owns the
in-process event and marks it when the client disconnects; cached workflows can
therefore remain shared safely between requests.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
import time
import uuid
from typing import Any, Awaitable


_LOCK = threading.RLock()
_TOKENS: dict[str, tuple[threading.Event, float]] = {}
_TTL_SECONDS = 180.0


class AgentTurnCancelled(RuntimeError):
    """Raised when an in-flight model operation is cancelled by the client."""


def _prune(now: float) -> None:
    for token, (_event, expires_at) in list(_TOKENS.items()):
        if expires_at <= now:
            _TOKENS.pop(token, None)


def create_cancel_token() -> str:
    """Create a request-scoped cancellation token."""
    token = uuid.uuid4().hex
    with _LOCK:
        now = time.monotonic()
        _prune(now)
        _TOKENS[token] = (threading.Event(), now + _TTL_SECONDS)
    return token


def cancel(token: str) -> bool:
    """Signal cancellation; return whether the token was known."""
    with _LOCK:
        item = _TOKENS.get(str(token or ""))
        if not item:
            return False
        item[0].set()
        return True


def is_cancelled(token: str) -> bool:
    """Read the cancellation signal without leaking the event into checkpoints."""
    if not token:
        return False
    with _LOCK:
        item = _TOKENS.get(str(token))
        return bool(item and item[0].is_set())


def release(token: str) -> None:
    """Release a completed token."""
    with _LOCK:
        _TOKENS.pop(str(token or ""), None)


async def await_with_cancellation(
    operation: Awaitable[Any],
    token: str,
    *,
    poll_seconds: float = 0.05,
) -> Any:
    """Await an operation and cancel its task as soon as the client disconnects."""
    task = asyncio.create_task(operation)
    try:
        while not task.done():
            if is_cancelled(token):
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                raise AgentTurnCancelled("agent_turn_cancelled")
            await asyncio.sleep(max(0.01, poll_seconds))
        return await task
    except asyncio.CancelledError:
        task.cancel()
        raise


def invoke_cancellable(model: Any, prompt: Any, token: str, **kwargs: Any) -> Any:
    """Run a sync graph node with an abortable provider task.

    LangGraph's sync nodes run outside the request event loop. Providers that
    expose ``ainvoke`` get true task cancellation; simple test doubles and
    legacy providers run in a worker, where cancellation still returns control
    to the graph immediately and prevents subsequent calls.
    """
    if not token:
        return model.invoke(prompt, **kwargs)

    async def _run() -> Any:
        if callable(getattr(model, "ainvoke", None)):
            operation = model.ainvoke(prompt, **kwargs)
        else:
            operation = asyncio.to_thread(model.invoke, prompt, **kwargs)
        return await await_with_cancellation(operation, token)

    try:
        return asyncio.run(_run())
    except RuntimeError as error:
        if "cannot be called from a running event loop" not in str(error):
            raise
        # A defensive fallback for custom LangGraph executors that invoke a
        # sync node on an event-loop thread. The normal path is a worker thread.
        return model.invoke(prompt, **kwargs)
