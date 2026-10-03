"""Recover cloud placeholders for all .gnosi metadata in the background.

Hidden metadata uses bounded native coordination, independently of the optional
legacy BD warmup. No document/attachment trees or symlinks are traversed.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from pathlib import Path
from typing import List

from backend.platform.files import FilesProvider, get_files_provider
from backend.platform.files.coordinated import is_cloud_placeholder
from backend.utils.metadata_io import MetadataUnavailable, ensure_metadata_local

log = logging.getLogger(__name__)

# Folders read on essentially every request: the DB registry and the page
# metadata (icons, dashboards). Kept small on purpose — we do NOT warm the whole
# vault (Biblioteca, attachments…), only what the UI needs to render on load.
_CRITICAL_SUBDIRS = [("BD",)]

# Bound concurrency so we don't flood OneDrive (which then throttles/deadlocks).
_MAX_CONCURRENT = 6

# Guard against re-entrancy: one warmup pass per vault path at a time.
_running: set[str] = set()
_running_guard = threading.Lock()
_last_pass: dict[str, float] = {}

_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_FALSE_VALUES = frozenset({"0", "false", "no", "off"})


def _critical_warmup_enabled(provider: FilesProvider) -> bool:
    """Return whether bulk hydration is safe for the current runtime.

    Native File Provider access remains on demand. Hydrating an entire critical
    tree can starve selected-file reads, so both coordinated and legacy GUI
    modes are lazy by default. Daemon-backed runtimes preserve the
    existing proactive behavior. An explicit override always wins.
    """
    configured = os.environ.get("GNOSI_CRITICAL_WARMUP")
    if configured is not None:
        normalized = configured.strip().lower()
        if normalized in _TRUE_VALUES:
            return True
        if normalized in _FALSE_VALUES:
            return False
        log.warning(
            "Invalid GNOSI_CRITICAL_WARMUP=%r; bulk warmup disabled.",
            configured,
        )
        return False
    return getattr(provider, "warmup_mode", None) not in {"open", "coordinated"}


def _scan_online_only(root: Path) -> List[Path]:
    """Returns the online-only (``dataless``) files under ``root``.

    Blocking (walks the FS): call from a thread. Ordinary sparse local files
    are not cloud placeholders. Symlink directories and files are excluded.
    """
    out: List[Path] = []
    for dirpath, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if not (Path(dirpath) / name).is_symlink()]
        for name in files:
            p = os.path.join(dirpath, name)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            if not Path(p).is_symlink() and is_cloud_placeholder(Path(p), st):
                out.append(Path(p))
    return out


async def _warm_critical(vault_path: str) -> None:
    """Materialize the online-only files under the vault's critical folders."""
    # All hidden metadata is explicitly requested by the user. Use bounded
    # coordinated reads, never GUI opening or restarting the sync client.
    metadata = Path(vault_path) / ".gnosi"
    if metadata.is_dir() and not metadata.is_symlink():
        for path in await asyncio.to_thread(_scan_online_only, metadata):
            try:
                await asyncio.to_thread(ensure_metadata_local, path)
            except MetadataUnavailable:
                log.warning("Cloud metadata remains unavailable: %s", path.name)
    provider = get_files_provider()
    if not _critical_warmup_enabled(provider):
        log.info(
            "☁️ Critical-warmup skipped for %s mode; files remain on demand.",
            getattr(provider, "warmup_mode", "local"),
        )
        return
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
    with _running_guard:
        if vault_path in _running or time.monotonic() - _last_pass.get(vault_path, -300) < 300:
            return
        _running.add(vault_path)

    async def _runner() -> None:
        try:
            await _warm_critical(vault_path)
        except Exception as e:  # noqa: BLE001
            log.warning("⚠️ Critical-warmup pass errored for %s: %s", vault_path, e)
        finally:
            with _running_guard:
                _running.discard(vault_path)
                _last_pass[vault_path] = time.monotonic()
                if len(_last_pass) > 128:
                    _last_pass.pop(next(iter(_last_pass)))

    try:
        asyncio.get_running_loop().create_task(_runner())
    except RuntimeError:
        # Authorized workspace dependencies run in sync worker threads.
        # Never hold that worker until the entire metadata tree is downloaded.
        threading.Thread(
            target=lambda: asyncio.run(_runner()),
            name="gnosi-vault-warmup", daemon=True,
        ).start()
