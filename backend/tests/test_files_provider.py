"""Unit tests for `backend.services.files_provider`.

Validate the contract of the multi-provider abstraction layer (see
`docs/engineering/domains/vault-files.md`):

- `LocalProvider`, `OneDriveProvider`, `iCloudDriveProvider` honor
  the `FilesProvider` interface.
- The `get_files_provider()` factory resolves the correct implementation
  based on env vars (explicit `GNOSI_FILES_PROVIDER` + `VAULT_HOST_PATH`
  heuristic).
- The singleton is built only once (lazy + thread-safe).
- Provider-specific environment values and recovery behavior do not leak
  between vendors.

Does NOT cover:
    - Real call to the HTTP daemon (requires the daemon running on the host).
    - `st_blocks==0` behavior on real OneDrive/iCloud files
      (the File Provider's behavior is macOS's, not ours).

Run inside the container:
    docker exec gnosi_backend python -m pytest backend/tests/test_files_provider.py -v
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

import backend.services.files_provider as fp
from backend.services.files_provider import (
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


# --- Fixtures -----------------------------------------------------------

ENV_KEYS = (
    "GNOSI_FILES_PROVIDER",
    "VAULT_HOST_PATH",
    "ONEDRIVE_WARMUP_URL",
    "ONEDRIVE_WARMUP_TIMEOUT",
    "ONEDRIVE_WARMUP_MODE",
    "ONEDRIVE_AUTO_RESTART",
    "ICLOUD_WARMUP_URL",
    "ICLOUD_WARMUP_TIMEOUT",
    "ICLOUD_WARMUP_MODE",
    "GDRIVE_WARMUP_URL",
    "GDRIVE_WARMUP_TIMEOUT",
    "GDRIVE_WARMUP_MODE",
    "NEXTCLOUD_WARMUP_URL",
    "NEXTCLOUD_WARMUP_TIMEOUT",
    "NEXTCLOUD_WARMUP_MODE",
    "NEXTCLOUD_PLACEHOLDER_EXT",
    "DROPBOX_WARMUP_URL",
    "DROPBOX_WARMUP_TIMEOUT",
    "DROPBOX_WARMUP_MODE",
    "FILEPROVIDER_WARMUP_URL",
    "FILEPROVIDER_WARMUP_TIMEOUT",
    "FILEPROVIDER_WARMUP_MODE",
)


@pytest.fixture(autouse=True)
def _reset_provider_state(monkeypatch):
    """Each test starts from a clean singleton and an environment with the
    relevant vars cleared. This way we avoid leaks between tests."""
    fp._provider_instance = None
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    yield
    fp._provider_instance = None


# --- Heuristic detection ------------------------------------------------


def test_default_no_env_returns_local():
    assert get_files_provider().name == "local"


def test_explicit_local_env(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "local")
    monkeypatch.setenv("VAULT_HOST_PATH", "/Users/foo/OneDrive-UNED/X")
    # Explicit override wins over the OneDrive heuristic.
    assert get_files_provider().name == "local"


def test_onedrive_path_detected(monkeypatch):
    monkeypatch.setenv("VAULT_HOST_PATH", "/Users/foo/OneDrive-UNED/Gnosi")
    p = get_files_provider()
    assert p.name == "onedrive"
    assert isinstance(p, OneDriveProvider)
    # And not the subclass — important for logs and metrics.
    assert not isinstance(p, iCloudDriveProvider)


def test_icloud_mobile_documents_path_detected(monkeypatch):
    monkeypatch.setenv(
        "VAULT_HOST_PATH",
        "/Users/foo/Library/Mobile Documents/com~apple~CloudDocs/Gnosi",
    )
    p = get_files_provider()
    assert p.name == "icloud"
    assert isinstance(p, iCloudDriveProvider)
    assert isinstance(p, OnDemandFilesProvider)
    assert not isinstance(p, OneDriveProvider)


def test_icloud_literal_in_path_case_insensitive(monkeypatch):
    monkeypatch.setenv("VAULT_HOST_PATH", "/srv/iCloud/MyVault")
    assert get_files_provider().name == "icloud"


def test_explicit_icloud_overrides_heuristic(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "icloud")
    monkeypatch.setenv("VAULT_HOST_PATH", "/some/random/path")
    assert get_files_provider().name == "icloud"


# --- Heuristic: GoogleDrive and NextCloud ---------------------------------


def test_gdrive_path_detected(monkeypatch):
    monkeypatch.setenv(
        "VAULT_HOST_PATH",
        "/Users/foo/Library/CloudStorage/GoogleDrive-foo@gmail.com/My Drive/Gnosi",
    )
    p = get_files_provider()
    assert p.name == "gdrive"
    assert isinstance(p, GoogleDriveProvider)


def test_gdrive_path_with_space_detected(monkeypatch):
    """Some old translations or configs show 'Google Drive' with a space."""
    monkeypatch.setenv("VAULT_HOST_PATH", "/Volumes/Google Drive/Gnosi")
    assert get_files_provider().name == "gdrive"


def test_nextcloud_path_detected_case_insensitive(monkeypatch):
    monkeypatch.setenv("VAULT_HOST_PATH", "/Users/foo/Nextcloud/Gnosi")
    p = get_files_provider()
    assert p.name == "nextcloud"
    assert isinstance(p, NextCloudProvider)


def test_dropbox_cloudstorage_path_detected(monkeypatch):
    monkeypatch.setenv(
        "VAULT_HOST_PATH",
        "/Users/foo/Library/CloudStorage/Dropbox/Gnosi",
    )
    provider = get_files_provider()
    assert provider.name == "dropbox"
    assert isinstance(provider, DropboxProvider)


def test_unknown_macos_file_provider_path_uses_generic_adapter(monkeypatch):
    monkeypatch.setenv(
        "VAULT_HOST_PATH",
        "/Users/foo/Library/CloudStorage/FutureCloud/Gnosi",
    )
    provider = get_files_provider()
    assert provider.name == "fileprovider"
    assert type(provider) is OnDemandFilesProvider


def test_explicit_gdrive_override(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "gdrive")
    assert get_files_provider().name == "gdrive"


def test_explicit_nextcloud_override(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "nextcloud")
    assert get_files_provider().name == "nextcloud"


def test_explicit_fileprovider_override(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "fileprovider")
    assert get_files_provider().name == "fileprovider"


def test_explicit_dropbox_override(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "dropbox")
    assert get_files_provider().name == "dropbox"


def test_onedrive_takes_precedence_over_other_keywords(monkeypatch):
    """If the path has multiple keywords, OneDrive wins (the most
    common installation in Gnosi)."""
    monkeypatch.setenv(
        "VAULT_HOST_PATH",
        "/Users/foo/OneDrive-Personal/Backups/Nextcloud-export/Gnosi",
    )
    assert get_files_provider().name == "onedrive"


def test_unknown_explicit_falls_back_to_heuristic(monkeypatch, caplog):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "unknown-cloud")
    # Without VAULT_HOST_PATH → the heuristic returns `local`.
    p = get_files_provider()
    assert p.name == "local"
    # And it gets logged to help with debugging.
    assert any("desconegut" in r.message for r in caplog.records)


# --- Singleton ----------------------------------------------------------


def test_get_files_provider_returns_same_instance():
    a = get_files_provider()
    b = get_files_provider()
    assert a is b


# --- LocalProvider ------------------------------------------------------


def test_local_is_never_online_only(tmp_path):
    p = LocalProvider()
    f = tmp_path / "x.txt"
    f.write_text("hi")
    assert p.is_online_only(f) is False
    assert p.is_online_only(tmp_path / "missing") is False


def test_local_materialize_is_noop_true(tmp_path):
    p = LocalProvider()
    assert asyncio.run(p.materialize(tmp_path / "anything")) is True


# --- OneDriveProvider ---------------------------------------------------


def test_onedrive_is_online_only_normal_file_returns_false(tmp_path):
    p = OneDriveProvider()
    f = tmp_path / "img.jpg"
    f.write_bytes(b"x" * 1024)
    assert p.is_online_only(f) is False


def test_onedrive_is_online_only_with_fake_stat_zero_blocks(tmp_path):
    """If the caller already has a stat_result, we avoid the double stat."""
    p = OneDriveProvider()
    f = tmp_path / "ghost.jpg"
    f.write_bytes(b"placeholder")
    fake = SimpleNamespace(st_size=12345, st_blocks=0)
    assert p.is_online_only(f, stat_result=fake) is True


def test_onedrive_is_online_only_returns_false_on_stat_error(tmp_path):
    """Non-existent path → we shouldn't return True (we can't assert
    online-only without a reliable stat)."""
    p = OneDriveProvider()
    assert p.is_online_only(tmp_path / "nope.jpg") is False


def test_onedrive_default_warmup_url_docker(monkeypatch):
    """In Docker the warmup default targets the host daemon in daemon mode."""
    monkeypatch.setattr("backend.services.files_provider.on_demand._is_docker", lambda: True)
    p = OneDriveProvider()
    assert p.warmup_url == "http://host.docker.internal:5009/warmup"
    assert p.warmup_mode == "daemon"
    assert p.warmup_timeout_s == 100.0


def test_onedrive_default_warmup_native_macos(monkeypatch):
    """On native macOS (no Docker) the default is LaunchServices "open" mode and
    the daemon URL — used only if forced back to daemon — is the loopback one.
    This is what lets native installs work without exporting ONEDRIVE_WARMUP_MODE."""
    monkeypatch.setattr("backend.services.files_provider.on_demand._is_docker", lambda: False)
    monkeypatch.setattr("backend.services.files_provider.on_demand.sys.platform", "darwin")
    monkeypatch.delenv("ONEDRIVE_WARMUP_MODE", raising=False)
    p = OneDriveProvider()
    assert p.warmup_mode == "open"
    assert p.warmup_url == "http://127.0.0.1:5009/warmup"


def test_onedrive_env_vars_override(monkeypatch):
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://custom:7000/warmup")
    monkeypatch.setenv("ONEDRIVE_WARMUP_TIMEOUT", "30")
    p = OneDriveProvider()
    assert p.warmup_url == "http://custom:7000/warmup"
    assert p.warmup_timeout_s == 30.0


# --- iCloudDriveProvider ------------------------------------------------


def test_icloud_inherits_provider_neutral_runtime():
    p = iCloudDriveProvider()
    assert isinstance(p, OnDemandFilesProvider)
    assert not isinstance(p, OneDriveProvider)
    assert p.name == "icloud"


def test_icloud_prefers_icloud_env_over_onedrive(monkeypatch):
    monkeypatch.setenv("ICLOUD_WARMUP_URL", "http://icloud:6000/warmup")
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://onedrive:5009/warmup")
    p = iCloudDriveProvider()
    assert p.warmup_url == "http://icloud:6000/warmup"


def test_icloud_does_not_inherit_onedrive_env(monkeypatch):
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://shared:5009/warmup")
    p = iCloudDriveProvider()
    assert p.warmup_url != "http://shared:5009/warmup"


def test_icloud_timeout_from_icloud_env(monkeypatch):
    monkeypatch.setenv("ICLOUD_WARMUP_TIMEOUT", "42")
    p = iCloudDriveProvider()
    assert p.warmup_timeout_s == 42.0


# --- GoogleDriveProvider -------------------------------------------------


def test_gdrive_inherits_provider_neutral_runtime():
    p = GoogleDriveProvider()
    assert isinstance(p, OnDemandFilesProvider)
    assert not isinstance(p, OneDriveProvider)
    assert p.name == "gdrive"


def test_gdrive_prefers_gdrive_env_over_onedrive(monkeypatch):
    monkeypatch.setenv("GDRIVE_WARMUP_URL", "http://gdrive:7000/warmup")
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://onedrive:5009/warmup")
    p = GoogleDriveProvider()
    assert p.warmup_url == "http://gdrive:7000/warmup"


def test_gdrive_does_not_inherit_onedrive_env(monkeypatch):
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://shared:5009/warmup")
    p = GoogleDriveProvider()
    assert p.warmup_url != "http://shared:5009/warmup"


def test_gdrive_timeout_from_gdrive_env(monkeypatch):
    monkeypatch.setenv("GDRIVE_WARMUP_TIMEOUT", "55")
    p = GoogleDriveProvider()
    assert p.warmup_timeout_s == 55.0


# --- NextCloudProvider ---------------------------------------------------


def test_nextcloud_name_and_inheritance():
    p = NextCloudProvider()
    assert p.name == "nextcloud"
    assert isinstance(p, OnDemandFilesProvider)
    assert not isinstance(p, OneDriveProvider)
    assert isinstance(p, FilesProvider)


def test_nextcloud_default_placeholder_extension():
    p = NextCloudProvider()
    assert p.placeholder_ext == ".nc-virt"


def test_nextcloud_placeholder_extension_from_env(monkeypatch):
    monkeypatch.setenv("NEXTCLOUD_PLACEHOLDER_EXT", ".ncfile")
    p = NextCloudProvider()
    assert p.placeholder_ext == ".ncfile"


def test_nextcloud_is_online_only_by_extension(tmp_path):
    p = NextCloudProvider()
    f = tmp_path / "doc.nc-virt"
    f.write_bytes(b"placeholder")
    assert p.is_online_only(f) is True


def test_nextcloud_is_online_only_by_file_provider_blocks(tmp_path):
    provider = NextCloudProvider()
    path = tmp_path / "document.md"
    path.write_text("placeholder")
    fake = SimpleNamespace(st_size=12345, st_blocks=0)
    assert provider.is_online_only(path, stat_result=fake) is True


def test_nextcloud_is_online_only_normal_file(tmp_path):
    p = NextCloudProvider()
    f = tmp_path / "doc.md"
    f.write_text("# real content")
    # No xattr or extension → not online-only.
    assert p.is_online_only(f) is False


def test_nextcloud_is_online_only_missing_path(tmp_path):
    p = NextCloudProvider()
    assert p.is_online_only(tmp_path / "missing.txt") is False


def test_nextcloud_prefers_own_env(monkeypatch):
    monkeypatch.setenv("NEXTCLOUD_WARMUP_URL", "http://nextcloud:8000/warmup")
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://onedrive:5009/warmup")
    p = NextCloudProvider()
    assert p.warmup_url == "http://nextcloud:8000/warmup"


@pytest.mark.parametrize(
    "provider_cls",
    [iCloudDriveProvider, GoogleDriveProvider, NextCloudProvider, DropboxProvider],
)
def test_non_onedrive_provider_has_no_onedrive_recovery(provider_cls, monkeypatch):
    monkeypatch.setenv("ONEDRIVE_AUTO_RESTART", "1")
    provider = provider_cls()
    assert not hasattr(provider, "_auto_restart")
    assert asyncio.run(provider._recover_after_failed_warmup()) is False


def test_provider_modes_do_not_leak_between_vendors(monkeypatch):
    monkeypatch.setenv("ONEDRIVE_WARMUP_MODE", "direct")
    monkeypatch.setenv("GDRIVE_WARMUP_MODE", "daemon")
    assert OneDriveProvider().warmup_mode == "direct"
    assert GoogleDriveProvider().warmup_mode == "daemon"
    assert iCloudDriveProvider().warmup_mode != "direct"


# --- Contract: all comply with FilesProvider ----------------------------


@pytest.mark.parametrize(
    "cls",
    [
        LocalProvider,
        OneDriveProvider,
        iCloudDriveProvider,
        GoogleDriveProvider,
        NextCloudProvider,
        DropboxProvider,
        OnDemandFilesProvider,
    ],
)
def test_provider_class_satisfies_interface(cls):
    p = cls()
    assert isinstance(p, FilesProvider)
    assert hasattr(p, "name") and isinstance(p.name, str)
    assert callable(p.is_online_only)
    assert asyncio.iscoroutinefunction(p.materialize)
