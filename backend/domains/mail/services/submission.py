"""Bound mail submission without treating a cancelled wait as cancelled delivery."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
import threading
import time

from fastapi import HTTPException

SUBMISSION_TIMEOUT_S = 90.0
_deadline: ContextVar[float | None] = ContextVar("mail_submission_deadline", default=None)
_owners: set[tuple[str, str]] = set()
_owners_lock = threading.Lock()


class MailDeliveryUnknown(Exception):
    """The transport did not establish whether the provider accepted the message."""


def transport_timeout(default: float = 30.0) -> float:
    deadline = _deadline.get()
    if deadline is None:
        return default
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Mail submission deadline exceeded")
    return min(default, remaining)


def in_submission() -> bool:
    return _deadline.get() is not None


def _account_key(email: str) -> tuple[str, str]:
    from backend.services.integration_manager import integration_manager

    # Integrations are global to this store (also across the install's vaults).
    # Resolve aliases from metadata, without reading credentials on this path.
    account = integration_manager.get_mail_account(email, resolve_secrets=False)
    if account is None:
        for candidate in integration_manager._mail_account_refs():
            if any(str(a.get("email", "")).strip().casefold() == email.strip().casefold()
                   for a in candidate.get("aliases", [])):
                account = candidate
                break
    canonical = (account or {}).get("email") or (account or {}).get("username") or email
    return str(integration_manager.config_file.resolve()), str(canonical).strip().casefold()


def _worker(email: str, operation: Callable[[], Awaitable[bool]], deadline: float) -> bool:
    key = _account_key(email)
    with _owners_lock:
        if key in _owners:
            raise HTTPException(409, detail={"code": "mail_send_in_progress"})
        _owners.add(key)
    token = _deadline.set(deadline)
    try:
        # A worker-local loop keeps legacy async CID preparation and all its
        # synchronous provider calls away from the ASGI event loop.
        transport_timeout()

        async def deliver() -> bool:
            return await operation()

        return asyncio.run(deliver())
    finally:
        _deadline.reset(token)
        with _owners_lock:
            _owners.discard(key)


def _observe_finished(task: asyncio.Task[bool]) -> None:
    # A disconnected/timed-out request still owns its worker until completion.
    # Retrieve late errors without logging private message/account data.
    if not task.cancelled():
        task.exception()


async def submit_mail(email: str, operation: Callable[[], Awaitable[bool]]) -> bool:
    deadline = time.monotonic() + SUBMISSION_TIMEOUT_S
    worker = asyncio.create_task(asyncio.to_thread(_worker, email, operation, deadline))
    worker.add_done_callback(_observe_finished)
    try:
        return await asyncio.wait_for(asyncio.shield(worker), timeout=SUBMISSION_TIMEOUT_S)
    except HTTPException:
        raise
    except (TimeoutError, MailDeliveryUnknown) as exc:
        raise HTTPException(504, detail={"code": "mail_delivery_unknown"}) from exc
    except Exception as exc:
        # Unexpected provider errors must not encourage a blind retry.
        raise HTTPException(502, detail={"code": "mail_delivery_unknown"}) from exc
