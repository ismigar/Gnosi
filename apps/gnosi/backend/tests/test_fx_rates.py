"""Unit tests for the USD→settings-currency conversion layer (fx_rates).

No network: the remote fetch is stubbed out; the disk cache points at a
tempdir so a developer's real cache never leaks into assertions.
"""
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import backend.services.fx_rates as fx


def _fresh_remote(rates):
    """Remote snapshot stamped 'now' so freshness checks never age out."""
    return {"source": "frankfurter.app",
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rates": rates}


def _isolate(tmp: str, remote=None):
    """Point the module at a tempdir cache + a stubbed remote, reset memo."""
    fx._mem_snapshot = None
    fx._mem_cached_at = 0.0
    fx._cache_path = lambda: Path(tmp) / "fx_rates.json"
    fx._fetch_remote = (lambda: remote) if not callable(remote) else remote


def teardown_function(_fn):
    # Reload the module to undo the monkeypatching between tests
    import importlib
    importlib.reload(fx)


def test_parse_currency_code():
    assert fx.parse_currency_code("EUR (€)") == "EUR"
    assert fx.parse_currency_code("USD ($)") == "USD"
    assert fx.parse_currency_code("JPY (¥)") == "JPY"
    # empty / unknown → UI default
    assert fx.parse_currency_code("") == "EUR"
    assert fx.parse_currency_code(None) == "EUR"


def test_static_fallback_when_offline_and_no_cache():
    with tempfile.TemporaryDirectory() as tmp:
        _isolate(tmp, remote=None)
        info = fx.rate_info("EUR")
        assert info["source"] == "static"
        assert info["symbol"] == "€"
        assert info["usd_rate"] > 0


def test_usd_needs_no_lookup():
    info = fx.rate_info("USD")
    assert info == {"code": "USD", "symbol": "$", "usd_rate": 1.0,
                    "source": "fixed", "fetched_at": ""}


def test_remote_snapshot_cached_to_disk_and_reused():
    remote = _fresh_remote({"EUR": 0.9, "GBP": 0.75, "JPY": 150.0, "CHF": 0.82, "USD": 1.0})
    with tempfile.TemporaryDirectory() as tmp:
        _isolate(tmp, remote=remote)
        info = fx.rate_info("EUR")
        assert info["usd_rate"] == 0.9 and info["source"] == "frankfurter.app"
        # snapshot persisted
        on_disk = json.loads((Path(tmp) / "fx_rates.json").read_text(encoding="utf-8"))
        assert on_disk["rates"]["EUR"] == 0.9
        # second call with remote now failing → fresh disk cache wins
        _isolate(tmp, remote=None)
        info2 = fx.rate_info("GBP")
        assert info2["usd_rate"] == 0.75 and info2["source"] == "frankfurter.app"


def test_conversions_round_trip():
    remote = _fresh_remote({"EUR": 0.9, "GBP": 0.75, "JPY": 150.0, "CHF": 0.82, "USD": 1.0})
    with tempfile.TemporaryDirectory() as tmp:
        _isolate(tmp, remote=remote)
        assert fx.usd_to_currency(10.0, "EUR") == 9.0
        assert fx.currency_to_usd(9.0, "EUR") == 10.0
        assert fx.usd_to_currency(2.0, "USD") == 2.0


def test_unknown_currency_never_divides_by_zero():
    with tempfile.TemporaryDirectory() as tmp:
        _isolate(tmp, remote=None)
        info = fx.rate_info("XXX")
        assert info["usd_rate"] == 1.0  # last-resort neutral rate
        assert fx.currency_to_usd(5.0, "XXX") == 5.0
