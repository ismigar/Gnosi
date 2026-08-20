"""Versioned, bounded protocol for streamed agent events.

The graph still emits the historical newline-delimited payloads.  This module
wraps them at the transport boundary so old producers remain compatible while
clients receive stable correlation, ordering, heartbeat, and recovery fields.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import AsyncIterator
from typing import Any


STREAM_PROTOCOL_VERSION = 1
STREAM_HEARTBEAT_SECONDS = 15.0
MAX_STREAM_EVENT_BYTES = 64 * 1024


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
        # Never truncate JSON text. Keep the envelope valid and make the
        # limitation explicit; content itself is already bounded upstream.
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


async def protocolize_stream(
    source: AsyncIterator[str],
    *,
    stream_id: str,
    trace_id: str,
    turn_id: str = "",
    heartbeat_seconds: float = STREAM_HEARTBEAT_SECONDS,
) -> AsyncIterator[str]:
    """Wrap a legacy NDJSON stream and emit heartbeats while it is quiet.

    A pending ``anext`` task is deliberately kept alive when a heartbeat is
    sent. Cancelling a provider-backed graph at the heartbeat boundary would
    turn a healthy slow model call into a false timeout.
    """
    sequence = 0
    terminal_seen = False
    source_iterator = source.__aiter__()

    def wrapped(payload: dict[str, Any]) -> str:
        nonlocal sequence, terminal_seen
        sequence += 1
        terminal_seen = terminal_seen or payload.get("type") == "done"
        return encode_event(
            payload,
            stream_id=stream_id,
            trace_id=trace_id,
            turn_id=turn_id,
            sequence=sequence,
        )

    yield wrapped(
        {
            "type": "stream_open",
            "resume_supported": False,
            "heartbeat_seconds": max(1, int(heartbeat_seconds)),
        }
    )
    pending: asyncio.Task[str] | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.create_task(source_iterator.__anext__())
            done, _ = await asyncio.wait(
                {pending},
                timeout=max(1.0, float(heartbeat_seconds)),
            )
            if not done:
                yield wrapped({"type": "heartbeat", "server_time": time.time()})
                continue
            try:
                raw = pending.result()
            except StopAsyncIteration:
                break
            finally:
                pending = None
            for line in str(raw or "").splitlines():
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except (TypeError, ValueError):
                    yield wrapped(
                        {
                            "type": "error",
                            "code": "stream_protocol_error",
                            "content": "The agent returned an invalid stream event.",
                            "retryable": True,
                        }
                    )
                    continue
                if isinstance(payload, dict):
                    yield wrapped(payload)
    finally:
        if pending is not None and not pending.done():
            # The response was cancelled by the client. Let the source finish
            # its own cancellation/finally path without leaking a task.
            pending.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pending
    if not terminal_seen:
        yield wrapped(
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
        yield wrapped({"type": "done", "has_response": False, "message_count": 0})
