"""Bounded, provider-neutral loading of independent calendar accounts."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import logging
from typing import Optional, Sequence

from backend.services.hybrid_calendar_service import GoogleAuthExpired, list_events

log = logging.getLogger(__name__)
_MAX_ACCOUNT_FETCH_WORKERS = 4


@dataclass(frozen=True)
class CalendarAccountEvents:
    email: str
    cache_key: str
    events: list[dict[str, object]]
    succeeded: bool


def fetch_calendar_accounts(
    accounts: Sequence[tuple[str, str]],
    time_min: str,
    time_max: str,
    search: Optional[str],
    calendar_id: Optional[str],
) -> list[CalendarAccountEvents]:
    """Load independent accounts concurrently while isolating provider failures."""

    def fetch_account(account: tuple[str, str]) -> CalendarAccountEvents:
        email, cache_key = account
        try:
            events = list_events(email, time_min, time_max, search, calendar_id)
        except GoogleAuthExpired:
            log.info(
                "fetch_calendar_accounts: Google authentication expired for %s; skipping",
                email,
            )
            return CalendarAccountEvents(email, cache_key, [], False)
        except Exception as error:
            log.warning("fetch_calendar_accounts: el compte %s ha fallat: %s", email, error)
            return CalendarAccountEvents(email, cache_key, [], False)
        return CalendarAccountEvents(email, cache_key, events, True)

    if not accounts:
        return []
    worker_count = min(_MAX_ACCOUNT_FETCH_WORKERS, len(accounts))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        return list(executor.map(fetch_account, accounts))
