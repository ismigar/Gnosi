"""IMAP IDLE service: push notifications quan arriben missatges nous.

Funcionament:
  - Per cada compte IMAP enabled, llança un thread daemon que manté una
    connexió IMAP oberta a INBOX i fa servir el comand IDLE (RFC 2177).
  - El servidor envia notificacions sense petició quan canvia la carpeta
    (EXISTS, EXPUNGE, FETCH).
  - Cada notificació rellevant es publica a una cua interna que els
    consumidors SSE poden subscriure.
  - Cada ~28 minuts el worker reinicia la connexió IDLE (Gmail i altres
    servidors tallen connexions inactives a 30' segons RFC).

Limitacions:
  - imaplib no té helper IDLE; usem accés directe a `_new_tag` i el socket
    intern. Funciona des de Python 3.8+ amb imaplib estàndard.
  - Si la xarxa cau, el worker fa backoff exponencial fins re-connectar.
  - El refresh d'access_token OAuth2 es fa via `_connect`, igual que altres
    serveis IMAP. Si caduca, el worker s'atura i logueja error clar.
"""
from __future__ import annotations

import logging
import socket
import threading
import time
from collections import deque
from typing import Callable, Deque, Optional

log = logging.getLogger(__name__)


_IDLE_REFRESH_S = 28 * 60   # renovar IDLE cada 28 min
_RECONNECT_BACKOFF_S = (5, 15, 60, 120, 300)  # backoff exponencial per reconnect


class _Subscriber:
    """Un consumidor d'events. Conté una cua local thread-safe."""
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
    """Gestiona workers IDLE per cada compte i distribueix events a subscriptors."""

    def __init__(self):
        self._workers: dict[str, threading.Thread] = {}
        self._stop_flags: dict[str, threading.Event] = {}
        self._subscribers: list[_Subscriber] = []
        self._sub_lock = threading.Lock()
        self._running = False

    # ── Subscriptors (SSE clients) ──────────────────────────────────────

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

    # ── Cicle de vida dels workers ──────────────────────────────────────

    def start_all(self) -> None:
        """Llança un worker per cada compte IMAP habilitat. Idempotent."""
        if self._running:
            return
        self._running = True

        try:
            from backend.services.integration_manager import integration_manager
        except Exception as e:
            log.error(f"[IDLE] No s'ha pogut carregar integration_manager: {e}")
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
        log.info(f"[IDLE] Worker iniciat per {email_account}")

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

    # ── Worker IDLE (un per compte) ─────────────────────────────────────

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

                    # Capacitat IDLE?
                    try:
                        _, caps_data = imap.capability()
                        caps = b" ".join(caps_data).decode().upper() if caps_data else ""
                        if "IDLE" not in caps:
                            log.info(f"[IDLE] Servidor sense capacitat IDLE per {email_account}")
                            return
                    except Exception:
                        return

                    imap.select("INBOX")
                    attempt = 0  # reset backoff després de connexió OK
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
        """Una sessió IDLE: envia IDLE, llegeix events, surt cada ~28 min o per stop."""
        tag = imap._new_tag().decode()  # noqa: SLF001 — accés al protocol intern
        try:
            imap.send(f"{tag} IDLE\r\n".encode())
        except OSError as e:
            log.warning(f"[IDLE] No s'ha pogut enviar IDLE a {email_account}: {e}")
            return

        # Llegir línia inicial "+ idling"
        sock = imap.socket()
        prev_timeout = sock.gettimeout()
        try:
            sock.settimeout(10)
            try:
                line = imap.readline()
            except OSError as e:
                log.debug(f"[IDLE] Timeout esperant '+ idling' per {email_account}: {e}")
                return

            if not line.startswith(b"+ "):
                log.warning(f"[IDLE] Resposta inesperada al IDLE per {email_account}: {line!r}")
                return

            log.debug(f"[IDLE] {email_account}: idling…")
            start = time.monotonic()
            sock.settimeout(60)  # timeout per polling regular del stop event

            while not stop.is_set():
                if time.monotonic() - start > _IDLE_REFRESH_S:
                    break  # renovació periòdica
                try:
                    line = imap.readline()
                except socket.timeout:
                    continue
                except OSError as e:
                    log.debug(f"[IDLE] Socket OSError per {email_account}: {e}")
                    return

                if not line:
                    return  # connexió tallada

                s = line.decode("utf-8", errors="replace").strip()
                # Format típic: "* 12 EXISTS", "* 5 EXPUNGE", "* 12 FETCH (FLAGS (\\Seen))"
                if " EXISTS" in s:
                    self._broadcast({
                        "account": email_account,
                        "type": "new_message",
                        "raw": s,
                    })
                    log.info(f"[IDLE] {email_account}: nou missatge ({s})")
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
            # DONE per sortir d'IDLE
            try:
                sock.settimeout(10)
                imap.send(b"DONE\r\n")
                # Consumim la confirmació final del tag
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
