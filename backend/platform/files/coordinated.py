"""Bounded, read-only access to macOS File Provider files.

The signed helper uses NSFileCoordinator, not LaunchServices or a vendor API.
It is a separate process because a provider can block a filesystem read even
after an asyncio request is cancelled. Timing out reaps that process instead
of accumulating stuck request threads. Snapshot bytes go only to the private
descriptor supplied by the caller.
"""

from __future__ import annotations

import asyncio
import json
import os
import stat
import sys
import threading
from pathlib import Path
from typing import BinaryIO

from .availability import AvailabilityReason, MetadataUnavailable

# Darwin sys/stat.h. Python versions bundled by PyInstaller may not export it.
SF_DATALESS = 0x40000000
_active_materializations: set[asyncio.subprocess.Process] = set()
_shutdown_requested = threading.Event()


def cancel_materializations_for_shutdown() -> None:
    """Stop only our helper children, including a spawn racing desktop exit.

    The desktop startup signal boundary calls this before Python joins metadata
    worker threads. A provider blocked in NSFileCoordinator cannot outlive the
    parent that enforces its deadline. The provider application stays untouched.
    """
    _shutdown_requested.set()
    for process in tuple(_active_materializations):
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass


def is_placeholder(stat_result: os.stat_result) -> bool:
    """Cloud-provider detection; zero-byte local files are not placeholders."""
    if getattr(stat_result, "st_flags", 0) & SF_DATALESS:
        return True
    # APFS directories normally have a size but no allocated data blocks.
    return (
        stat.S_ISREG(getattr(stat_result, "st_mode", stat.S_IFREG))
        and getattr(stat_result, "st_size", 1) > 0
        and getattr(stat_result, "st_blocks", 1) == 0
    )


def is_cloud_placeholder(path: Path, stat_result: os.stat_result) -> bool:
    """Cheap index guard that never treats ordinary sparse local files as cloud."""
    return bool(getattr(stat_result, "st_flags", 0) & SF_DATALESS) or (
        sys.platform == "darwin"
        and ("/Library/CloudStorage/" in str(path) or "/Library/Mobile Documents/" in str(path))
        and is_placeholder(stat_result)
    )


def helper_path() -> Path:
    configured = os.environ.get("GNOSI_FILE_ACCESS_HELPER")
    if configured:
        path = Path(configured)
        if not path.is_absolute():
            raise ValueError("GNOSI_FILE_ACCESS_HELPER must be absolute")
        return path
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent.parent / "native" / "gnosi-file-access"
    return Path(__file__).resolve().parents[3] / "desktop/native-build/gnosi-file-access"


_EXIT_REASONS: dict[int, AvailabilityReason] = {
    69: "offline", 73: "no_space", 75: "pending", 77: "permission",
}


async def _run(path: Path, timeout: float, target: BinaryIO | None = None) -> bytes:
    if sys.platform != "darwin" or not path.is_absolute() or _shutdown_requested.is_set():
        raise MetadataUnavailable(path=path)
    process = None
    try:
        arguments = [str(helper_path()), str(path)]
        if target is not None:
            arguments.append("--snapshot")
        process = await asyncio.create_subprocess_exec(
            *arguments,
            stdout=target if target is not None else asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE if target is not None else asyncio.subprocess.DEVNULL,
        )
        _active_materializations.add(process)
        if _shutdown_requested.is_set():
            raise MetadataUnavailable(path=path)
        deadline = max(0.1, min(timeout, 30.0))
        control = b""
        if target is None:
            await asyncio.wait_for(process.wait(), timeout=deadline)
        else:
            _, control = await asyncio.wait_for(process.communicate(), timeout=deadline)
        if process.returncode != 0:
            reason = _EXIT_REASONS.get(process.returncode or 0, "unavailable")
            raise MetadataUnavailable(f"Cloud file is {reason}", path=path, reason=reason)
        return control
    except OSError as exc:
        raise MetadataUnavailable.from_oserror(path, exc) from exc
    except ValueError as exc:
        raise MetadataUnavailable(path=path) from exc
    finally:
        if process is not None:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            await process.wait()
            _active_materializations.discard(process)


async def copy_coordinated(path: Path, target: BinaryIO, timeout: float) -> os.stat_result:
    """Copy the complete coordinated revision and return its descriptor metadata."""
    control = await _run(path, timeout, target)
    try:
        fields = json.loads(control)
        if not isinstance(fields, list) or len(fields) != 20 or not all(type(n) is int for n in fields):
            raise ValueError("Invalid source stat")
        mode, ino, dev, nlink, uid, gid, size = fields[:7]
        times = fields[7:13]
        flags, blocks, block_size, rdev, gen, birth_seconds, birth_nanos = fields[13:]
        if not stat.S_ISREG(mode) or size != os.fstat(target.fileno()).st_size:
            raise ValueError("Incomplete coordinated read")
        extra: dict[str, int | float] = {
            "st_flags": flags, "st_blocks": blocks, "st_blksize": block_size, "st_rdev": rdev,
            "st_gen": gen, "st_birthtime": birth_seconds + birth_nanos / 1_000_000_000,
            "st_birthtime_ns": birth_seconds * 1_000_000_000 + birth_nanos,
        }
        for index, name in enumerate(("st_atime", "st_mtime", "st_ctime")):
            seconds, nanos = times[2 * index:2 * index + 2]
            extra[name] = seconds + nanos / 1_000_000_000
            extra[f"{name}_ns"] = seconds * 1_000_000_000 + nanos
        return os.stat_result((mode, ino, dev, nlink, uid, gid, size, *times[::2]), extra)
    except (ValueError, TypeError, OSError) as exc:
        raise MetadataUnavailable("Incomplete coordinated file", path=path) from exc


async def materialize_coordinated(path: Path, timeout: float) -> bool:
    """Compatibility operation for callers that only require local availability."""
    try:
        await _run(path, timeout)
        return True
    except MetadataUnavailable:
        return False
