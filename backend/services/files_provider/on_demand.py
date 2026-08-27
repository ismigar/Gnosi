"""Compatibility facade for :mod:`backend.platform.files.on_demand`."""

from backend.platform.files.on_demand import (
    OnDemandFilesProvider,
    _default_warmup_mode,
    _default_warmup_url,
    _is_docker,
)

__all__ = [
    "OnDemandFilesProvider",
    "_default_warmup_mode",
    "_default_warmup_url",
    "_is_docker",
]
