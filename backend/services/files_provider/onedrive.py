"""Compatibility facade for :mod:`backend.platform.files.onedrive`."""

from backend.platform.files.onedrive import (
    OneDriveProvider,
    _default_warmup_mode,
    _default_warmup_url,
    _is_docker,
)

__all__ = [
    "OneDriveProvider",
    "_default_warmup_mode",
    "_default_warmup_url",
    "_is_docker",
]
