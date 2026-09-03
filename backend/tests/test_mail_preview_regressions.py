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
from backend.domains.mail.providers.hybrid import _imap_list_item
from backend.domains.mail.routes import compose
from backend.domains.mail.services import analysis
from backend.domains.mail.services.attachments import _collect_original_inline_parts
from backend.services import integration_manager as integration_module


def test_entity_analysis_runs_provider_off_the_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    caller_thread = threading.get_ident()
    provider_threads: list[int] = []

    def fake_provider(_prompt: str, **options: object) -> str:
        provider_threads.append(threading.get_ident())
        assert options == {
            "timeout": 8,
            "provider": "fixture",
            "use_cache": False,
        }
        return '{"events": [], "contacts": []}'

    monkeypatch.setattr("pipeline.ai_client.call_ai_client", fake_provider)
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result == {
        "events": [],
        "contacts": [],
        "provider": "fixture",
        "status": "complete",
        "provider_attempts": [{"provider": "fixture", "status": "success"}],
    }
    assert provider_threads and provider_threads[0] != caller_thread


def test_entity_analysis_returns_typed_error_when_providers_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failing_provider(_prompt: str, **_options: object) -> str:
        raise RuntimeError("provider diagnostics must stay private")

    monkeypatch.setattr("pipeline.ai_client.call_ai_client", failing_provider)
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr("pipeline.ai_client.PRIMARY_PROVIDER", "fixture")

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result["status"] == "degraded"
    assert result["degraded_reason"] == "providers_failed"
    assert result["provider_attempts"] == [
        {"provider": "fixture", "status": "unavailable"}
    ]
    assert result["local_analysis"]["summary"]["value"] == "fixture"


def test_entity_analysis_uses_literal_local_results_when_providers_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failing_provider(_prompt: str, **_options: object) -> str:
        raise RuntimeError("synthetic provider failure")

    monkeypatch.setattr("pipeline.ai_client.call_ai_client", failing_provider)
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr("pipeline.ai_client.PRIMARY_PROVIDER", "fixture")

    result = asyncio.run(
        compose.extract_entities(
            schemas.MailExtractEntitiesRequest(
                context="Contacte: Ada Lovelace <ada@example.test>"
            )
        )
    )

    assert result["events"] == []
    assert result["contacts"] == [
            {
                "name": "Ada Lovelace",
                "email": "ada@example.test",
                "phone": "",
                "company": "",
                "notes": "",
            }
        ]
    assert result["provider"] == "local_deterministic"
    assert result["status"] == "degraded"


def test_entity_analysis_reports_missing_configuration_without_provider_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: [])
    monkeypatch.setattr(
        "pipeline.ai_client.call_ai_with_fallback",
        lambda *_args, **_kwargs: pytest.fail("an unconfigured provider must not run"),
    )
    monkeypatch.setattr(
        "pipeline.ai_client.call_ai_client",
        lambda *_args, **_kwargs: pytest.fail("a direct provider must not run"),
    )

    result = asyncio.run(
        compose.extract_entities(
            schemas.MailExtractEntitiesRequest(
                context="Contacte: Ada Lovelace <ada@example.test>"
            )
        )
    )

    assert result["events"] == []
    assert result["contacts"] == [
            {
                "name": "Ada Lovelace",
                "email": "ada@example.test",
                "phone": "",
                "company": "",
                "notes": "",
            }
        ]
    assert result["provider"] == "local_deterministic"
    assert result["status"] == "degraded"
    assert result["degraded_reason"] == "not_configured"
    assert result["provider_attempts"] == []

    restarted_result = asyncio.run(
        compose.extract_entities(
            schemas.MailExtractEntitiesRequest(
                context="Contacte: Ada Lovelace <ada@example.test>"
            )
        )
    )
    assert restarted_result == result


def test_entity_analysis_distinguishes_empty_and_invalid_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = iter([
        '{"events": [], "contacts": []}',
        '{"events": "invalid", "contacts": []}',
    ])
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr("pipeline.ai_client.PRIMARY_PROVIDER", "fixture")
    monkeypatch.setattr(
        "pipeline.ai_client.call_ai_client",
        lambda *_args, **_kwargs: next(responses),
    )

    empty = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )
    invalid = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert empty["status"] == "complete"
    assert empty["provider"] == "fixture"
    assert invalid["status"] == "degraded"
    assert invalid["provider_attempts"] == [
        {"provider": "fixture", "status": "invalid_response"}
    ]


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (TimeoutError("synthetic"), "timeout"),
        (RuntimeError("AI error 401: private response"), "unauthorized"),
        (RuntimeError("AI error 429: private response"), "rate_limited"),
        (RuntimeError("AI error 503: private response"), "server_error"),
    ],
)
def test_entity_analysis_classifies_provider_failures_without_details(
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    expected: str,
) -> None:
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr(
        "pipeline.ai_client.call_ai_client",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(failure),
    )

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result["provider_attempts"] == [
        {"provider": "fixture", "status": expected}
    ]
    assert "private response" not in str(result)


def test_entity_analysis_cascades_after_malformed_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def provider(_prompt: str, **options: object) -> str:
        name = str(options["provider"])
        calls.append(name)
        return "not-json" if name == "primary" else '{"events": [], "contacts": []}'

    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["primary", "backup"])
    monkeypatch.setattr("pipeline.ai_client.call_ai_client", provider)

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert calls == ["primary", "backup"]
    assert result["provider"] == "backup"
    assert result["provider_attempts"] == [
        {"provider": "primary", "status": "invalid_response"},
        {"provider": "backup", "status": "success"},
    ]


def test_entity_analysis_uses_secondary_after_primary_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, int]] = []

    def provider(_prompt: str, **options: object) -> str:
        name = str(options["provider"])
        timeout = int(str(options["timeout"]))
        calls.append((name, timeout))
        if name == "primary":
            raise TimeoutError("synthetic timeout")
        return '{"events": [], "contacts": []}'

    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["primary", "backup"])
    monkeypatch.setattr("pipeline.ai_client.call_ai_client", provider)

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert calls == [("primary", 8), ("backup", 12)]
    assert result["provider"] == "backup"
    assert result["provider_attempts"] == [
        {"provider": "primary", "status": "timeout"},
        {"provider": "backup", "status": "success"},
    ]


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


def test_imap_list_preserves_internet_message_identity() -> None:
    raw_message = (
        b"From: Sender <sender@example.test>\r\n"
        b"To: reader@example.test\r\n"
        b"Subject: Duplicate identity\r\n"
        b"Date: Tue, 1 Sep 2026 10:00:00 +0000\r\n"
        b"Message-ID: <shared-delivery@example.test>\r\n\r\n"
    )

    result = _imap_list_item(
        [(b"1 (UID 42 FLAGS () X-GM-THRID 99)", raw_message)],
        0,
        "INBOX",
        "reader@example.test",
        "INBOX",
    )

    assert result is not None
    assert result["internet_message_id"] == "shared-delivery@example.test"
