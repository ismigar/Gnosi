"""Compatibility exports for the agent-domain stream protocol."""

from __future__ import annotations

from backend.domains.agent.stream_protocol import (
    _ACTIVE_PRODUCERS,
    MAX_STREAM_EVENT_BYTES,
    STREAM_HEARTBEAT_SECONDS,
    STREAM_PROTOCOL_VERSION,
    encode_event,
    protocolize_stream,
)

__all__ = [
    "MAX_STREAM_EVENT_BYTES",
    "STREAM_HEARTBEAT_SECONDS",
    "STREAM_PROTOCOL_VERSION",
    "_ACTIVE_PRODUCERS",
    "encode_event",
    "protocolize_stream",
]
