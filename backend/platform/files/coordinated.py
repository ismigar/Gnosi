"""Bounded, read-only access to macOS File Provider files.

The signed helper uses NSFileCoordinator, not LaunchServices or a vendor API.
It is a separate process because a provider can block a filesystem read even
after an asyncio request is cancelled. Timing out reaps that process instead
of accumulating stuck request threads. No file contents leave the helper.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Darwin sys/stat.h. Python versions bundled by PyInstaller may not export it.
SF_DATALESS = 0x40000000


def is_placeholder(stat_result: os.stat_result) -> bool:
    """Cloud-provider detection; zero-byte local files are not placeholders."""
    if getattr(stat_result, "st_flags", 0) & SF_DATALESS:
        return True
    return (
        getattr(stat_result, "st_size", 1) > 0
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


async def materialize_coordinated(path: Path, timeout: float) -> bool:
    """Ask the provider for exactly one authorized file; never pin a tree."""
    if sys.platform != "darwin" or not path.is_absolute():
        return False
    process = None
    try:
        executable = helper_path()
        process = await asyncio.create_subprocess_exec(
            str(executable), str(path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(process.wait(), timeout=max(0.1, min(timeout, 30.0)))
        return process.returncode == 0
    except (OSError, ValueError, asyncio.TimeoutError):
        return False
    finally:
        if process is not None and process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
