"""Sanitized pre-readiness failures for the owned desktop process."""
from __future__ import annotations

import os
import re
import sys
from contextlib import contextmanager
from collections.abc import Iterator

from backend.utils.metadata_io import MetadataUnavailable


@contextmanager
def desktop_startup_errors() -> Iterator[None]:
    """Fail closed; never turn unread Vault configuration into defaults."""
    try:
        yield
    except MetadataUnavailable:
        identity = os.environ.get("GNOSI_DESKTOP_INSTANCE", "")
        if not re.fullmatch(r"[a-f0-9]{64}", identity):
            raise
        # Only a fixed code and the parent's process correlation token cross
        # this boundary. File paths, YAML and exception text stay private.
        sys.stderr.write(f"GNOSI_STARTUP_ERROR {identity} cloud_metadata_unavailable\n")
        sys.stderr.flush()
        raise SystemExit(74) from None
