"""Bounded execution helpers for user-triggered mail analysis."""

from __future__ import annotations

import asyncio


async def request_entity_analysis(prompt: str) -> tuple[str, str]:
    """Run provider fallback off the event loop with viewer-safe time bounds."""
    from pipeline.ai_client import call_ai_with_fallback

    return await asyncio.to_thread(
        call_ai_with_fallback,
        prompt,
        timeout_primary=20,
        timeout_fallback=30,
        max_chars_primary=6000,
    )
