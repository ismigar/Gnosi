"""Typed contracts for real observability spans, using only disposable fake data."""

from __future__ import annotations

import contextvars
import math
import threading
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone, tzinfo
from itertools import repeat
from pathlib import Path
from queue import Queue
from types import TracebackType
from uuid import UUID

import pytest

from backend.services import agent_observability as telemetry

FIXED_UUID = UUID("0123456789abcdef0123456789abcdef")
FIXED_TIMESTAMP = "2026-01-02T03:04:05+00:00"
EXPECTED_SAFE_KEYS = frozenset(
    {
        "provider",
        "model",
        "tool",
        "status",
        "route",
        "mode",
        "error_code",
        "duration_ms",
        "model_calls",
        "tool_calls",
        "queue_state",
        "job_type",
        "cache_hit",
        "result_kind",
        "retry_attempt",
        "index_stale",
    }
)


class SequenceClock:
    def __init__(self, ticks: Iterable[float]) -> None:
        self._ticks = iter(ticks)

    def monotonic(self) -> float:
        return next(self._ticks)


class FixedDateTime:
    @staticmethod
    def now(tz: tzinfo | None = None) -> datetime:
        assert tz is timezone.utc
        return datetime(2026, 1, 2, 3, 4, 5, tzinfo=tz)


class FixedUUIDSource:
    @staticmethod
    def uuid4() -> UUID:
        return FIXED_UUID


@dataclass(frozen=True)
class TextValue:
    text: str

    def __str__(self) -> str:
        return self.text


class FalseTextValue:
    def __bool__(self) -> bool:
        return False

    def __str__(self) -> str:
        raise AssertionError("False-valued objects must not be stringified")


class UnprintableValue:
    def __str__(self) -> str:
        raise AssertionError("Values of filtered-out keys must not be stringified")


