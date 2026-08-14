"""Proactive warmup of the vault's CRITICAL files (OneDrive online-only).

Background, best-effort materialization of the folders the app hits on every
cold start — the registry under ``BD/`` and the per-page metadata under
``.gnosi/page_meta/``. When these sit as OneDrive ``dataless`` placeholders, the
first burst of requests (opening Settings loads databases, tables, graph…) each
block on an on-access download, saturating the request threadpool until even a
DB-only endpoint like ``/api/vaults`` starves and the frontend gives up with a
raw ``timeout of 30000ms exceeded``.

This is the in-process, always-on version of the one-off ``rehydrate_vault.py``
script: instead of the operator warming files by hand after an incident, the
backend does it itself on startup (and on vault switch), through the same
``files_provider`` that talks to the warmup daemon. Fully best-effort — if the
cloud service is down or a file can't be downloaded, the per-request warmup
paths (``_materialize_if_online_only``) remain the safety net.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import List

from backend.services.files_provider import get_files_provider

log = logging.getLogger(__name__)

# Folders read on essentially every request: the DB registry and the page
# metadata (icons, dashboards). Kept small on purpose — we do NOT warm the whole
# vault (Biblioteca, attachments…), only what the UI needs to render on load.
_CRITICAL_SUBDIRS = [("BD",), (".gnosi", "page_meta")]

# Bound concurrency so we don't flood OneDrive (which then throttles/deadlocks).
_MAX_CONCURRENT = 6

# Guard against re-entrancy: one warmup pass per vault path at a time.
_running: set[str] = set()


def _scan_online_only(root: Path) -> List[Path]:
    """Returns the online-only (``dataless``) files under ``root``.

    Blocking (walks the FS) — call from a thread. Uses ``st_blocks == 0`` with a
    non-zero size, matching the provider's ``is_online_only`` heuristic without
    an extra stat per file.
    """
    out: List[Path] = []
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            p = os.path.join(dirpath, name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            if getattr(st, "st_blocks", 1) == 0 and st.st_size > 0:
                out.append(Path(p))
    return out


async def _warm_critical(vault_path: str) -> None:
    """Materialize the online-only files under the vault's critical folders."""
    provider = get_files_provider()
    base = Path(vault_path)
    targets = [base.joinpath(*parts) for parts in _CRITICAL_SUBDIRS]

    pending: List[Path] = []
    for target in targets:
        if not target.is_dir():
            continue
        try:
            pending += await asyncio.to_thread(_scan_online_only, target)
        except Exception as e:  # noqa: BLE001
            log.debug("Critical-warmup scan failed for %s: %s", target, e)

    if not pending:
        log.info("💾 Critical-warmup: vault already local (0 online-only in BD/.gnosi).")
        return

    log.info("☁️ Critical-warmup: materializing %d online-only file(s)…", len(pending))
    sem = asyncio.Semaphore(_MAX_CONCURRENT)
    recovered = 0

    async def _one(p: Path) -> None:
        nonlocal recovered
        async with sem:
            try:
                if await provider.materialize(p):
                    recovered += 1
            except Exception as e:  # noqa: BLE001
                log.debug("Critical-warmup failed for %s: %s", p, e)

    await asyncio.gather(*(_one(p) for p in pending))
    log.info("☁️→💾 Critical-warmup done: %d/%d file(s) materialized.", recovered, len(pending))


def kickoff_critical_warmup(vault_path: str | None) -> None:
    """Launch the critical-folder warmup in the background (non-blocking).

    Safe to call from the lifespan startup or on a vault switch. Never raises;
    de-duplicates concurrent passes for the same vault.
    """
    if not vault_path:
        return
    if vault_path in _running:
        return

    async def _runner() -> None:
        _running.add(vault_path)
        try:
            await _warm_critical(vault_path)
        except Exception as e:  # noqa: BLE001
            log.warning("⚠️ Critical-warmup pass errored for %s: %s", vault_path, e)
        finally:
            _running.discard(vault_path)

    try:
        asyncio.get_running_loop().create_task(_runner())
    except RuntimeError:
        # No running loop (called from a sync context without asyncio): run to
        # completion in a throwaway loop. Best-effort; should not happen from
        # the FastAPI lifespan.
        try:
            asyncio.run(_runner())
        except Exception as e:  # noqa: BLE001
            log.debug("Critical-warmup could not run without a loop: %s", e)
