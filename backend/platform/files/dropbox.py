"""Dropbox adapter for macOS File Provider based folders."""

from __future__ import annotations

from .on_demand import OnDemandFilesProvider


class DropboxProvider(OnDemandFilesProvider):
    """Hydrate Dropbox placeholders without vendor process side effects."""

    name = "dropbox"
    env_prefix = "DROPBOX"
