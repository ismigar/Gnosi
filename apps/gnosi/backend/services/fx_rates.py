"""USD → user-currency conversion for the AI spend cap.

Model costs are USD per 1M tokens everywhere (models.dev, the router registry
and the usage ledger), but the user sets the monthly spend cap in the currency
configured in Settings › Language (`settings.currency`, e.g. "EUR (€)").

Layered like the model catalog, most fresh wins and it NEVER raises:

1. **Remote**: frankfurter.app (ECB reference rates, no API key), refreshed at
   most once per `_CACHE_TTL` and cached on disk OUTSIDE the vault/OneDrive.
2. **Disk cache**: last good snapshot (stale beats static).
3. **Static fallback**: approximate constants so a fully offline install still
   converts (values snapshotted mid-2026; only used when there is no cache).

Rates are expressed as *currency units per 1 USD* ("usd_rate"), matching the
frankfurter response for `from=USD`.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

FRANKFURTER_URL = "https://api.frankfurter.app/latest"
_CACHE_TTL = 24 * 3600   # ECB publishes once per working day
_MEM_TTL = 6 * 3600
_REMOTE_TIMEOUT = 5      # seconds; budget math must never hang a request

# Currencies offered in Settings (GlobalSettingsModal CURRENCIES) + USD.
CURRENCY_SYMBOLS: Dict[str, str] = {
    "EUR": "€", "USD": "$", "GBP": "£", "JPY": "¥", "CHF": "₣",
}

# Approximate units-per-USD, LAST-RESORT only (no network and no disk cache).
_STATIC_RATES: Dict[str, float] = {
    "USD": 1.0, "EUR": 0.86, "GBP": 0.74, "JPY": 147.0, "CHF": 0.80,
}

DEFAULT_CURRENCY = "EUR"  # mirrors the settings draft default in the UI


def parse_currency_code(raw: Optional[str]) -> str:
    """'EUR (€)' → 'EUR'. Unknown/empty values fall back to the UI default."""
    match = re.search(r"[A-Z]{3}", raw or "")
    return match.group(0) if match else DEFAULT_CURRENCY


def _cache_path() -> Optional[Path]:
    """Disk cache location; NEVER inside the vault/OneDrive (memory
    `feedback_cache_outside_onedrive`). Mirrors model_catalog._cache_path
    (canonical paths key: LOCAL_CACHE)."""
    base = None
    try:
        from backend.config.app_config import load_params
        paths = load_params(strict_env=False).paths
        base = paths.get("LOCAL_CACHE") or paths.get("LOCAL_DATA")
    except Exception:
        pass
    if base:
        root = Path(base)
        if root.name != "cache":
            root = root / "cache"
    else:
        root = Path.home() / ".cache" / "gnosi"
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception:
        return None
    return root / "fx_rates.json"


def _read_cache() -> Optional[Dict[str, Any]]:
    path = _cache_path()
    if not path or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _is_fresh(snapshot: Optional[Dict[str, Any]]) -> bool:
    if not snapshot:
        return False
    try:
        fetched = datetime.fromisoformat(snapshot.get("fetched_at", ""))
        return (datetime.now(timezone.utc) - fetched).total_seconds() < _CACHE_TTL
    except Exception:
        return False


def _fetch_remote() -> Optional[Dict[str, Any]]:
    """Download ECB rates for the supported currencies; None on any failure."""
    symbols = ",".join(c for c in CURRENCY_SYMBOLS if c != "USD")
    try:
        import requests
        resp = requests.get(
            FRANKFURTER_URL, params={"from": "USD", "to": symbols},
            timeout=_REMOTE_TIMEOUT,
        )
        resp.raise_for_status()
        rates = dict((resp.json() or {}).get("rates") or {})
        if not rates:
            return None
        rates["USD"] = 1.0
        return {
            "source": "frankfurter.app",
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rates": {k: float(v) for k, v in rates.items()},
        }
    except Exception as exc:
        log.info("fx rates: remote refresh unavailable (%s)", exc)
        return None


_mem_lock = threading.Lock()
_mem_snapshot: Optional[Dict[str, Any]] = None
_mem_cached_at = 0.0


def _load_snapshot() -> Dict[str, Any]:
    """Best available snapshot: fresh disk → remote → stale disk → static."""
    global _mem_snapshot, _mem_cached_at
    with _mem_lock:
        if _mem_snapshot and time.monotonic() - _mem_cached_at < _MEM_TTL:
            return _mem_snapshot

        cached = _read_cache()
        snapshot = cached if _is_fresh(cached) else None
        if snapshot is None:
            remote = _fetch_remote()
            if remote is not None:
                snapshot = remote
                path = _cache_path()
                if path:
                    try:
                        path.write_text(json.dumps(remote, ensure_ascii=False),
                                        encoding="utf-8")
                    except Exception:
                        pass
            else:
                snapshot = cached  # stale beats static: it was real once
        if snapshot is None:
            snapshot = {"source": "static", "fetched_at": "", "rates": dict(_STATIC_RATES)}

        _mem_snapshot = snapshot
        _mem_cached_at = time.monotonic()
        return snapshot


def rate_info(code: str) -> Dict[str, Any]:
    """{code, symbol, usd_rate, source, fetched_at} for a currency code.

    `usd_rate` = units of `code` per 1 USD; always > 0 (falls back to the
    static table, then 1.0, so division is always safe).
    """
    normalized = (code or "").strip().upper() or DEFAULT_CURRENCY
    if normalized == "USD":
        return {"code": "USD", "symbol": "$", "usd_rate": 1.0,
                "source": "fixed", "fetched_at": ""}
    snapshot = _load_snapshot()
    rate = snapshot.get("rates", {}).get(normalized)
    source = snapshot.get("source", "static")
    if not rate or rate <= 0:
        rate = _STATIC_RATES.get(normalized) or 1.0
        source = "static"
    return {
        "code": normalized,
        "symbol": CURRENCY_SYMBOLS.get(normalized, normalized),
        "usd_rate": float(rate),
        "source": source,
        "fetched_at": snapshot.get("fetched_at", ""),
    }


def usd_to_currency(amount_usd: float, code: str) -> float:
    return round(float(amount_usd) * rate_info(code)["usd_rate"], 4)


def currency_to_usd(amount_ccy: float, code: str) -> float:
    return round(float(amount_ccy) / rate_info(code)["usd_rate"], 4)
