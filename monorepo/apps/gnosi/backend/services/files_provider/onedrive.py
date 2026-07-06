"""OneDriveProvider: vault sobre OneDrive amb Files On-Demand.

Encapsula la detecció de fitxers online-only i la crida al daemon que
viu al host (`sh/onedrive_warmup_daemon.py`) per disparar la baixada
del File Provider de macOS.

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
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
    """Detecció + materialització per a OneDrive (File Provider macOS)."""

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
        # Mode de materialització:
        #   "daemon" (default) → crida el daemon HTTP del host (cas Docker, on
        #                        el backend NO té accés directe al File Provider).
        #   "direct"           → llegeix el fitxer directament EN PROCÉS. A macOS
        #                        això NO funciona des del backend NATIU: uvicorn
        #                        corre sota launchd i el File Provider d'OneDrive
        #                        torna EDEADLK (errno 11) instantani a qualsevol
        #                        procés de launchd. Es manté per compatibilitat/
        #                        diagnòstic, però en natiu useu "open".
        #   "open"             → materialitza via LaunchServices (`open -g -j -a
        #                        <app>`), que llança una app GUI a la sessió Aqua
        #                        de l'usuari; l'app llegeix el fitxer en el context
        #                        correcte i OneDrive el baixa. És el mode per al
        #                        runtime NATIU. Cf. feedback_onedrive_warmup_native.
        self.warmup_mode = os.environ.get("ONEDRIVE_WARMUP_MODE", "daemon").strip().lower()
        # App GUI que LaunchServices obre per disparar la baixada (mode "open").
        # Preview llegeix imatges/PDF; qualsevol app que llegeixi el fitxer val.
        self._warmup_open_app = os.environ.get("ONEDRIVE_WARMUP_OPEN_APP", "Preview").strip()
        self.warmup_timeout_s = (
            warmup_timeout_s
            if warmup_timeout_s is not None
            else float(os.environ.get("ONEDRIVE_WARMUP_TIMEOUT", "100"))
        )
        self.vault_host_path = vault_host_path or os.environ.get("VAULT_HOST_PATH")
        self.container_root = Path(container_root)
        # Roots muntats IDENTITAT al contenidor (mateixa ruta host ↔
        # contenidor, veure docker-compose): els seus paths no necessiten
        # traducció — es passen tal qual al daemon, que valida contra la
        # seva pròpia allowlist (multi-root des del 2026-05-18). HOME cobreix
        # adjunts `~/...` fora del vault (p. ex. Documents/); la Biblioteca
        # viu DINS del vault (vault-first pur) i va pel mount del vault.
        # Es descarta "/" (un env mal configurat convertiria TOT el sistema
        # de fitxers en identity root; el daemon ho rebutjaria igualment,
        # però no hi deleguem la validació). `resolve()` als roots perquè la
        # comparació amb el candidat (també resolt) sigui consistent si hi
        # ha symlinks pel camí.
        self.identity_roots = [
            Path(p).resolve() for p in (
                os.environ.get("HOME_HOST_PATH"),
            ) if p and p.rstrip("/")
        ]

        # Serialitzem warmups: OneDrive baixa més de pressa quan no rep
        # peticions concurrents, i evitem que un sol client (50 thumbs
        # alhora) sature el daemon. Creació lazy (al primer ús de
        # `materialize`) perquè `asyncio.Semaphore()` a Python 3.9
        # requereix event loop al constructor — i aquest provider es
        # pot instanciar abans que existeixi cap loop (p. ex. tests
        # síncrons o startup mòdul).
        self._max_concurrent_warmups = max_concurrent_warmups
        self._semaphore: Optional[asyncio.Semaphore] = None
        # Coalesce: si dues peticions volen el mateix fitxer alhora,
        # només cridem el daemon una vegada.
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
        """True si el fitxer existeix però `st_blocks == 0` (placeholder
        del File Provider de macOS no materialitzat)."""
        if stat_result is None:
            try:
                stat_result = container_path.stat()
            except OSError:
                return False
        # `getattr` amb default 1 perquè en sistemes que no exposen
        # st_blocks (p. ex. alguns FUSE) no volem disparar warmup.
        return getattr(stat_result, "st_blocks", 1) == 0

    async def _materialize_direct(self, container_path: Path) -> bool:
        """Materialitza llegint el fitxer directament: a macOS, accedir a un
        placeholder dataless del File Provider en dispara la baixada on-access.
        Mode per al runtime NATIU (el backend té accés directe al vault, a
        diferència de Docker). Evita el daemon HTTP i el seu Full Disk Access."""
        def _read() -> bool:
            import time as _t
            for attempt in range(6):
                try:
                    with open(container_path, "rb") as f:
                        f.read(65536)  # tocar-lo n'hi ha prou: macOS baixa tot el fitxer
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
        """Dispara `open -g -j -a <app>` i sondeja `st_blocks` fins que el
        fitxer estigui materialitzat o s'exhaureixi el timeout. `-g` no porta
        l'app a primer pla i `-j` la llança oculta: no roba el focus."""
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
        # LaunchServices retorna immediatament; l'app manté el document obert i
        # OneDrive baixa en segon pla (pot trigar desenes de segons). Sondegem.
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
        """Tanca NOMÉS el document que hem obert nosaltres a l'app helper
        (per ruta), alliberant el handle sense tocar les finestres de l'usuari.
        Best-effort: qualsevol error s'ignora."""
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
        """Mode "open" (natiu): materialitza via LaunchServices. Coalesça
        peticions concurrents del mateix fitxer i serialitza amb el semàfor
        (OneDrive baixa més ràpid sense concurrència)."""
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
        """Materialitza un fitxer online-only. En mode "open" (natiu) el
        delega a LaunchServices; en "direct" el llegeix en procés (no funciona
        sota launchd); en "daemon" (Docker) crida el daemon del host
        (`sh/onedrive_warmup_daemon.py`). Retorna True si s'ha materialitzat."""
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
            # Fora de /vault: pot ser un mount identitat (Biblioteca, HOME),
            # on la ruta del contenidor JA és la ruta del host. Abans aquest
            # branch retornava False en silenci (DEBUG) i els PDFs de
            # Biblioteca quedaven en 503 "warmup pending" indefinidament.
            # `resolve()` col·lapsa `..` i symlinks ABANS del check: sense
            # això, un `<root>/../x` passaria el prefix textual (el daemon
            # re-valida amb resolve()+allowlist, però no deleguem la
            # normalització).
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
            # Si el task propietari és CANCEL·LAT (p. ex. l'asyncio.wait_for
            # de bulk_warm_previews, o un shutdown), CancelledError és
            # BaseException i NO passa per l'except d'amunt: el Future
            # quedaria orfe i els waiters coalescits (`await inflight`)
            # penjarien per sempre. set_result(False), no cancel(): cancel·lar
            # propagaria CancelledError a waiters innocents.
            if not fut.done():
                fut.set_result(False)
            self._inflight.pop(host_path, None)
