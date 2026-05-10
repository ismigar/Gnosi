"""Capa d'abstracció per a proveïdors d'emmagatzematge cloud-on-demand.

Ús:
    from backend.services.files_provider import get_files_provider

    provider = get_files_provider()
    if provider.is_online_only(path):
        await provider.materialize(path)

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from .base import FilesProvider
from .gdrive import GoogleDriveProvider
from .icloud import iCloudDriveProvider
from .local import LocalProvider
from .nextcloud import NextCloudProvider
from .onedrive import OneDriveProvider

log = logging.getLogger(__name__)

__all__ = [
    "FilesProvider",
    "LocalProvider",
    "OneDriveProvider",
    "iCloudDriveProvider",
    "GoogleDriveProvider",
    "NextCloudProvider",
    "get_files_provider",
]

_provider_instance: Optional[FilesProvider] = None
_provider_lock = threading.Lock()


_KNOWN_PROVIDERS = {"local", "onedrive", "icloud", "gdrive", "nextcloud"}


def _detect_provider_name() -> str:
    """Decideix quin proveïdor instanciar segons env vars.

    Prioritat:
    1. `GNOSI_FILES_PROVIDER` (explícit: un de `_KNOWN_PROVIDERS`).
    2. Heurística sobre `VAULT_HOST_PATH`:
       - conté "OneDrive"                       → "onedrive"
       - conté "GoogleDrive" o "Google Drive"   → "gdrive"
       - conté "Mobile Documents"
         o "iCloud" (case-insens.)              → "icloud"
       - conté "Nextcloud" (case-insens.)       → "nextcloud"
       - altrament                              → "local"

    L'ordre de comprovacions és deliberat — `OneDrive` apareix primer
    perquè és la instal·lació més comuna i té match exacte; els altres
    són heurística de fallback.
    """
    explicit = os.environ.get("GNOSI_FILES_PROVIDER", "").strip().lower()
    if explicit in _KNOWN_PROVIDERS:
        return explicit
    if explicit:
        log.warning(
            "GNOSI_FILES_PROVIDER='%s' desconegut, usant detecció automàtica",
            explicit,
        )

    vault_host = os.environ.get("VAULT_HOST_PATH", "")
    vault_host_lower = vault_host.lower()
    if "OneDrive" in vault_host:
        return "onedrive"
    # Drive for Desktop (macOS modern) viu a `~/Library/CloudStorage/GoogleDrive-<account>/`.
    if "GoogleDrive" in vault_host or "Google Drive" in vault_host:
        return "gdrive"
    # `Mobile Documents` és el nom intern de macOS per al directori sincronitzat
    # amb iCloud (~/Library/Mobile Documents/com~apple~CloudDocs/...). Alguns
    # usuaris muntem alies amb "iCloud" al nom; cobrim ambdós casos.
    if "Mobile Documents" in vault_host or "icloud" in vault_host_lower:
        return "icloud"
    if "nextcloud" in vault_host_lower:
        return "nextcloud"
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
    if name == "local":
        return LocalProvider()
    raise ValueError(f"Proveïdor desconegut: {name!r}")


def get_files_provider() -> FilesProvider:
    """Retorna el proveïdor singleton, instanciat lazy al primer ús."""
    global _provider_instance
    if _provider_instance is not None:
        return _provider_instance
    with _provider_lock:
        if _provider_instance is None:
            name = _detect_provider_name()
            _provider_instance = _build_provider(name)
            log.info("FilesProvider actiu: %s", _provider_instance.name)
    return _provider_instance
