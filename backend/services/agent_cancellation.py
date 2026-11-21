"""Cooperative cancellation for streamed agent turns.

Only an opaque token is stored in graph state. The explicit cancel endpoint
marks the in-process event; an accidental client disconnect leaves the bounded
producer running so it can be resumed without repeating work.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import re
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable

from backend.services.agent_stream_journal import scope_digest


@dataclass
class _Registration:
    event: threading.Event
    expires_at: float
    owner: asyncio.Task[Any] | None


_LOCK = threading.RLock()
_TOKENS: dict[str, _Registration] = {}
_STREAMS: dict[tuple[str, str], str] = {}
# A Cancel POST can reach the server before the corresponding chat POST.
_PENDING: dict[tuple[str, str], float] = {}
_ATTEMPT_ID = re.compile(r"request-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
_MAX_PENDING = 4096
_TTL_SECONDS = 180.0
_ASYNC_LOOP_LOCK = threading.Lock()
_ASYNC_LOOP: asyncio.AbstractEventLoop | None = None
_ASYNC_LOOP_THREAD: threading.Thread | None = None


class AgentTurnCancelled(RuntimeError):
    """Raised when an in-flight model operation is cancelled by the client."""


def _prune(now: float) -> None:
    for token, registration in list(_TOKENS.items()):
        if registration.expires_at <= now and (registration.owner is None or registration.owner.done()):
            _TOKENS.pop(token, None)
            for stream_id, bound_token in list(_STREAMS.items()):
                if bound_token == token:
                    _STREAMS.pop(stream_id, None)
    for key, expiry in list(_PENDING.items()):
        if expiry <= now:
            _PENDING.pop(key, None)


def create_cancel_token(*, owner: asyncio.Task[Any] | None = None) -> str:
    """Create a request-scoped cancellation token."""
    token = uuid.uuid4().hex
    with _LOCK:
        now = time.monotonic()
        _prune(now)
        _TOKENS[token] = _Registration(threading.Event(), now + _TTL_SECONDS, owner)
    return token


def cancel(token: str) -> bool:
    """Signal cancellation; return whether the token was known."""
    with _LOCK:
        item = _TOKENS.get(str(token or ""))
        if not item:
            return False
        item.event.set()
        return True


def bind_stream(token: str, stream_id: str, scope: dict[str, Any]) -> bool:
    """Bind an opaque public stream id to one request cancellation token."""
    with _LOCK:
        if token not in _TOKENS:
            raise ValueError("Unknown agent cancellation token.")
        key = (scope_digest(scope), stream_id)
        if key in _STREAMS:
            return False
        _STREAMS[key] = token
        registration = _TOKENS[token]
        now = time.monotonic()
        registration.expires_at = now + _TTL_SECONDS
        if _PENDING.pop(key, 0) > now:
            registration.event.set()
        return True


def cancel_stream(stream_id: str, scope: dict[str, Any]) -> bool:
    """Cancel a stream only when the exact authenticated scope matches."""
    with _LOCK:
        key = (scope_digest(scope), stream_id)
        token = _STREAMS.get(key)
        if token:
            return cancel(token)
        if not _ATTEMPT_ID.fullmatch(stream_id):
            return False
        now = time.monotonic()
        _prune(now)
        if key not in _PENDING and len(_PENDING) >= _MAX_PENDING:
            return False
        _PENDING[key] = now + _TTL_SECONDS
        return True


def is_cancelled(token: str) -> bool:
    """Read the cancellation signal without leaking the event into checkpoints."""
    if not token:
        return False
    with _LOCK:
        item = _TOKENS.get(str(token))
        return bool(item and item.event.is_set())


def release(token: str) -> None:
    """Release a completed token."""
    with _LOCK:
        _TOKENS.pop(str(token or ""), None)
        for stream_id, bound_token in list(_STREAMS.items()):
            if bound_token == str(token or ""):
                _STREAMS.pop(stream_id, None)


async def await_with_cancellation(
    operation: Awaitable[Any],
    token: str,
    *,
    poll_seconds: float = 0.05,
) -> Any:
    """Await an operation and cancel its task as soon as the client disconnects."""
    task: asyncio.Future[Any] = asyncio.ensure_future(operation)
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

    if is_cancelled(token):
        raise AgentTurnCancelled("agent_turn_cancelled")

    if not callable(getattr(model, "ainvoke", None)):
        return model.invoke(prompt, **kwargs)

    with _LOCK:
        registration = _TOKENS.get(token)
        event = registration.event if registration else None
    operation = model.ainvoke(prompt, **kwargs)
    future = asyncio.run_coroutine_threadsafe(operation, _persistent_async_loop())
    while True:
        if event is not None and event.is_set():
            future.cancel()
            raise AgentTurnCancelled("agent_turn_cancelled")
        try:
            return future.result(timeout=0.05)
        except concurrent.futures.TimeoutError:
            # Future.result uses the same TimeoutError class as a provider.
            # A completed provider timeout is an error, not another poll tick.
            if future.done():
                return future.result()
            continue
