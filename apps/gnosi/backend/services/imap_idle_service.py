"""IMAP IDLE service: push notifications when new messages arrive.

How it works:
  - For each enabled IMAP account, spawns a daemon thread that keeps an
    open IMAP connection to INBOX and uses the IDLE command (RFC 2177).
  - The server sends notifications without a request when the folder
    changes (EXISTS, EXPUNGE, FETCH).
  - Each relevant notification is published to an internal queue that
    SSE consumers can subscribe to.
  - Every ~28 minutes the worker restarts the IDLE connection (Gmail and
    other servers cut idle connections at 30' per RFC).

Limitations:
  - imaplib has no IDLE helper; we use direct access to `_new_tag` and the
    internal socket. Works from Python 3.8+ with standard imaplib.
  - If the network drops, the worker does exponential backoff until it
    reconnects.
  - The OAuth2 access_token refresh is done via `_connect`, same as other
    IMAP services. If it expires, the worker stops and logs a clear error.
"""
from __future__ import annotations

import logging
import socket
import threading
import time
from collections import deque
from typing import Callable, Deque, Optional

log = logging.getLogger(__name__)


_IDLE_REFRESH_S = 28 * 60   # renew IDLE every 28 min
_RECONNECT_BACKOFF_S = (1, 15, 60, 120, 300)  # exponential backoff for reconnect
# First retry at 1s because Gmail often cuts IDLE at ~60s; we want
# reduce the push coverage gap (1s between cycles instead of 5s).


class _Subscriber:
    """An event consumer. Contains a local thread-safe queue."""
    def __init__(self, account_filter: Optional[str] = None):
        self.account_filter = account_filter
        self.queue: Deque[dict] = deque(maxlen=1024)
        self.cond = threading.Condition()
        self.alive = True

    def push(self, event: dict) -> None:
        if self.account_filter and event.get("account") != self.account_filter:
            return
        with self.cond:
            self.queue.append(event)
            self.cond.notify()

    def pop_blocking(self, timeout: float = 30.0) -> Optional[dict]:
        with self.cond:
            if not self.queue:
                self.cond.wait(timeout=timeout)
            if self.queue:
                return self.queue.popleft()
            return None


