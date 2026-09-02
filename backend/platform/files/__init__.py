"""Abstraction layer for cloud-on-demand storage providers.

Usage:
    from backend.platform.files import get_files_provider

    provider = get_files_provider()
    if provider.is_online_only(path):
        await provider.materialize(path)

See `docs/engineering/domains/vault-files.md`.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from .base import FilesProvider
from .dropbox import DropboxProvider
from .gdrive import GoogleDriveProvider
from .icloud import iCloudDriveProvider
from .local import LocalProvider
from .nextcloud import NextCloudProvider
from .on_demand import OnDemandFilesProvider
from .onedrive import OneDriveProvider

log = logging.getLogger(__name__)

__all__ = [
    "FilesProvider",
    "DropboxProvider",
    "LocalProvider",
    "OnDemandFilesProvider",
    "OneDriveProvider",
    "iCloudDriveProvider",
    "GoogleDriveProvider",
    "NextCloudProvider",
    "get_files_provider",
]

_provider_instance: Optional[FilesProvider] = None
_provider_lock = threading.Lock()


_KNOWN_PROVIDERS = {
    "local",
    "fileprovider",
    "onedrive",
    "icloud",
    "gdrive",
    "nextcloud",
    "dropbox",
}


def _detect_provider_name() -> str:
    """Decides which provider to instantiate based on env vars.

    Priority:
    1. `GNOSI_FILES_PROVIDER` (explicit: one of `_KNOWN_PROVIDERS`).
    2. Heuristic based on Docker's `VAULT_HOST_PATH`, falling back to the
       native runtime's `DIGITAL_BRAIN_VAULT_PATH`:
       - contains "OneDrive"                    → "onedrive"
       - contains "GoogleDrive" or "Google Drive" → "gdrive"
       - contains "Mobile Documents"
         or "iCloud" (case-insens.)              → "icloud"
       - contains "Nextcloud" (case-insens.)     → "nextcloud"
       - contains "Dropbox" (case-insens.)       → "dropbox"
       - another macOS CloudStorage path          → "fileprovider"
       - otherwise                               → "local"

    The order of checks is deliberate — `OneDrive` comes first
    because it's the most common installation and has an exact match; the others
    are fallback heuristics.

    """
    explicit = os.environ.get("GNOSI_FILES_PROVIDER", "").strip().lower()
    if explicit in _KNOWN_PROVIDERS:
        return explicit
    if explicit:
        log.warning(
            "GNOSI_FILES_PROVIDER='%s' desconegut, usant detecció automàtica",
            explicit,
        )

    vault_host = (
        os.environ.get("VAULT_HOST_PATH", "").strip()
        or os.environ.get("DIGITAL_BRAIN_VAULT_PATH", "").strip()
    )
    vault_host_lower = vault_host.lower()
    if "OneDrive" in vault_host:
        return "onedrive"
    # Drive for Desktop (macOS modern) viu a `~/Library/CloudStorage/GoogleDrive-<account>/`.
    if "GoogleDrive" in vault_host or "Google Drive" in vault_host:
        return "gdrive"
    # `Mobile Documents` is the internal macOS name for the synced directory
    # with iCloud (~/Library/Mobile Documents/com~apple~CloudDocs/...). Some
    # users mount aliases with "iCloud" in the name; we cover both cases.
    if "Mobile Documents" in vault_host or "icloud" in vault_host_lower:
        return "icloud"
    if "nextcloud" in vault_host_lower:
        return "nextcloud"
    if "dropbox" in vault_host_lower:
        return "dropbox"
    if "/library/cloudstorage/" in vault_host_lower:
        return "fileprovider"
    return "local"


def _build_provider(name: str) -> FilesProvider:
    if name == "onedrive":
        return OneDriveProvider()
    if name == "icloud":
        return iCloudDriveProvider()
    if name == "gdrive":
        return GoogleDriveProvider()
    if name == "nextcloud":
        return NextCloudProvider()
    if name == "dropbox":
        return DropboxProvider()
    if name == "fileprovider":
        return OnDemandFilesProvider()
    if name == "local":
        return LocalProvider()
    raise ValueError(f"Proveïdor desconegut: {name!r}")


def get_files_provider() -> FilesProvider:
    """Returns the singleton provider, lazily instantiated on first use."""
    global _provider_instance
    if _provider_instance is not None:
        return _provider_instance
    with _provider_lock:
        if _provider_instance is None:
            name = _detect_provider_name()
            _provider_instance = _build_provider(name)
            log.info("FilesProvider actiu: %s", _provider_instance.name)
    return _provider_instance
