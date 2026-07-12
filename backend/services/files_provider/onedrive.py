"""OneDriveProvider: vault over OneDrive with Files On-Demand.

Encapsulates detection of online-only files and the call to the daemon that
lives on the host (`sh/onedrive_warmup_daemon.py`) to trigger the download
from the macOS File Provider.

See `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Dict, Optional

from .base import FilesProvider

log = logging.getLogger(__name__)


class OneDriveProvider(FilesProvider):
    """Detection + materialization for OneDrive (macOS File Provider)."""

    name = "onedrive"

    def __init__(
        self,
        warmup_url: Optional[str] = None,
        warmup_timeout_s: Optional[float] = None,
        vault_host_path: Optional[str] = None,
        container_root: str = "/vault",
        max_concurrent_warmups: int = 2,
    ) -> None:
        self.warmup_url = warmup_url or os.environ.get(
            "ONEDRIVE_WARMUP_URL",
            "http://host.docker.internal:5009/warmup",
        )
        # Materialization mode:
        #   "daemon" (default) → calls the host's HTTP daemon (Docker case, where
        #                        the backend does NOT have direct access to the File Provider).
        #   "direct"           → reads the file directly IN-PROCESS. On macOS
        #                        this does NOT work from the NATIVE backend: uvicorn
        #                        runs under launchd and OneDrive's File Provider
        #                        returns EDEADLK (errno 11) instantly for any
        #                        a launchd process. Kept for compatibility/
        #                        diagnostics, but in native use "open".
        #   "open"             → materialitza via LaunchServices (`open -g -j -a
        #                        <app>`), which launches a GUI app in the Aqua session
        #                        of the user; the app reads the file in the context
        #                        correct one, and OneDrive downloads it. It's the mode for the
        #                        runtime NATIU. Cf. feedback_onedrive_warmup_native.
        self.warmup_mode = os.environ.get("ONEDRIVE_WARMUP_MODE", "daemon").strip().lower()
        # GUI app that LaunchServices opens to trigger the download ("open" mode).
        # Preview reads images/PDF; any app that reads the file works.
        self._warmup_open_app = os.environ.get("ONEDRIVE_WARMUP_OPEN_APP", "Preview").strip()
        self.warmup_timeout_s = (
            warmup_timeout_s
            if warmup_timeout_s is not None
            else float(os.environ.get("ONEDRIVE_WARMUP_TIMEOUT", "100"))
        )
        self.vault_host_path = vault_host_path or os.environ.get("VAULT_HOST_PATH")
        self.container_root = Path(container_root)
        # Roots mounted IDENTICALLY in the container (same host path ↔
        # container, see docker-compose): their paths don't need
        # translation — they're passed as-is to the daemon, which validates against its
        # own allowlist (multi-root since 2026-05-18). HOME covers
        # attachments `~/...` outside the vault (e.g. Documents/); the Library
        # lives INSIDE the vault (pure vault-first) and goes through the vault mount.
        # We discard "/" (a misconfigured env var would turn the WHOLE system
        # of files in identity root; the daemon would reject it anyway,
        # but we don't delegate validation to it). `resolve()` on the roots so that the
        # comparison with the candidate (also resolved) is consistent if there
        # are symlinks along the way.
        self.identity_roots = [
            Path(p).resolve() for p in (
                os.environ.get("HOME_HOST_PATH"),
            ) if p and p.rstrip("/")
        ]

        # We serialize warmups: OneDrive downloads faster when it doesn't receive
        # concurrent requests, and we prevent a single client (50 thumbs
        # at the same time) overload the daemon. Lazy creation (on first use of
        # `materialize`) because `asyncio.Semaphore()` in Python 3.9
        # requires an event loop in the constructor — and this provider
        # can be instantiated before any loop exists (e.g. tests
        # synchronous contexts or module startup).
        self._max_concurrent_warmups = max_concurrent_warmups
        self._semaphore: Optional[asyncio.Semaphore] = None
        # Coalesce: if two requests want the same file at the same time,
        # we only call the daemon once.
        self._inflight: Dict[str, asyncio.Future] = {}

    def _get_semaphore(self) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self._max_concurrent_warmups)
        return self._semaphore

    @staticmethod
    def _is_under(path: Path, root: Path) -> bool:
        try:
            return path.is_relative_to(root)
        except AttributeError:  # Python < 3.9
            return str(path).startswith(str(root) + os.sep) or path == root

    def is_online_only(
        self,
        container_path: Path,
        stat_result: Optional[os.stat_result] = None,
    ) -> bool:
        """True if the file exists but `st_blocks == 0` (placeholder
        from the macOS File Provider not yet materialized)."""
        if stat_result is None:
            try:
                stat_result = container_path.stat()
            except OSError:
                return False
        # `getattr` with default 1 because on systems that don't expose
        # st_blocks (e.g. some FUSE) we don't want to trigger warmup.
        return getattr(stat_result, "st_blocks", 1) == 0

    async def _materialize_direct(self, container_path: Path) -> bool:
        """Materializes by reading the file directly: on macOS, accessing a
        dataless placeholder from the File Provider triggers the on-access download.
        Mode for the NATIVE runtime (the backend has direct access to the vault, as
        opposed to Docker). Avoids the HTTP daemon and its Full Disk Access."""
        def _read() -> bool:
            import time as _t
            for attempt in range(6):
                try:
                    with open(container_path, "rb") as f:
                        f.read(65536)  # touching it is enough: macOS downloads the whole file
                    return True
                except OSError as e:
                    # 35 EAGAIN / 11 EDEADLK: baixada en curs → backoff i reintenta.
                    if e.errno in (35, 11) and attempt < 5:
                        _t.sleep(0.3 * (2 ** attempt))
                        continue
                    log.warning("☁️ Materialització directa fallida per %s: %r", container_path, e)
                    return False
            return False
        ok = await asyncio.to_thread(_read)
        if ok:
            log.info("☁️→💾 Materialitzat (directe) %s", container_path.name)
        return ok

    def _blocks(self, container_path: Path) -> int:
        try:
            return getattr(container_path.stat(), "st_blocks", 1)
        except OSError:
            return 0

    async def _open_and_wait(self, container_path: Path) -> bool:
        """Triggers `open -g -j -a <app>` and polls `st_blocks` until the
        file is materialized or the timeout runs out. `-g` doesn't bring
        the app to the foreground and `-j` launches it hidden: it doesn't steal focus."""
        if self._blocks(container_path) > 0:
            return True
        app = self._warmup_open_app
        try:
            proc = await asyncio.create_subprocess_exec(
                "/usr/bin/open", "-g", "-j", "-a", app, str(container_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
        except OSError as e:
            log.warning("☁️ No s'ha pogut executar `open` per %s: %r", container_path, e)
            return False
        if proc.returncode != 0:
            log.warning(
                "☁️ `open -a %s` ha fallat per %s: %s",
                app, container_path, (err or b"").decode(errors="replace").strip(),
            )
            return False
        # LaunchServices returns immediately; the app keeps the document open and
        # OneDrive downloads in the background (it can take tens of seconds). We poll.
        waited = 0.0
        while waited < self.warmup_timeout_s:
            await asyncio.sleep(1.0)
            waited += 1.0
            if self._blocks(container_path) > 0:
                log.info(
                    "☁️→💾 Materialitzat (open/%s) %s en %.0fs",
                    app, container_path.name, waited,
                )
                await self._close_helper_doc(container_path)
                return True
        log.warning(
            "☁️ Materialització via open/%s no completada en %.0fs: %s",
            app, self.warmup_timeout_s, container_path,
        )
        await self._close_helper_doc(container_path)
        return False

    async def _close_helper_doc(self, container_path: Path) -> None:
        """Closes ONLY the document we opened ourselves in the helper app
        (by path), releasing the handle without touching the user's windows.
        Best-effort: any error is ignored."""
        app = self._warmup_open_app
        posix = json.dumps(str(container_path))  # literal AppleScript segur
        script = (
            f'tell application "{app}" to if it is running then '
            f'close (every document whose path is {posix})'
        )
        try:
            proc = await asyncio.create_subprocess_exec(
                "/usr/bin/osascript", "-e", script,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.communicate()
        except OSError:
            pass

    async def _materialize_via_open(self, container_path: Path) -> bool:
        """Mode "open" (native): materializes via LaunchServices. Coalesces
        concurrent requests for the same file and serializes them with the semaphore
        (OneDrive downloads faster without concurrency)."""
        key = str(container_path)
        inflight = self._inflight.get(key)
        if inflight is not None:
            try:
                return await inflight
            except Exception:
                return False
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._inflight[key] = fut
        try:
            async with self._get_semaphore():
                ok = await self._open_and_wait(container_path)
            if not fut.done():
                fut.set_result(ok)
            return ok
        except Exception as e:
            if not fut.done():
                fut.set_exception(e)
            return False
        finally:
            self._inflight.pop(key, None)

    async def materialize(self, container_path: Path) -> bool:
        """Materializes an online-only file. In "open" mode (native) it
        delegates to LaunchServices; in "direct" it reads it in-process (doesn't work
        under launchd); in "daemon" (Docker) it calls the host daemon
        (`sh/onedrive_warmup_daemon.py`). Returns True if it was materialized."""
        if self.warmup_mode == "open":
            return await self._materialize_via_open(container_path)
        if self.warmup_mode == "direct":
            return await self._materialize_direct(container_path)
        if not self.vault_host_path:
            log.debug("VAULT_HOST_PATH no configurat: warmup desactivat")
            return False
        try:
            rel = container_path.relative_to(self.container_root)
            host_path = str(Path(self.vault_host_path) / rel)
        except ValueError:
            # Outside /vault: it can be an identity mount (Library, HOME),
            # where the container path IS ALREADY the host path. Previously this
            # branch silently returned False (DEBUG) and the PDFs from
            # Library stayed at 503 "warmup pending" indefinitely.
            # `resolve()` collapses `..` and symlinks BEFORE the check: without
            # this, a `<root>/../x` would pass the textual prefix (the daemon
            # re-validates with resolve()+allowlist, but we don't delegate
            # normalization).
            resolved = container_path.resolve()
            if not any(self._is_under(resolved, root) for root in self.identity_roots):
                log.warning(
                    "☁️ Path fora de %s i de cap mount identitat, "
                    "no es pot warmup: %s",
                    self.container_root, container_path,
                )
                return False
            rel = resolved.name
            host_path = str(resolved)

        inflight = self._inflight.get(host_path)
        if inflight is not None:
            try:
                return await inflight
            except Exception:
                return False

        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._inflight[host_path] = fut
        try:
            async with self._get_semaphore():
                try:
                    import httpx
                    async with httpx.AsyncClient(timeout=self.warmup_timeout_s) as cli:
                        r = await cli.get(self.warmup_url, params={"path": host_path})
                    body = (
                        r.json()
                        if r.headers.get("content-type", "").startswith("application/json")
                        else {}
                    )
                    ok = r.status_code == 200 and body.get("status") == "materialized"
                    if ok:
                        log.info(
                            "☁️→💾 Materialitzat OneDrive %s (blocks=%s, %.1fs)",
                            rel, body.get("blocks"), body.get("elapsed", 0),
                        )
                    else:
                        log.warning(
                            "☁️ Warmup ha fallat per %s: HTTP %s %s",
                            rel, r.status_code, body,
                        )
                    fut.set_result(ok)
                    return ok
                except Exception as e:
                    log.warning("☁️ Warmup ha llançat excepció per %s: %r", rel, e)
                    fut.set_result(False)
                    return False
        finally:
            # If the owner task is CANCELLED (e.g. the asyncio.wait_for
            # from bulk_warm_previews, or a shutdown), CancelledError is
            # BaseException and does NOT go through the except above: the Future
            # would be left orphaned and the coalesced waiters (`await inflight`)
            # would hang forever. set_result(False), not cancel(): cancelling
            # propagaria CancelledError a waiters innocents.
            if not fut.done():
                fut.set_result(False)
            self._inflight.pop(host_path, None)
