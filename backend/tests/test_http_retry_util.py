"""retry_after_seconds: tolerant parsing of the Retry-After header (RFC 7231).

The header can be seconds OR an HTTP date; a direct `float()` crashed on the
date and brought down the caller (Notion clone, MCP tools). The shared helper
interprets both formats and falls back to the default, never raising.
"""
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

from backend.utils.http_retry import retry_after_seconds


def test_seconds_form():
    assert retry_after_seconds("3", default=1.0) == 3.0
    assert retry_after_seconds("2.5", default=1.0) == 2.5


def test_cap_applies():
    assert retry_after_seconds("999", default=1.0, cap=15.0) == 15.0
    assert retry_after_seconds("999", default=1.0) == 999.0  # no header, no limit


def test_missing_uses_default():
    assert retry_after_seconds(None, default=7.0) == 7.0
    assert retry_after_seconds("", default=1.0) == 1.0


def test_http_date_future_does_not_crash():
    future = datetime.now(timezone.utc) + timedelta(seconds=5)
    got = retry_after_seconds(format_datetime(future, usegmt=True), default=1.0, cap=15.0)
    assert 3.0 <= got <= 15.0  # interpretada com a data, no ValueError ni fallback


def test_http_date_past_is_zero():
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    assert retry_after_seconds(format_datetime(past, usegmt=True), default=1.0) == 0.0


def test_garbage_falls_back():
    assert retry_after_seconds("no-data", default=4.0) == 4.0


def test_never_raises_and_non_negative():
    for v in [None, "", "abc", "-5", "1e9", "Mon", "1.5"]:
        out = retry_after_seconds(v, default=1.0, cap=10.0)
        assert isinstance(out, float) and out >= 0.0
