"""Bounded, read-only access to macOS File Provider files.

The signed helper uses NSFileCoordinator, not LaunchServices or a vendor API.
It is a separate process because a provider can block a filesystem read even
after an asyncio request is cancelled. Timing out reaps that process instead
of accumulating stuck request threads. Snapshot bytes go only to the private
descriptor supplied by the caller.
"""

from __future__ import annotations

import atexit
import asyncio
import json
import os
import stat
import sys
import threading
from pathlib import Path
from typing import BinaryIO

from .availability import AvailabilityReason, MetadataUnavailable
from .skill_worker import LegacyHelper, SkillWorkers

# Darwin sys/stat.h. Python versions bundled by PyInstaller may not export it.
SF_DATALESS = 0x40000000
_active_materializations: set[asyncio.subprocess.Process] = set()
_shutdown_requested = threading.Event()
_skill_workers = SkillWorkers()
atexit.register(_skill_workers.close)


def cancel_materializations_for_shutdown() -> None:
    """Stop only our helper children, including a spawn racing desktop exit.

    The desktop startup signal boundary calls this before Python joins metadata
    worker threads. A provider blocked in NSFileCoordinator cannot outlive the
    parent that enforces its deadline. The provider application stays untouched.
    """
    _shutdown_requested.set()
    # The signal may interrupt ThreadPoolExecutor.submit on this same thread.
    # Close the processes here; the interpreter joins the executor during exit.
    _skill_workers.stop_children()
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


def _bundled_helper() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent.parent / "native" / "gnosi-file-access"
    return Path(__file__).resolve().parents[3] / "desktop/native-build/gnosi-file-access"


def helper_path() -> Path:
    configured = os.environ.get("GNOSI_FILE_ACCESS_HELPER")
    if configured:
        path = Path(configured)
        if not path.is_absolute():
            raise ValueError("GNOSI_FILE_ACCESS_HELPER must be absolute")
        return path
    return _bundled_helper()


_EXIT_REASONS: dict[int, AvailabilityReason] = {
    69: "offline", 73: "no_space", 75: "pending", 77: "permission",
}


def _check_status(status: int | None, path: Path) -> None:
    if status != 0:
        reason = _EXIT_REASONS.get(status or 0, "unavailable")
        raise MetadataUnavailable(f"Cloud file is {reason}", path=path, reason=reason)


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
        _check_status(process.returncode, path)
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


def _skill_snapshot(path: Path, target: BinaryIO) -> bool:
    if (sys.platform != "darwin" or not path.is_absolute()
            or path.name not in {"skill.yaml", "SKILL.md"}
            or path.parts[-5:-2] != (".gnosi", "agent", "skills")):
        return False
    # An alternate helper can implement its own per-path decision in its CLI.
    configured = os.environ.get("GNOSI_FILE_ACCESS_HELPER")
    if configured and Path(configured) != _bundled_helper():
        return False
    fd = target.fileno()
    info = os.fstat(fd)
    return (stat.S_ISREG(info.st_mode) and info.st_size == 0 and target.writable()
            and os.lseek(fd, 0, os.SEEK_CUR) == 0)


async def _snapshot_fields(path: Path, target: BinaryIO, timeout: float) -> object:
    if not _skill_snapshot(path, target):
        return json.loads(await _run(path, timeout, target))
    if _shutdown_requested.is_set():
        raise MetadataUnavailable(path=path)
    duration = max(0.1, min(timeout, 30.0))
    try:
        # One deadline covers the queue, process startup, read and any legacy fallback.
        async with asyncio.timeout(duration):
            try:
                status, fields = await _skill_workers.read(helper_path(), path, target.fileno(), duration)
            except LegacyHelper:
                return json.loads(await _run(path, duration, target))
            _check_status(status, path)
            return fields
    except OSError as exc:
        raise MetadataUnavailable.from_oserror(path, exc) from exc


def _source_stat(fields: object) -> os.stat_result:
    if not isinstance(fields, list) or len(fields) != 20 or not all(type(n) is int for n in fields):
        raise ValueError("Invalid source stat")
    mode, ino, dev, nlink, uid, gid, size = fields[:7]
    if not stat.S_ISREG(mode) or size < 0:
        raise ValueError("Invalid coordinated source")
    times = fields[7:13]
    flags, blocks, block_size, rdev, gen, birth_seconds, birth_nanos = fields[13:]
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


async def copy_coordinated(path: Path, target: BinaryIO, timeout: float) -> os.stat_result:
    """Copy the complete coordinated revision and return its descriptor metadata."""
    try:
        source = _source_stat(await _snapshot_fields(path, target, timeout))
        if source.st_size != os.fstat(target.fileno()).st_size:
            raise ValueError("Incomplete coordinated read")
        return source
    except (ValueError, TypeError, OverflowError, OSError) as exc:
        raise MetadataUnavailable("Incomplete coordinated file", path=path) from exc


async def verify_skill_sources(expected: dict[Path, tuple[int, ...]]) -> dict[Path, os.stat_result]:
    """Ask the bundled coordinator for fresh grants. Missing proof requires individual reads."""
    if sys.platform != "darwin" or not 1 <= len(expected) <= 256 or _shutdown_requested.is_set():
        return {}
    process = None
    try:
        helper = helper_path()
        if helper != _bundled_helper():
            return {}
        process = await asyncio.create_subprocess_exec(
            str(helper), "--verify-skill-sources", stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        _active_materializations.add(process)
        if _shutdown_requested.is_set():
            return {}
        data = json.dumps([(str(path), stamp) for path, stamp in expected.items()], ensure_ascii=False).encode()
        output, _ = await asyncio.wait_for(process.communicate(data), timeout=3)
        if process.returncode:
            return {}
        rows = json.loads(output)
        if not isinstance(rows, list) or len(rows) != len(expected):
            return {}
        return {path: _source_stat(row) for path, row in zip(expected, rows, strict=True)}
    except (OSError, TimeoutError, ValueError, TypeError, OverflowError):
        return {}
    finally:
        if process is not None:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            await process.wait()
            _active_materializations.discard(process)


async def materialize_coordinated(path: Path, timeout: float) -> bool:
    """Compatibility operation for callers that only require local availability."""
    try:
        await _run(path, timeout)
        return True
    except MetadataUnavailable:
        return False