class ImapIdleManager:
    """Manages IDLE workers for each account and distributes events to subscribers."""

    def __init__(self):
        self._workers: dict[str, threading.Thread] = {}
        self._stop_flags: dict[str, threading.Event] = {}
        self._subscribers: list[_Subscriber] = []
        self._sub_lock = threading.Lock()
        self._running = False

    # ── Subscribers (SSE clients) ───────────────────────────────────────

    def subscribe(self, account_filter: Optional[str] = None) -> _Subscriber:
        sub = _Subscriber(account_filter)
        with self._sub_lock:
            self._subscribers.append(sub)
        return sub

    def unsubscribe(self, sub: _Subscriber) -> None:
        sub.alive = False
        with self._sub_lock:
            try:
                self._subscribers.remove(sub)
            except ValueError:
                pass

    def _broadcast(self, event: dict) -> None:
        with self._sub_lock:
            subs = list(self._subscribers)
        for s in subs:
            try:
                s.push(event)
            except Exception:
                pass

    # ── Worker lifecycle ──────────────────────────────────────

    def start_all(self) -> None:
        """Launches a worker for each enabled IMAP account. Idempotent."""
        if self._running:
            return
        self._running = True

        try:
            from backend.services.integration_manager import integration_manager
        except Exception as e:
            log.error(f"[IDLE] Could not load integration_manager: {e}")
            return

        accounts = integration_manager.get_all_mail_accounts(only_enabled=True)
        for acc in accounts:
            if not integration_manager.is_imap_account(acc):
                continue
            email = acc.get("email") or acc.get("username")
            if not email:
                continue
            self.start_worker(email)

    def start_worker(self, email_account: str) -> None:
        if email_account in self._workers and self._workers[email_account].is_alive():
            return
        stop = threading.Event()
        self._stop_flags[email_account] = stop
        t = threading.Thread(
            target=self._worker_loop,
            args=(email_account, stop),
            name=f"imap-idle-{email_account}",
            daemon=True,
        )
        self._workers[email_account] = t
        t.start()
        log.info(f"[IDLE] Worker started for {email_account}")

    def stop_worker(self, email_account: str) -> None:
        stop = self._stop_flags.get(email_account)
        if stop:
            stop.set()
        self._workers.pop(email_account, None)
        self._stop_flags.pop(email_account, None)

    def stop_all(self) -> None:
        for em in list(self._workers.keys()):
            self.stop_worker(em)
        self._running = False

    # ── IDLE Worker (one per account) ─────────────────────────────────────

    def _worker_loop(self, email_account: str, stop: threading.Event) -> None:
        attempt = 0
        from backend.services.imap_mail_sync_service import imap_sync_service

        while not stop.is_set():
            try:
                with imap_sync_service._connect(email_account) as imap:  # noqa: SLF001
                    if imap is None:
                        # Auth fallida (token caducat, etc.). Backoff llarg.
                        log.warning(f"[IDLE] Auth fallida per {email_account}; reintent en 5 min")
                        if stop.wait(300):
                            return
                        continue

                    # IDLE capability?
                    try:
                        _, caps_data = imap.capability()
                        caps = b" ".join(caps_data).decode().upper() if caps_data else ""
                        if "IDLE" not in caps:
                            log.info(f"[IDLE] Server has no IDLE capability for {email_account}")
                            return
                    except Exception:
                        return

                    imap.select("INBOX")
                    attempt = 0  # reset backoff after successful connection
                    self._idle_session(imap, email_account, stop)
            except Exception as e:
                log.exception(f"[IDLE] Error al worker {email_account}: {e}")

            if stop.is_set():
                return

            delay = _RECONNECT_BACKOFF_S[min(attempt, len(_RECONNECT_BACKOFF_S) - 1)]
            attempt += 1
            log.info(f"[IDLE] Reconnectant {email_account} en {delay}s (intent #{attempt})")
            if stop.wait(delay):
                return

    def _idle_session(self, imap, email_account: str, stop: threading.Event) -> None:
        """An IDLE session: sends IDLE, reads events, exits every ~28 min or on stop."""
        tag = imap._new_tag().decode()  # noqa: SLF001 — internal protocol access
        try:
            imap.send(f"{tag} IDLE\r\n".encode())
        except OSError as e:
            log.warning(f"[IDLE] Could not send IDLE to {email_account}: {e}")
            return

        # Read initial line "+ idling"
        sock = imap.socket()
        prev_timeout = sock.gettimeout()
        try:
            sock.settimeout(10)
            try:
                line = imap.readline()
            except OSError as e:
                log.debug(f"[IDLE] Timed out waiting for '+ idling' for {email_account}: {e}")
                return

            if not line.startswith(b"+ "):
                log.warning(f"[IDLE] Unexpected IDLE response for {email_account}: {line!r}")
                return

            log.debug(f"[IDLE] {email_account}: idling…")
            start = time.monotonic()
            sock.settimeout(60)  # timeout for regular polling of the stop event

            while not stop.is_set():
                if time.monotonic() - start > _IDLE_REFRESH_S:
                    break  # periodic renewal
                try:
                    line = imap.readline()
                except socket.timeout:
                    continue
                except OSError as e:
                    log.debug(f"[IDLE] Socket OSError per {email_account}: {e}")
                    return

                if not line:
                    return  # connection dropped

                s = line.decode("utf-8", errors="replace").strip()
                # Typical format: "* 12 EXISTS", "* 5 EXPUNGE", "* 12 FETCH (FLAGS (\\Seen))"
                if " EXISTS" in s:
                    self._broadcast({
                        "account": email_account,
                        "type": "new_message",
                        "raw": s,
                    })
                    log.info(f"[IDLE] {email_account}: new message ({s})")
                elif " EXPUNGE" in s:
                    self._broadcast({
                        "account": email_account,
                        "type": "message_removed",
                        "raw": s,
                    })
                elif " FETCH" in s:
                    self._broadcast({
                        "account": email_account,
                        "type": "flags_changed",
                        "raw": s,
                    })
        finally:
            # DONE to exit IDLE
            try:
                sock.settimeout(10)
                imap.send(b"DONE\r\n")
                # Consume the final tag confirmation
                while True:
                    line = imap.readline()
                    if not line or line.startswith(tag.encode()):
                        break
            except OSError:
                pass
            try:
                sock.settimeout(prev_timeout)
            except Exception:
                pass


# Singleton
idle_manager = ImapIdleManager()
