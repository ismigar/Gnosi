"""Cooperative cancellation for streamed agent turns.

Only an opaque token is stored in graph state. The explicit cancel endpoint
marks the in-process event; an accidental client disconnect leaves the bounded
producer running so it can be resumed without repeating work.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import hashlib
import threading
import time
import uuid
from typing import Any, Awaitable


_LOCK = threading.RLock()
_TOKENS: dict[str, tuple[threading.Event, float]] = {}
_STREAMS: dict[str, tuple[str, str]] = {}
_TTL_SECONDS = 180.0
_ASYNC_LOOP_LOCK = threading.Lock()
_ASYNC_LOOP: asyncio.AbstractEventLoop | None = None
_ASYNC_LOOP_THREAD: threading.Thread | None = None


class AgentTurnCancelled(RuntimeError):
    """Raised when an in-flight model operation is cancelled by the client."""


def _prune(now: float) -> None:
    for token, (_event, expires_at) in list(_TOKENS.items()):
        if expires_at <= now:
            _TOKENS.pop(token, None)
            for stream_id, (bound_token, _scope) in list(_STREAMS.items()):
                if bound_token == token:
                    _STREAMS.pop(stream_id, None)


def _scope_digest(scope: dict[str, Any]) -> str:
    values = [
        str(scope.get(key) or "")
        for key in ("workspace_id", "user_id", "agent_id", "session_id")
    ]
    return hashlib.sha256("\0".join(values).encode("utf-8")).hexdigest()


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


def bind_stream(token: str, stream_id: str, scope: dict[str, Any]) -> None:
    """Bind an opaque public stream id to one request cancellation token."""
    with _LOCK:
        if token not in _TOKENS:
            raise ValueError("Unknown agent cancellation token.")
        _STREAMS[str(stream_id)[:128]] = (token, _scope_digest(scope))


def cancel_stream(stream_id: str, scope: dict[str, Any]) -> bool:
    """Cancel a stream only when the exact authenticated scope matches."""
    with _LOCK:
        binding = _STREAMS.get(str(stream_id or ""))
        if not binding or binding[1] != _scope_digest(scope):
            return False
        item = _TOKENS.get(binding[0])
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
        for stream_id, (bound_token, _scope) in list(_STREAMS.items()):
            if bound_token == str(token or ""):
                _STREAMS.pop(stream_id, None)


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


def _persistent_async_loop() -> asyncio.AbstractEventLoop:
    """Return the process-wide loop used by reusable async provider clients.

    OpenAI-compatible clients retain an async HTTP connection pool after their
    first request. Running the same model through a fresh ``asyncio.run`` loop
    on every graph node leaves that pool bound to a closed loop on the next
    turn. A daemon loop gives reusable clients one stable async owner while the
    synchronous LangGraph node waits cooperatively in its worker thread.
    """
    global _ASYNC_LOOP, _ASYNC_LOOP_THREAD
    with _ASYNC_LOOP_LOCK:
        if (
            _ASYNC_LOOP is not None
            and _ASYNC_LOOP.is_running()
            and _ASYNC_LOOP_THREAD is not None
            and _ASYNC_LOOP_THREAD.is_alive()
        ):
            return _ASYNC_LOOP

        ready = threading.Event()
        loop = asyncio.new_event_loop()

        def run_loop() -> None:
            asyncio.set_event_loop(loop)
            ready.set()
            loop.run_forever()

        thread = threading.Thread(
            target=run_loop,
            name="gnosi-agent-provider-loop",
            daemon=True,
        )
        _ASYNC_LOOP = loop
        _ASYNC_LOOP_THREAD = thread
        thread.start()
        ready.wait(timeout=2.0)
        if not loop.is_running():
            raise RuntimeError("The agent provider event loop did not start.")
        return loop


def invoke_cancellable(model: Any, prompt: Any, token: str, **kwargs: Any) -> Any:
    """Run a sync graph node with an abortable provider task.

    LangGraph's sync nodes run outside the request event loop. Providers that
    expose ``ainvoke`` get true task cancellation; simple test doubles and
    legacy providers run in a worker, where cancellation still returns control
    to the graph immediately and prevents subsequent calls.
    """
    if not token:
        return model.invoke(prompt, **kwargs)

    if not callable(getattr(model, "ainvoke", None)):
        return model.invoke(prompt, **kwargs)

    operation = model.ainvoke(prompt, **kwargs)
    future = asyncio.run_coroutine_threadsafe(operation, _persistent_async_loop())
    while True:
        if is_cancelled(token):
            future.cancel()
            raise AgentTurnCancelled("agent_turn_cancelled")
        try:
            return future.result(timeout=0.05)
        except concurrent.futures.TimeoutError:
            continue
