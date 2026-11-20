"""Typed availability failures shared by native readers and their callers."""

from __future__ import annotations

import errno
from pathlib import Path
from typing import Literal

AvailabilityReason = Literal["pending", "offline", "no_space", "permission", "unavailable"]


class MetadataUnavailable(RuntimeError):
    """A required file exists or may exist but cannot currently be read."""

    def __init__(
        self, message: str = "Cloud file is unavailable", *, path: Path | None = None,
        reason: AvailabilityReason = "unavailable", retryable: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.path = path
        self.reason = reason
        self.retryable = reason not in {"permission", "no_space"} if retryable is None else retryable

    @classmethod
    def from_oserror(cls, path: Path, error: OSError) -> MetadataUnavailable:
        reason: AvailabilityReason = "unavailable"
        if isinstance(error, PermissionError) or error.errno in {errno.EACCES, errno.EPERM, errno.ELOOP}:
            reason = "permission"
        elif error.errno in {errno.ENOSPC, getattr(errno, "EDQUOT", -1)}:
            reason = "no_space"
        elif error.errno in {errno.ENETDOWN, errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ENOTCONN}:
            reason = "offline"
        elif isinstance(error, TimeoutError) or error.errno in {errno.EAGAIN, errno.EDEADLK, errno.EBUSY, errno.ETIMEDOUT}:
            reason = "pending"
        return cls(f"Cloud file is {reason}", path=path, reason=reason)
