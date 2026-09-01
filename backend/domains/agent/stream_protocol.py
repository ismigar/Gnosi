"""Versioned, bounded protocol for streamed agent events."""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Any

STREAM_PROTOCOL_VERSION = 1
STREAM_HEARTBEAT_SECONDS = 15.0
MAX_STREAM_EVENT_BYTES = 64 * 1024
_ACTIVE_PRODUCERS: set[asyncio.Task[Any]] = set()


def encode_event(
    payload: dict[str, Any],
    *,
    stream_id: str,
    trace_id: str,
    turn_id: str = "",
    sequence: int,
) -> str:
    """Encode one bounded event with a stable ordering envelope."""
    event = dict(payload)
    event_type = str(event.get("type") or "message")[:48]
    event.update(
        {
            "protocol_version": STREAM_PROTOCOL_VERSION,
            "stream_id": str(stream_id or "")[:128],
            "event_id": f"{stream_id}:{sequence}",
            "sequence": int(sequence),
            "type": event_type,
            "trace_id": str(event.get("trace_id") or trace_id or "")[:128],
        }
    )
    if turn_id:
        event["turn_id"] = str(turn_id)[:128]
    encoded = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_STREAM_EVENT_BYTES:
        encoded = json.dumps(
            {
                "protocol_version": STREAM_PROTOCOL_VERSION,
                "stream_id": str(stream_id or "")[:128],
                "event_id": f"{stream_id}:{sequence}",
                "sequence": int(sequence),
                "type": "error",
                "trace_id": str(trace_id or "")[:128],
                "turn_id": str(turn_id or "")[:128],
                "code": "stream_event_too_large",
                "content": "The agent returned an oversized stream event.",
                "retryable": False,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    return encoded + "\n"


@dataclass
class _StreamEnvelope:
    stream_id: str
    trace_id: str
    turn_id: str
    sequence: int = 0
    terminal_seen: bool = False

    def wrap(self, payload: dict[str, Any]) -> str:
        self.sequence += 1
        self.terminal_seen = self.terminal_seen or payload.get("type") == "done"
        return encode_event(
            payload,
            stream_id=self.stream_id,
            trace_id=self.trace_id,
            turn_id=self.turn_id,
            sequence=self.sequence,
        )


def _decoded_stream_payloads(raw: str) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for line in str(raw or "").splitlines():
        if not line.strip():
            continue
        try:
            loaded = json.loads(line)
        except (TypeError, ValueError):
            payloads.append(
                {
                    "type": "error",
                    "code": "stream_protocol_error",
                    "content": "The agent returned an invalid stream event.",
                    "retryable": True,
                }
            )
            continue
        if isinstance(loaded, dict):
            payloads.append(dict(loaded))
    return payloads


async def _journal_event(
    encoded: str,
    *,
    stream_id: str,
    digest: str,
) -> str:
    from backend.services.agent_stream_journal import append

    payload: dict[str, Any] = {}
    try:
        loaded = json.loads(encoded)
        payload = dict(loaded) if isinstance(loaded, dict) else {}
        if payload.get("type") == "stream_open":
            payload["resume_supported"] = True
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
        sequence_value = int(payload.get("sequence") or 0)
        await asyncio.to_thread(append, stream_id, digest, sequence_value, encoded)
    except Exception:  # noqa: BLE001
        if payload.get("type") == "stream_open":
            payload["resume_supported"] = False
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    return encoded


def _observe_producer(task: asyncio.Task[Any]) -> None:
    _ACTIVE_PRODUCERS.add(task)

    def producer_done(completed: asyncio.Task[Any]) -> None:
        _ACTIVE_PRODUCERS.discard(completed)
        with contextlib.suppress(asyncio.CancelledError):
            completed.exception()

    task.add_done_callback(producer_done)


async def _protocolize_journaled_stream(
    source: AsyncIterator[str],
    *,
    stream_id: str,
    trace_id: str,
    turn_id: str,
    heartbeat_seconds: float,
    journal_scope: Mapping[str, Any],
) -> AsyncIterator[str]:
    from backend.services.agent_stream_journal import scope_digest

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    subscriber_open = True
    digest = str(scope_digest(journal_scope))

    async def produce() -> None:
        try:
            async for encoded in _protocolize_live_stream(
                source,
                stream_id=stream_id,
                trace_id=trace_id,
                turn_id=turn_id,
                heartbeat_seconds=heartbeat_seconds,
            ):
                persisted = await _journal_event(
                    encoded,
                    stream_id=stream_id,
                    digest=digest,
                )
                if subscriber_open:
                    queue.put_nowait(persisted)
        finally:
            if subscriber_open:
                queue.put_nowait(None)

    _observe_producer(asyncio.create_task(produce()))
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        subscriber_open = False


async def _protocolize_live_stream(
    source: AsyncIterator[str],
    *,
    stream_id: str,
    trace_id: str,
    turn_id: str,
    heartbeat_seconds: float,
) -> AsyncIterator[str]:
    envelope = _StreamEnvelope(stream_id, trace_id, turn_id)
    source_iterator = source.__aiter__()
    yield envelope.wrap(
        {
            "type": "stream_open",
            "resume_supported": False,
            "heartbeat_seconds": max(1, int(heartbeat_seconds)),
        }
    )
    pending: asyncio.Future[str] | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(source_iterator.__anext__())
            done, _ = await asyncio.wait(
                {pending},
                timeout=max(1.0, float(heartbeat_seconds)),
            )
            if not done:
                yield envelope.wrap({"type": "heartbeat", "server_time": time.time()})
                continue
            try:
                raw = pending.result()
            except StopAsyncIteration:
                break
            finally:
                pending = None
            for payload in _decoded_stream_payloads(raw):
                yield envelope.wrap(payload)
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pending
    if not envelope.terminal_seen:
        yield envelope.wrap(
            {
                "type": "error",
                "code": "stream_incomplete",
                "content": "The agent stream ended before a final response.",
                "retryable": True,
                "recovery": {
                    "retryable": True,
                    "action": "retry_message",
                    "automatic": False,
                    "max_attempts": 1,
                },
            }
        )
        yield envelope.wrap({"type": "done", "has_response": False, "message_count": 0})


async def protocolize_stream(
    source: AsyncIterator[str],
    *,
    stream_id: str,
    trace_id: str,
    turn_id: str = "",
    heartbeat_seconds: float = STREAM_HEARTBEAT_SECONDS,
    journal_scope: Mapping[str, Any] | None = None,
) -> AsyncIterator[str]:
    """Wrap a legacy NDJSON stream and emit heartbeats while it is quiet.

    A pending source task is deliberately kept alive when a heartbeat is sent.
    Cancelling a provider-backed graph at the heartbeat boundary would turn a
    healthy slow model call into a false timeout.
    """
    if journal_scope:
        async for encoded in _protocolize_journaled_stream(
            source,
            stream_id=stream_id,
            trace_id=trace_id,
            turn_id=turn_id,
            heartbeat_seconds=heartbeat_seconds,
            journal_scope=journal_scope,
        ):
            yield encoded
        return
    async for encoded in _protocolize_live_stream(
        source,
        stream_id=stream_id,
        trace_id=trace_id,
        turn_id=turn_id,
        heartbeat_seconds=heartbeat_seconds,
    ):
        yield encoded
