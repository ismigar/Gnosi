"""Synthetic regressions for mail preview responsiveness and inline assets."""

from __future__ import annotations

import asyncio
import threading

import pytest

# Import the public route aggregator first, matching application startup.  A
# direct schemas-first import bypasses the normal model initialization order.
from backend.api import mail_routes as _mail_routes  # noqa: F401
from backend.domains.mail import schemas
from backend.domains.mail.cache import (
    _INLINE_PARTS_CACHE,
    _set_cached_inline_parts,
)
from backend.domains.mail.routes import compose
from backend.domains.mail.services.attachments import _collect_original_inline_parts
from backend.services import integration_manager as integration_module


def test_entity_analysis_runs_provider_off_the_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    caller_thread = threading.get_ident()
    provider_threads: list[int] = []

    def fake_provider(_prompt: str, **options: int) -> tuple[str, str]:
        provider_threads.append(threading.get_ident())
        assert options == {
            "timeout_primary": 20,
            "timeout_fallback": 30,
            "max_chars_primary": 6000,
        }
        return '{"events": [], "contacts": []}', "fixture"

    monkeypatch.setattr("pipeline.ai_client.call_ai_with_fallback", fake_provider)

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result == {"events": [], "contacts": [], "provider": "fixture"}
    assert provider_threads and provider_threads[0] != caller_thread


def test_entity_analysis_returns_typed_error_when_providers_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failing_provider(_prompt: str, **_options: int) -> tuple[str, str]:
        raise RuntimeError("provider diagnostics must stay private")

    monkeypatch.setattr("pipeline.ai_client.call_ai_with_fallback", failing_provider)

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result == {
        "events": [],
        "contacts": [],
        "error": "Smart analysis is temporarily unavailable.",
    }


def test_inline_image_uses_detail_cache_without_a_second_provider_fetch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _INLINE_PARTS_CACHE.clear()
    image = {"data": b"png", "filename": "image.png", "content_type": "image/png"}
    _set_cached_inline_parts("reader@example.test", "imap_42", "INBOX", {"logo": image})

    def unexpected_provider_lookup(_email: str) -> None:
        raise AssertionError("cached inline image must not reacquire the IMAP connection")

    monkeypatch.setattr(
        integration_module.integration_manager,
        "get_mail_account",
        unexpected_provider_lookup,
    )

    result = asyncio.run(
        _collect_original_inline_parts(
            "reader@example.test",
            "imap_42",
            {"logo"},
            "INBOX",
        )
    )

    assert result == {"logo": image}
    _INLINE_PARTS_CACHE.clear()