@pytest.fixture(autouse=True)
def isolated_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Replace every mutable owner and storage hook before any service call."""
    storage = tmp_path / "synthetic-spans.jsonl"

    def storage_path() -> Path:
        return storage

    def reject_data_directory(*, create: bool = False) -> Path:
        raise AssertionError("Tests must never resolve an application data directory")

    monkeypatch.setattr(telemetry, "_storage_path", storage_path)
    monkeypatch.setattr(telemetry, "resolve_data_dir", reject_data_directory)
    monkeypatch.setattr(
        telemetry,
        "_SPANS",
        deque[telemetry.SpanRecord](
            maxlen=telemetry._SPANS.maxlen,
        ),
    )
    monkeypatch.setattr(
        telemetry,
        "_TRACE_ID",
        contextvars.ContextVar[str](
            "synthetic_observability_trace",
            default="",
        ),
    )
    monkeypatch.setattr(telemetry, "_LOCK", threading.RLock())
    # Patch the service's clock reference, never the shared stdlib time module.
    monkeypatch.setattr(telemetry, "time", SequenceClock(repeat(100.0)))
    monkeypatch.setattr(telemetry, "datetime", FixedDateTime)
    monkeypatch.setattr(telemetry, "uuid", FixedUUIDSource)
    return storage


def test_record_defaults_and_exact_append_only_jsonl(isolated_service: Path) -> None:
    first = telemetry.record_span("", attributes={"model": "mòdèl fictici"})
    expected: telemetry.SpanRecord = {
        "span_id": "0123456789abcdef",
        "trace_id": "0123456789abcdef0123456789abcdef",
        "name": "agent.operation",
        "status": "ok",
        "duration_ms": 0,
        "timestamp": FIXED_TIMESTAMP,
        "model": "mòdèl fictici",
    }
    assert first == expected
    assert list(first) == list(expected)
    line = (
        b'{"span_id":"0123456789abcdef",'
        b'"trace_id":"0123456789abcdef0123456789abcdef",'
        b'"name":"agent.operation","status":"ok","duration_ms":0,'
        b'"timestamp":"2026-01-02T03:04:05+00:00",'
        b'"model":"m\\u00f2d\\u00e8l fictici"}\n'
    )
    assert isolated_service.read_bytes() == line
    second = telemetry.record_span("", attributes={"model": "mòdèl fictici"})
    assert isolated_service.read_bytes() == line + line
    assert second == first
    assert second is not first
    assert telemetry.recent_spans()[0] is first
    assert telemetry.recent_spans()[1] is second


def test_only_exact_safe_keys_survive(isolated_service: Path) -> None:
    assert telemetry.SAFE_KEYS == EXPECTED_SAFE_KEYS
    attributes: dict[object, object] = {key: "fake-" + key for key in sorted(EXPECTED_SAFE_KEYS)}
    attributes.update(
        {
            "prompt": UnprintableValue(),
            "body": UnprintableValue(),
            "source": UnprintableValue(),
            "authorization": UnprintableValue(),
            "MODEL": UnprintableValue(),
            " model ": UnprintableValue(),
            "span_id": UnprintableValue(),
            "trace_id": UnprintableValue(),
            "name": UnprintableValue(),
            "timestamp": UnprintableValue(),
            "model" + "x" * 100: UnprintableValue(),
        }
    )
    result = telemetry.record_span("agent.synthetic", attributes=attributes)
    base_keys = {"span_id", "trace_id", "name", "timestamp"}
    assert set(result) == EXPECTED_SAFE_KEYS | base_keys
    for key in EXPECTED_SAFE_KEYS:
        assert result[key] == "fake-" + key
    assert result["span_id"] == "0123456789abcdef"
    assert result["trace_id"] == FIXED_UUID.hex
    assert result["name"] == "agent.synthetic"
    assert result["timestamp"] == FIXED_TIMESTAMP
    assert b"prompt" not in isolated_service.read_bytes()


@pytest.mark.parametrize("preceding_entries", [30, 31, 32, 33])
def test_attribute_limit_is_applied_before_filtering(preceding_entries: int) -> None:
    assert telemetry.MAX_ATTRIBUTES == 32
    attributes: dict[object, object] = {
        f"discarded-{index}": UnprintableValue() for index in range(preceding_entries)
    }
    attributes["model"] = "fake-model"
    attributes["tool"] = "fake-tool"
    result = telemetry.record_span("agent.synthetic", attributes=attributes)
    assert ("model" in result) is (preceding_entries < 32)
    assert ("tool" in result) is (preceding_entries < 31)


def test_object_keys_are_normalized_and_later_collisions_win() -> None:
    attributes: dict[object, object] = {
        "model": "first",
        TextValue("tool"): "fake-tool",
        TextValue("model"): "second",
        17: UnprintableValue(),
        None: UnprintableValue(),
        FalseTextValue(): UnprintableValue(),
    }
    result = telemetry.record_span("agent.synthetic", attributes=attributes)
    assert result["model"] == "second"
    assert result["tool"] == "fake-tool"
    assert list(result)[-2:] == ["model", "tool"]
    assert "17" not in result
    assert "" not in result
    assert len(attributes) == 6


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, ""),
        ("", ""),
        (False, False),
        (True, True),
        (0, 0),
        (-7, -7),
        (2**100, 2**100),
        (0.0, 0.0),
        (-0.0, -0.0),
        (3.25, 3.25),
        (-3.25, -3.25),
        ([], ""),
        ({}, ""),
        ([1, 2], "[1, 2]"),
        ({"fake": "value"}, "{'fake': 'value'}"),
        (" \t línia\n\r dos\u2003tres  ", "línia dos tres"),
        (TextValue("  fake\n object  "), "fake object"),
        (FalseTextValue(), ""),
    ],
)
def test_attribute_scalars_preserve_value_and_type(
    value: object,
    expected: telemetry.SpanValue,
) -> None:
    result = telemetry.record_span("agent.synthetic", attributes={"result_kind": value})
    actual = result["result_kind"]
    assert actual == expected
    assert type(actual) is type(expected)
    if isinstance(expected, float):
        assert isinstance(actual, float)
        assert math.copysign(1.0, actual) == math.copysign(1.0, expected)


@pytest.mark.parametrize("length", [239, 240, 241])
def test_attribute_strings_collapse_whitespace_then_truncate(length: int) -> None:
    assert telemetry.MAX_VALUE_CHARS == 240
    result = telemetry.record_span(
        "agent.synthetic",
        attributes={
            "model": " \t " + "é" * length + " \n ",
            "tool": "x " * 121,
        },
    )
    assert result["model"] == "é" * min(length, 240)
    # Cutting the normalized string may leave a trailing space; do not trim again.
    assert result["tool"] == "x " * 120


@pytest.mark.parametrize(
    ("value", "encoded"),
    [
        (float("inf"), b"Infinity"),
        (float("-inf"), b"-Infinity"),
        (float("nan"), b"NaN"),
    ],
)
def test_nonfinite_floats_keep_legacy_json_encoding(
    isolated_service: Path,
    value: float,
    encoded: bytes,
) -> None:
    result = telemetry.record_span("agent.synthetic", attributes={"model_calls": value})
    actual = result["model_calls"]
    assert isinstance(actual, float)
    if math.isnan(value):
        assert math.isnan(actual)
    else:
        assert actual == value
    assert b'"model_calls":' + encoded + b"}\n" in isolated_service.read_bytes()


@pytest.mark.parametrize("extra", [-1, 0, 1])
def test_record_text_fields_have_exact_independent_limits(extra: int) -> None:
    result = telemetry.record_span(
        "n" * (96 + extra),
        trace_id="t" * (64 + extra),
        status="s" * (32 + extra),
    )
    assert result["name"] == "n" * min(96 + extra, 96)
    assert result["trace_id"] == "t" * min(64 + extra, 64)
    assert result["status"] == "s" * min(32 + extra, 32)


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (None, "ok"),
        (False, "ok"),
        (0, "ok"),
        ("", "ok"),
        (True, "True"),
        (27, "27"),
        (2.5, "2.5"),
        (TextValue("  fake\nstatus  "), "  fake\nstatus  "),
    ],
)
def test_direct_status_uses_string_conversion_without_attribute_normalization(
    status: object,
    expected: str,
) -> None:
    result = telemetry.record_span("agent.synthetic", status=status)
    assert result["status"] == expected
    assert type(result["status"]) is str


@pytest.mark.parametrize(
    ("status", "duration"),
    [
        (False, -7),
        (19, -2.5),
        ("s" * 241, "not-a-duration"),
    ],
)
def test_attributes_override_default_status_and_computed_duration(
    status: telemetry.SpanValue,
    duration: telemetry.SpanValue,
) -> None:
    result = telemetry.record_span(
        "agent.synthetic",
        status="base",
        started_at=1.0,
        attributes={"status": status, "duration_ms": duration},
    )
    expected_status = status[:240] if isinstance(status, str) else status
    assert result["status"] == expected_status
    assert type(result["status"]) is type(expected_status)
    assert result["duration_ms"] == duration
    assert type(result["duration_ms"]) is type(duration)


@pytest.mark.parametrize(
    ("started_at", "ticks", "expected_ms"),
    [
        (None, (10.0, 10.125), 125),
        (0.0, (10.0, 10.125), 125),
        (10.0, (10.125,), 125),
        (12.0, (10.0,), 0),
        (10.0, (10.001953125,), 1),
        (-1.0, (0.0,), 1_000),
    ],
)
def test_record_duration_uses_deterministic_clock_and_falsy_start_fallback(
    monkeypatch: pytest.MonkeyPatch,
    started_at: float | None,
    ticks: tuple[float, ...],
    expected_ms: int,
) -> None:
    monkeypatch.setattr(telemetry, "time", SequenceClock(ticks))
    result = telemetry.record_span("agent.synthetic", started_at=started_at)
    assert result["duration_ms"] == expected_ms
    assert type(result["duration_ms"]) is int


def test_context_success_merges_arbitrary_holder_and_overrides_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(telemetry, "time", SequenceClock((10.0, 10.375, 10.5)))
    attributes: dict[object, object] = {
        "model": "fake-original",
        "status": "input-status",
        "duration_ms": 99_999,
    }
    with telemetry.span("agent.synthetic", attributes=attributes) as holder:
        assert holder == {"status": "ok"}
        assert telemetry.recent_spans() == []
        holder["model"] = TextValue(" fake\n replacement ")
        holder["status"] = False
        holder["duration_ms"] = -99
        holder[TextValue("tool")] = "fake-tool"
        holder[42] = UnprintableValue()
        holder["prompt"] = UnprintableValue()
    result = telemetry.recent_spans()[0]
    assert result["model"] == "fake replacement"
    assert result["tool"] == "fake-tool"
    assert result["status"] is False
    assert result["duration_ms"] == 375
    assert holder["duration_ms"] == 375
    assert isinstance(holder["model"], TextValue)
    assert result is not holder
    assert "42" not in result and "prompt" not in result
    assert attributes == {
        "model": "fake-original",
        "status": "input-status",
        "duration_ms": 99_999,
    }
    holder["model"] = "changed-after-recording"
    assert result["model"] == "fake replacement"


def test_context_normalized_holder_key_can_override_generated_status() -> None:
    with telemetry.span("agent.synthetic") as holder:
        holder[TextValue("status")] = 17
        holder[TextValue("duration_ms")] = -25
    result = telemetry.recent_spans()[0]
    assert holder["status"] == "ok"
    assert holder["duration_ms"] == 0
    assert result["status"] == 17
    # The literal duration key is appended in finally, after its object-key alias.
    assert result["duration_ms"] == 0


@pytest.mark.parametrize("remove_status", [False, True])
def test_context_default_and_deleted_status(remove_status: bool) -> None:
    with telemetry.span("agent.synthetic", attributes={"status": "input-status"}) as holder:
        if remove_status:
            del holder["status"]
    assert telemetry.recent_spans()[0]["status"] == ("input-status" if remove_status else "ok")


def test_context_error_records_terminal_span_and_reraises_same_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(telemetry, "time", SequenceClock((10.0, 10.25, 10.5)))
    error = ValueError("synthetic failure detail must not be recorded")
    with pytest.raises(ValueError) as captured:
        with telemetry.span("agent.synthetic", attributes={"error_code": "old-code"}) as holder:
            holder["status"] = "caller-status"
            holder["error_code"] = "caller-code"
            raise error
    assert captured.value is error
    result = telemetry.recent_spans()[0]
    assert result["status"] == "error"
    assert result["error_code"] == "ValueError"
    assert result["duration_ms"] == 250
    assert holder == {"status": "error", "error_code": "ValueError", "duration_ms": 250}
    assert str(error) not in str(result)


def test_context_base_exception_is_reraised_without_error_classification() -> None:
    error = BaseException("synthetic interruption")
    with pytest.raises(BaseException) as captured:
        with telemetry.span("agent.synthetic"):
            raise error
    assert captured.value is error
    result = telemetry.recent_spans()[0]
    assert result["status"] == "ok"
    assert "error_code" not in result


def test_context_negative_duration_overrides_record_clamping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(telemetry, "time", SequenceClock((10.0, 9.75, 9.5)))
    with telemetry.span("agent.synthetic") as holder:
        pass
    assert holder["duration_ms"] == -250
    assert telemetry.recent_spans()[0]["duration_ms"] == -250


def test_context_metadata_remains_subject_to_first_32_entry_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(telemetry, "time", SequenceClock((10.0, 10.25, 10.5)))
    attributes: dict[object, object] = {
        f"discarded-{index}": UnprintableValue() for index in range(32)
    }
    error = ValueError("synthetic error")
    with pytest.raises(ValueError) as captured:
        with telemetry.span("agent.synthetic", attributes=attributes):
            raise error
    assert captured.value is error
    result = telemetry.recent_spans()[0]
    assert result["status"] == "error"
    assert result["duration_ms"] == 500
    assert "error_code" not in result


def test_nested_spans_complete_in_order_without_changing_trace_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(telemetry, "time", SequenceClock((10.0, 10.25, 10.5, 10.75, 11.0, 11.25)))
    token = telemetry.set_trace_id("synthetic-parent")
    try:
        with telemetry.span("outer", trace_id="synthetic-explicit") as outer:
            assert telemetry.current_trace_id() == "synthetic-parent"
            with telemetry.span("inner") as inner:
                assert inner is not outer
                inner["model"] = "fake-inner"
            assert telemetry.recent_spans()[0]["name"] == "inner"
            assert "model" not in outer
            assert telemetry.current_trace_id() == "synthetic-parent"
        results = telemetry.recent_spans()
        assert [(item["name"], item["trace_id"], item["duration_ms"]) for item in results] == [
            ("inner", "synthetic-parent", 250),
            ("outer", "synthetic-explicit", 1_000),
        ]
        assert telemetry.current_trace_id() == "synthetic-parent"
    finally:
        telemetry._TRACE_ID.reset(token)


def test_trace_generation_precedence_truncation_and_token_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identifiers = iter((UUID(int=1), UUID(int=2)))

    class UUIDSequence:
        @staticmethod
        def uuid4() -> UUID:
            return next(identifiers)

    with monkeypatch.context() as controlled:
        controlled.setattr(telemetry, "uuid", UUIDSequence)
        assert telemetry.new_trace_id() == "0" * 31 + "1"
        assert telemetry.new_trace_id() == "0" * 31 + "2"
    assert telemetry.current_trace_id() == ""
    outer = telemetry.set_trace_id("p" * 65)
    assert outer.var is telemetry._TRACE_ID
    assert telemetry.current_trace_id() == "p" * 64
    assert telemetry.record_span("implicit")["trace_id"] == "p" * 64
    assert (
        telemetry.record_span("explicit", trace_id="fake-explicit")["trace_id"] == "fake-explicit"
    )
    assert telemetry.current_trace_id() == "p" * 64
    inner = telemetry.set_trace_id("")
    assert telemetry.current_trace_id() == FIXED_UUID.hex
    telemetry._TRACE_ID.reset(inner)
    assert telemetry.current_trace_id() == "p" * 64
    telemetry._TRACE_ID.reset(outer)
    assert telemetry.current_trace_id() == ""
    assert telemetry.record_span("generated")["trace_id"] == FIXED_UUID.hex
    assert telemetry.current_trace_id() == ""


@pytest.mark.parametrize(
    ("limit", "count"),
    [
        (-50, 1),
        (0, 1),
        (1, 1),
        (2, 2),
        (100, 100),
        (199, 199),
        (200, 200),
        (201, 200),
        (10_000, 200),
    ],
)
def test_recent_spans_exact_limits_filter_before_slice_and_chronological_order(
    limit: int,
    count: int,
) -> None:
    selected: list[telemetry.SpanRecord] = []
    for index in range(205):
        selected.append(telemetry.record_span(f"selected-{index}", trace_id="fake-selected"))
        telemetry.record_span(f"other-{index}", trace_id="fake-other")
    results = telemetry.recent_spans("fake-selected", limit=limit)
    assert len(results) == count
    assert results == selected[-count:]
    assert all(
        actual is expected for actual, expected in zip(results, selected[-count:], strict=True)
    )
    assert telemetry.recent_spans("absent", limit=limit) == []
    assert len(telemetry.recent_spans()) == 100
    assert telemetry.recent_spans()[-1]["name"] == "other-204"


def test_recent_spans_returns_new_lists_with_shared_mutable_records(isolated_service: Path) -> None:
    assert telemetry.recent_spans() == []
    first = telemetry.record_span("first", trace_id="fake-a")
    second = telemetry.record_span("second", trace_id="fake-b")
    persisted = isolated_service.read_bytes()
    memory = telemetry._SPANS
    listing = telemetry.recent_spans()
    assert listing is not telemetry.recent_spans()
    assert listing[0] is first and listing[1] is second
    listing.clear()
    assert telemetry.recent_spans() == [first, second]
    first["model"] = "fake-added"
    telemetry.recent_spans()[1]["trace_id"] = "fake-a"
    filtered = telemetry.recent_spans("fake-a")
    assert filtered[0] is first and filtered[1] is second
    assert filtered[0]["model"] == "fake-added"
    assert telemetry.recent_spans("fake-b") == []
    assert telemetry._SPANS is memory
    assert isolated_service.read_bytes() == persisted


def test_deque_retains_exactly_2000_spans_without_replacing_state(isolated_service: Path) -> None:
    assert telemetry.MAX_SPANS == 2_000
    memory = telemetry._SPANS
    assert memory.maxlen == 2_000
    records = [telemetry.record_span(f"synthetic-{index}") for index in range(2_003)]
    assert telemetry._SPANS is memory
    assert len(memory) == 2_000
    assert memory[0] is records[3]
    assert memory[-1] is records[-1]
    assert all(actual is expected for actual, expected in zip(memory, records[3:], strict=True))
    recent = telemetry.recent_spans(limit=2_003)
    assert len(recent) == 200
    assert recent[0] is records[-200]
    assert recent[-1] is records[-1]
    assert len(isolated_service.read_bytes().splitlines()) == 2_003


def test_copied_and_empty_contexts_have_independent_trace_ownership() -> None:
    parent = telemetry.set_trace_id("fake-parent")
    copied = contextvars.copy_context()
    empty = contextvars.Context()

    def record_in_context(trace_id: str) -> tuple[str, telemetry.SpanRecord, str]:
        before = telemetry.current_trace_id()
        token = telemetry.set_trace_id(trace_id)
        try:
            result = telemetry.record_span("agent.synthetic")
        finally:
            telemetry._TRACE_ID.reset(token)
        return before, result, telemetry.current_trace_id()

    try:
        before, copied_record, after = copied.run(record_in_context, "fake-copy")
        assert before == after == "fake-parent"
        before, empty_record, after = empty.run(record_in_context, "fake-empty")
        assert before == after == ""
        assert telemetry.current_trace_id() == "fake-parent"
        assert copied_record["trace_id"] == "fake-copy"
        assert empty_record["trace_id"] == "fake-empty"
        assert telemetry.recent_spans()[0] is copied_record
        assert telemetry.recent_spans()[1] is empty_record
    finally:
        telemetry._TRACE_ID.reset(parent)


def test_owned_threads_keep_trace_contexts_independent_and_are_joined() -> None:
    observations: Queue[tuple[str, str, telemetry.SpanRecord, str]] = Queue()
    failures: Queue[BaseException] = Queue()
    rendezvous = threading.Barrier(3, timeout=5.0)
    parent = telemetry.set_trace_id("fake-main-thread")

    def worker(trace_id: str) -> None:
        try:
            before = telemetry.current_trace_id()
            token = telemetry.set_trace_id(trace_id)
            try:
                rendezvous.wait()
                with telemetry.span("agent.synthetic-thread"):
                    assert telemetry.current_trace_id() == trace_id
                result = telemetry.recent_spans(trace_id)[0]
            finally:
                telemetry._TRACE_ID.reset(token)
            observations.put((trace_id, before, result, telemetry.current_trace_id()))
        except BaseException as error:
            failures.put(error)

    threads = [
        threading.Thread(target=worker, args=(name,), name=name)
        for name in ("fake-thread-a", "fake-thread-b")
    ]
    started: list[threading.Thread] = []
    try:
        for thread in threads:
            thread.start()
            started.append(thread)
        rendezvous.wait()
        assert telemetry.current_trace_id() == "fake-main-thread"
    finally:
        for thread in started:
            thread.join(timeout=10.0)
        telemetry._TRACE_ID.reset(parent)
    assert all(not thread.is_alive() for thread in started)
    if not failures.empty():
        raise failures.get_nowait()
    assert observations.qsize() == 2
    assert len(telemetry.recent_spans()) == 2
    for _ in range(2):
        trace_id, before, result, after = observations.get_nowait()
        assert before == after == ""
        assert result["trace_id"] == trace_id
        assert result["status"] == "ok"
        assert telemetry.recent_spans(trace_id)[0] is result
    assert telemetry.current_trace_id() == ""


@pytest.mark.parametrize("unavailable", ["missing-parent", "directory"])
def test_real_temporary_storage_oserror_preserves_memory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    unavailable: str,
) -> None:
    destination = tmp_path if unavailable == "directory" else tmp_path / "missing" / "spans.jsonl"

    def storage_path() -> Path:
        return destination

    monkeypatch.setattr(telemetry, "_storage_path", storage_path)
    result = telemetry.record_span("agent.synthetic")
    assert telemetry.recent_spans()[0] is result
    assert list(tmp_path.iterdir()) == []


class FailingWriter:
    def __init__(self, error: Exception, stage: str) -> None:
        self.error = error
        self.stage = stage
        self.closed = False
        self.writes: list[str] = []

    def __enter__(self) -> FailingWriter:
        return self

    def write(self, text: str) -> int:
        self.writes.append(text)
        if self.stage == "write":
            raise self.error
        return len(text)

    def __exit__(
        self,
        error_type: type[BaseException] | None,
        error: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.closed = True
        if self.stage == "close":
            raise self.error


@pytest.mark.parametrize("stage", ["path", "open", "write", "close"])
@pytest.mark.parametrize("error_type", [OSError, RuntimeError])
def test_storage_only_swallows_oserror_and_keeps_already_appended_span(
    isolated_service: Path,
    monkeypatch: pytest.MonkeyPatch,
    stage: str,
    error_type: type[Exception],
) -> None:
    error = error_type("synthetic storage failure")
    writer = FailingWriter(error, stage)

    def fail_path() -> Path:
        raise error

    def open_storage(path: Path, mode: str, *, encoding: str) -> FailingWriter:
        assert path == isolated_service
        assert mode == "a" and encoding == "utf-8"
        if stage == "open":
            raise error
        return writer

    with monkeypatch.context() as controlled:
        if stage == "path":
            controlled.setattr(telemetry, "_storage_path", fail_path)
        else:
            controlled.setattr(Path, "open", open_storage)
        if isinstance(error, OSError):
            result = telemetry.record_span("agent.synthetic")
            assert telemetry.recent_spans()[0] is result
        else:
            with pytest.raises(error_type) as captured:
                telemetry.record_span("agent.synthetic")
            assert captured.value is error
    assert len(telemetry.recent_spans()) == 1
    assert telemetry.recent_spans()[0]["name"] == "agent.synthetic"
    assert writer.closed is (stage in {"write", "close"})
    assert len(writer.writes) == (1 if stage in {"write", "close"} else 0)
    assert not isolated_service.exists()


@pytest.mark.parametrize("storage_error_type", [OSError, RuntimeError])
def test_context_exception_identity_when_terminal_storage_fails(
    monkeypatch: pytest.MonkeyPatch,
    storage_error_type: type[Exception],
) -> None:
    body_error = ValueError("synthetic body failure")
    storage_error = storage_error_type("synthetic terminal storage failure")

    def fail_path() -> Path:
        raise storage_error

    monkeypatch.setattr(telemetry, "_storage_path", fail_path)
    expected = body_error if isinstance(storage_error, OSError) else storage_error
    with pytest.raises(type(expected)) as captured:
        with telemetry.span("agent.synthetic"):
            raise body_error
    assert captured.value is expected
    if expected is storage_error:
        assert captured.value.__context__ is body_error
    result = telemetry.recent_spans()[0]
    assert result["status"] == "error"
    assert result["error_code"] == "ValueError"
