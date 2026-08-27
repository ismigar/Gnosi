"""Compatibility facade for the provider-neutral file platform.

New code must import :mod:`backend.platform.files`.  This historical package
remains available through Gnosi 3.x for plugins and external integrations.
"""

from backend.platform.files import (
    DropboxProvider,
    FilesProvider,
    GoogleDriveProvider,
    LocalProvider,
    NextCloudProvider,
    OnDemandFilesProvider,
    OneDriveProvider,
    get_files_provider,
    iCloudDriveProvider,
)

__all__ = [
    "DropboxProvider",
    "FilesProvider",
    "GoogleDriveProvider",
    "LocalProvider",
    "NextCloudProvider",
    "OnDemandFilesProvider",
    "OneDriveProvider",
    "get_files_provider",
    "iCloudDriveProvider",
]
