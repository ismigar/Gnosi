"""Sanitized pre-readiness failures for the owned desktop process."""
from __future__ import annotations

import os
import re
import signal
import sys
import threading
from contextlib import contextmanager
from collections.abc import Iterator
from types import FrameType

from backend.platform.files.coordinated import cancel_materializations_for_shutdown
from backend.utils.metadata_io import MetadataUnavailable


@contextmanager
def desktop_startup_errors() -> Iterator[None]:
    """Fail closed; never turn unread Vault configuration into defaults."""
    identity = os.environ.get("GNOSI_DESKTOP_INSTANCE", "")
    desktop = re.fullmatch(r"[a-f0-9]{64}", identity) is not None
    previous_handler = None
    terminating = False
    if desktop and threading.current_thread() is threading.main_thread():
        previous_handler = signal.getsignal(signal.SIGTERM)

        def terminate_startup(_number: int, _frame: FrameType | None) -> None:
            nonlocal terminating
            terminating = True
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            cancel_materializations_for_shutdown()
            raise SystemExit(0)

        signal.signal(signal.SIGTERM, terminate_startup)
    try:
        yield
    except MetadataUnavailable:
        if not desktop:
            raise
        # Only a fixed code and the parent's process correlation token cross
        # this boundary. File paths, YAML and exception text stay private.
        sys.stderr.write(f"GNOSI_STARTUP_ERROR {identity} cloud_metadata_unavailable\n")
        sys.stderr.flush()
        raise SystemExit(74) from None
    finally:
        # Uvicorn owns shutdown after startup. On cancellation, keep repeated
        # termination signals ignored until the already-killed helpers are reaped.
        if previous_handler is not None and not terminating:
            signal.signal(signal.SIGTERM, previous_handler)
