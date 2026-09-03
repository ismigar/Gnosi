"""Synthetic regressions for mail preview responsiveness and inline assets."""

from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

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
from backend.domains.mail.services import analysis_cache
from backend.domains.mail.services.attachments import _collect_original_inline_parts
from backend.services import integration_manager as integration_module


@pytest.fixture(autouse=True)
def _isolated_analysis_cache(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(analysis, "_PROVIDER_CIRCUITS", {})
    monkeypatch.setattr(
        analysis_cache,
        "_cache_root",
        lambda: tmp_path / "analysis-results",
    )


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
        "result_source": "provider",
        "provider_attempts": [{"provider": "fixture", "status": "success"}],
    }
    assert provider_threads and provider_threads[0] != caller_thread


def test_entity_analysis_enforces_timeout_outside_provider_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def blocking_provider(_prompt: str, **_options: object) -> str:
        time.sleep(0.05)
        return '{"events": [], "contacts": []}'

    monkeypatch.setattr("pipeline.ai_client.call_ai_client", blocking_provider)
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr(analysis, "_PRIMARY_TIMEOUT_SECONDS", 0.01)

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result["status"] == "complete"
    assert result["result_source"] == "local"
    assert result["provider_attempts"] == [
        {"provider": "fixture", "status": "timeout"}
    ]
    assert result["analysis_reason"] == "timeout"


def test_entity_analysis_bounds_workers_when_provider_ignores_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release = threading.Event()
    calls = 0
    calls_lock = threading.Lock()
    capacity = threading.BoundedSemaphore(2)
    executor = ThreadPoolExecutor(max_workers=2)

    def blocking_provider(_prompt: str, **_options: object) -> str:
        nonlocal calls
        with calls_lock:
            calls += 1
        release.wait(timeout=2)
        return '{"events": [], "contacts": []}'

    monkeypatch.setattr("pipeline.ai_client.call_ai_client", blocking_provider)
    monkeypatch.setattr(
        analysis,
        "_configured_provider_names",
        lambda: ["primary", "secondary"],
    )
    monkeypatch.setattr(analysis, "_PRIMARY_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(analysis, "_PROVIDER_CAPACITY", capacity)
    monkeypatch.setattr(analysis, "_PROVIDER_EXECUTOR", executor)

    async def exercise_capacity() -> list[dict[str, object]]:
        return await asyncio.gather(*(
            compose.extract_entities(
                schemas.MailExtractEntitiesRequest(context=f"fixture-{index}")
            )
            for index in range(6)
        ))

    started = time.monotonic()
    try:
        results = asyncio.run(exercise_capacity())
        assert time.monotonic() - started < 0.5
        assert calls == 2
        assert not capacity.acquire(blocking=False)
        assert all(result["result_source"] == "local" for result in results)
        assert all(result["status"] == "complete" for result in results)
        assert all(len(result["provider_attempts"]) == 2 for result in results)
    finally:
        release.set()
        executor.shutdown(wait=True)

    assert capacity.acquire(blocking=False)
    assert capacity.acquire(blocking=False)


def test_entity_analysis_treats_local_fallback_as_a_normal_result(
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

    assert result["status"] == "complete"
    assert "error" not in result
    assert result["provider"] == "local_deterministic"
    assert result["result_source"] == "local"
    assert result["degraded_reason"] == "providers_failed"
    assert result["analysis_reason"] == "temporarily_unavailable"
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
    assert result["status"] == "complete"


def test_entity_analysis_reports_missing_configuration_without_provider_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: [])
    monkeypatch.setattr(
        analysis,
        "_configuration_failure_reason",
        lambda: "not_configured",
    )
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
    assert result["status"] == "complete"
    assert result["degraded_reason"] == "not_configured"
    assert result["analysis_reason"] == "not_configured"
    assert result["provider_attempts"] == []

    restarted_result = asyncio.run(
        compose.extract_entities(
            schemas.MailExtractEntitiesRequest(
                context="Contacte: Ada Lovelace <ada@example.test>"
            )
        )
    )
    assert restarted_result == result


def test_entity_analysis_errors_only_when_local_processing_also_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr(
        "pipeline.ai_client.call_ai_client",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            TimeoutError("synthetic provider timeout")
        ),
    )
    monkeypatch.setattr(
        analysis,
        "extract_local_entities",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("synthetic local failure")
        ),
    )

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result["status"] == "degraded"
    assert result["error"] == "internal_error"
    assert result["analysis_reason"] == "internal_error"
    assert result["events"] == []
    assert result["contacts"] == []
    assert "synthetic local failure" not in str(result)


