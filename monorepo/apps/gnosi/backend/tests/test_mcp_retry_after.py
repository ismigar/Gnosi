"""_retry_after_seconds tolera els dos formats de `Retry-After` (RFC 7231).

El header pot ser segons (enter) O una data HTTP. Abans `float(value)` directe
petava amb ValueError davant una data i tombava la crida a la tool en lloc de
reintentar.
"""
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

from backend.mcp.http_client import _retry_after_seconds


def test_seconds_form():
    assert _retry_after_seconds("3", 0) == 3.0
    # Acotat a 10s.
    assert _retry_after_seconds("999", 0) == 10.0


def test_missing_uses_backoff():
    assert _retry_after_seconds(None, 0) == 1.5
    assert _retry_after_seconds("", 2) == 4.5


def test_http_date_form_does_not_crash():
    # Data ~3s al futur → ~3s d'espera (no ValueError).
    future = datetime.now(timezone.utc) + timedelta(seconds=3)
    val = format_datetime(future, usegmt=True)
    got = _retry_after_seconds(val, 0)
    assert 0.0 <= got <= 10.0
    assert got > 1.0  # ha interpretat la data, no el fallback mínim


def test_past_http_date_is_zero():
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    assert _retry_after_seconds(format_datetime(past, usegmt=True), 0) == 0.0


def test_garbage_falls_back_to_backoff():
    # Ni segons ni data vàlida → backoff per defecte, mai excepció.
    assert _retry_after_seconds("no-soc-una-data", 1) == 3.0
