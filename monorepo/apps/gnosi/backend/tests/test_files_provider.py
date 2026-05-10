"""Tests d'unitat per a `backend.services.files_provider`.

Validen el contracte de la capa d'abstracció multi-proveïdor (vegeu
`docs/dev_memory/directives/files_provider_abstraction.md`):

- `LocalProvider`, `OneDriveProvider`, `iCloudDriveProvider` honoren
  l'interfície `FilesProvider`.
- La factory `get_files_provider()` resol la implementació correcta
  segons env vars (`GNOSI_FILES_PROVIDER` explícit + heurística
  `VAULT_HOST_PATH`).
- L'singleton es construeix una sola vegada (lazy + thread-safe).
- L'iCloud prioritza env vars `ICLOUD_*` abans de caure a `ONEDRIVE_*`.

NO cobreix:
    - Crida real al daemon HTTP (requereix daemon corrent al host).
    - Comportament `st_blocks==0` sobre fitxers reals d'OneDrive/iCloud
      (el comportament del File Provider és del macOS, no nostre).

Run dins el container:
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
    FilesProvider,
    LocalProvider,
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
    "ICLOUD_WARMUP_URL",
    "ICLOUD_WARMUP_TIMEOUT",
)


@pytest.fixture(autouse=True)
def _reset_provider_state(monkeypatch):
    """Cada test parteix d'un singleton net i un entorn buit de les vars
    rellevants. Així evitem fugues entre tests."""
    fp._provider_instance = None
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    yield
    fp._provider_instance = None


# --- Detecció heurística ------------------------------------------------

def test_default_no_env_returns_local():
    assert get_files_provider().name == "local"


def test_explicit_local_env(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "local")
    monkeypatch.setenv("VAULT_HOST_PATH", "/Users/foo/OneDrive-UNED/X")
    # Override explícit guanya per sobre de la heurística OneDrive.
    assert get_files_provider().name == "local"


def test_onedrive_path_detected(monkeypatch):
    monkeypatch.setenv("VAULT_HOST_PATH", "/Users/foo/OneDrive-UNED/Gnosi")
    p = get_files_provider()
    assert p.name == "onedrive"
    assert isinstance(p, OneDriveProvider)
    # I no la subclass — important per a logs i mètriques.
    assert not isinstance(p, iCloudDriveProvider)


def test_icloud_mobile_documents_path_detected(monkeypatch):
    monkeypatch.setenv(
        "VAULT_HOST_PATH",
        "/Users/foo/Library/Mobile Documents/com~apple~CloudDocs/Gnosi",
    )
    p = get_files_provider()
    assert p.name == "icloud"
    assert isinstance(p, iCloudDriveProvider)
    # iCloud hereta de OneDrive: la detecció `isinstance(OneDriveProvider)`
    # encara és True però el name és "icloud".
    assert isinstance(p, OneDriveProvider)


def test_icloud_literal_in_path_case_insensitive(monkeypatch):
    monkeypatch.setenv("VAULT_HOST_PATH", "/srv/iCloud/MyVault")
    assert get_files_provider().name == "icloud"


def test_explicit_icloud_overrides_heuristic(monkeypatch):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "icloud")
    monkeypatch.setenv("VAULT_HOST_PATH", "/some/random/path")
    assert get_files_provider().name == "icloud"


def test_unknown_explicit_falls_back_to_heuristic(monkeypatch, caplog):
    monkeypatch.setenv("GNOSI_FILES_PROVIDER", "dropbox")
    # Sense VAULT_HOST_PATH → heurística retorna `local`.
    p = get_files_provider()
    assert p.name == "local"
    # I queda registrat per ajudar al debug.
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
    """Si el cridador ja té un stat_result, evitem el doble stat."""
    p = OneDriveProvider()
    f = tmp_path / "ghost.jpg"
    f.write_bytes(b"placeholder")
    fake = SimpleNamespace(st_size=12345, st_blocks=0)
    assert p.is_online_only(f, stat_result=fake) is True


def test_onedrive_is_online_only_returns_false_on_stat_error(tmp_path):
    """Path inexistent → no hauríem de tornar True (no podem afirmar
    online-only sense stat fiable)."""
    p = OneDriveProvider()
    assert p.is_online_only(tmp_path / "nope.jpg") is False


def test_onedrive_default_warmup_url(monkeypatch):
    p = OneDriveProvider()
    assert p.warmup_url == "http://host.docker.internal:5009/warmup"
    assert p.warmup_timeout_s == 100.0


def test_onedrive_env_vars_override(monkeypatch):
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://custom:7000/warmup")
    monkeypatch.setenv("ONEDRIVE_WARMUP_TIMEOUT", "30")
    p = OneDriveProvider()
    assert p.warmup_url == "http://custom:7000/warmup"
    assert p.warmup_timeout_s == 30.0


# --- iCloudDriveProvider ------------------------------------------------

def test_icloud_inherits_from_onedrive():
    p = iCloudDriveProvider()
    assert isinstance(p, OneDriveProvider)
    assert p.name == "icloud"


def test_icloud_prefers_icloud_env_over_onedrive(monkeypatch):
    monkeypatch.setenv("ICLOUD_WARMUP_URL", "http://icloud:6000/warmup")
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://onedrive:5009/warmup")
    p = iCloudDriveProvider()
    assert p.warmup_url == "http://icloud:6000/warmup"


def test_icloud_falls_back_to_onedrive_env_when_no_icloud(monkeypatch):
    monkeypatch.setenv("ONEDRIVE_WARMUP_URL", "http://shared:5009/warmup")
    p = iCloudDriveProvider()
    assert p.warmup_url == "http://shared:5009/warmup"


def test_icloud_timeout_from_icloud_env(monkeypatch):
    monkeypatch.setenv("ICLOUD_WARMUP_TIMEOUT", "42")
    p = iCloudDriveProvider()
    assert p.warmup_timeout_s == 42.0


# --- Contract: tots compleixen FilesProvider ----------------------------

@pytest.mark.parametrize("cls", [LocalProvider, OneDriveProvider, iCloudDriveProvider])
def test_provider_class_satisfies_interface(cls):
    p = cls()
    assert isinstance(p, FilesProvider)
    assert hasattr(p, "name") and isinstance(p.name, str)
    assert callable(p.is_online_only)
    assert asyncio.iscoroutinefunction(p.materialize)