def test_entity_analysis_rejects_an_invalid_local_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: [])
    monkeypatch.setattr(
        analysis,
        "_configuration_failure_reason",
        lambda: "not_configured",
    )
    monkeypatch.setattr(
        analysis,
        "extract_local_entities",
        lambda *_args, **_kwargs: object(),
    )

    result = asyncio.run(
        compose.extract_entities(schemas.MailExtractEntitiesRequest(context="fixture"))
    )

    assert result["status"] == "degraded"
    assert result["error"] == "invalid_response"
    assert result["analysis_reason"] == "invalid_response"
    assert result["provider"] == "local_deterministic"


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
    assert invalid["status"] == "complete"
    assert invalid["provider_attempts"] == [
        {"provider": "fixture", "status": "invalid_response"}
    ]


@pytest.mark.parametrize(
    ("failure", "expected", "expected_reason"),
    [
        (TimeoutError("synthetic"), "timeout", "timeout"),
        (RuntimeError("AI error 401: private response"), "unauthorized", "credentials"),
        (RuntimeError("AI error 429: private response"), "rate_limited", "quota"),
        (RuntimeError("AI error 503: private response"), "server_error", "temporarily_unavailable"),
    ],
)
def test_entity_analysis_classifies_provider_failures_without_details(
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    expected: str,
    expected_reason: str,
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
    assert result["analysis_reason"] == expected_reason
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


def test_entity_analysis_opens_and_recovers_provider_circuit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0
    primary_calls = 0
    backup_calls = 0

    def provider(_prompt: str, **options: object) -> str:
        nonlocal primary_calls, backup_calls
        name = str(options["provider"])
        if name == "primary":
            primary_calls += 1
            if primary_calls <= 2:
                raise TimeoutError("synthetic timeout")
        else:
            backup_calls += 1
        return '{"events": [], "contacts": []}'

    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["primary", "backup"])
    monkeypatch.setattr(analysis, "_circuit_now", lambda: now)
    monkeypatch.setattr("pipeline.ai_client.call_ai_client", provider)
    request = schemas.MailExtractEntitiesRequest(context="synthetic circuit fixture")

    first = asyncio.run(compose.extract_entities(request))
    second = asyncio.run(compose.extract_entities(request))
    protected = asyncio.run(compose.extract_entities(request))

    assert first["provider"] == "backup"
    assert second["provider"] == "backup"
    assert protected["provider"] == "backup"
    assert protected["provider_attempts"] == [
        {"provider": "primary", "status": "unavailable"},
        {"provider": "backup", "status": "success"},
    ]
    assert (primary_calls, backup_calls) == (2, 3)

    now += analysis._PROVIDER_CIRCUIT_COOLDOWN_SECONDS + 1
    recovered = asyncio.run(compose.extract_entities(request))

    assert recovered["provider"] == "primary"
    assert recovered["provider_attempts"] == [
        {"provider": "primary", "status": "success"}
    ]
    assert (primary_calls, backup_calls) == (3, 3)


def test_entity_analysis_recovers_exact_previous_result_after_provider_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    calls = 0

    def provider(_prompt: str, **_options: object) -> str:
        nonlocal calls
        calls += 1
        if calls > 1:
            raise TimeoutError("synthetic timeout")
        return '{"events": [{"title": "Literal fixture"}], "contacts": []}'

    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr("pipeline.ai_client.call_ai_client", provider)
    request = schemas.MailExtractEntitiesRequest(
        context="Synthetic body that must never be cached verbatim",
        sender="Fixture Sender <sender@example.test>",
        recipients=["reader@example.test"],
        attachments=["fixture.pdf"],
    )

    first = asyncio.run(compose.extract_entities(request))
    recovered = asyncio.run(compose.extract_entities(request))

    assert first["result_source"] == "provider"
    assert recovered["provider"] == "previous_valid"
    assert recovered["result_source"] == "previous_valid"
    assert recovered["events"] == [{"title": "Literal fixture"}]
    assert recovered["status"] == "complete"
    assert recovered["provider_attempts"] == [
        {"provider": "fixture", "status": "timeout"}
    ]
    assert recovered["analysis_reason"] == "timeout"
    stored = next((tmp_path / "analysis-results").glob("*.json")).read_text()
    assert "Synthetic body" not in stored
    assert "sender@example.test" not in stored
    assert "reader@example.test" not in stored


def test_entity_analysis_preserves_exact_previous_result_if_local_processing_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def provider(_prompt: str, **_options: object) -> str:
        nonlocal calls
        calls += 1
        if calls > 1:
            raise TimeoutError("synthetic timeout")
        return '{"events": [{"title": "Cached fixture"}], "contacts": []}'

    request = schemas.MailExtractEntitiesRequest(context="Exact synthetic fixture")
    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr("pipeline.ai_client.call_ai_client", provider)
    asyncio.run(compose.extract_entities(request))
    monkeypatch.setattr(
        analysis,
        "extract_local_entities",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("synthetic local failure")
        ),
    )

    recovered = asyncio.run(compose.extract_entities(request))

    assert recovered["status"] == "complete"
    assert recovered["provider"] == "previous_valid"
    assert recovered["result_source"] == "previous_valid"
    assert recovered["events"] == [{"title": "Cached fixture"}]
    assert recovered["analysis_reason"] == "internal_error"
    assert "error" not in recovered


def test_entity_analysis_does_not_reuse_previous_result_for_different_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses: list[str | Exception] = [
        '{"events": [{"title": "First fixture"}], "contacts": []}',
        TimeoutError("synthetic timeout"),
    ]

    def provider(_prompt: str, **_options: object) -> str:
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr("pipeline.ai_client.call_ai_client", provider)

    asyncio.run(
        compose.extract_entities(
            schemas.MailExtractEntitiesRequest(context="First synthetic fixture")
        )
    )
    result = asyncio.run(
        compose.extract_entities(
            schemas.MailExtractEntitiesRequest(context="Different synthetic fixture")
        )
    )

    assert result["provider"] == "local_deterministic"
    assert result["result_source"] == "local"
    assert result["events"] == []


@pytest.mark.parametrize(
    ("provider_config", "api_key", "expected"),
    [
        ({"enabled": False, "model_name": "model", "model_url": "https://ai.example.test"}, None, "disabled"),
        ({"enabled": True, "model_name": "model", "model_url": "https://ai.example.test"}, None, "credentials"),
        ({"enabled": True, "model_name": "", "model_url": ""}, None, "not_configured"),
    ],
)
def test_entity_analysis_classifies_local_provider_configuration_without_requests(
    monkeypatch: pytest.MonkeyPatch,
    provider_config: dict[str, object],
    api_key: str | None,
    expected: str,
) -> None:
    from pipeline import ai_client

    monkeypatch.setattr(ai_client, "PRIMARY_PROVIDER", "openai")
    monkeypatch.setattr(ai_client, "FALLBACK_PROVIDER", None)
    monkeypatch.setattr(ai_client, "PROVIDERS", {"openai": provider_config})
    monkeypatch.setattr(
        analysis,
        "resolve_provider_api_key",
        lambda *_args, **_kwargs: api_key,
    )
    monkeypatch.setattr(
        ai_client,
        "call_ai_client",
        lambda *_args, **_kwargs: pytest.fail("configuration inspection must not call a provider"),
    )

    assert analysis._configured_provider_names() == []
    assert analysis._configuration_failure_reason() == expected


def test_entity_analysis_cancellation_stops_the_cascade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    local_called = False

    async def pending_provider(_prompt: str, _provider: str, _timeout: int) -> str:
        started.set()
        await asyncio.Future()

    def local_fallback(*_args: object, **_kwargs: object) -> object:
        nonlocal local_called
        local_called = True
        return object()

    monkeypatch.setattr(analysis, "_configured_provider_names", lambda: ["fixture"])
    monkeypatch.setattr(analysis, "request_entity_analysis", pending_provider)
    monkeypatch.setattr(analysis, "extract_local_entities", local_fallback)

    async def cancel_running_analysis() -> None:
        task = asyncio.create_task(analysis.analyze_mail_entities("fixture"))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_running_analysis())
    assert local_called is False


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
