"""Existing File Provider vaults can resolve without requesting a mutation."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.data import management_db
from backend.services import active_vault_middleware as routing


@pytest.fixture
def stored_vault(monkeypatch, tmp_path):
    vault = SimpleNamespace(id="fixture-vault", path_override=str(tmp_path / "vault"))
    session = Mock()
    session.query.return_value.filter.return_value.first.return_value = vault
    monkeypatch.setattr(management_db, "_get_or_init_mgmt_engine", lambda: (None, lambda: session))
    return vault, session


def test_existing_vault_resolves_when_its_provider_rejects_directory_mutations(stored_vault, monkeypatch):
    vault, session = stored_vault
    directory = Path(vault.path_override)
    directory.mkdir()
    mkdir = Path.mkdir

    def reject_existing_mutation(path, *args, **kwargs):
        if path == directory:
            raise PermissionError("Synthetic provider does not accept directory mutations")
        return mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", reject_existing_mutation)
    assert routing._read_vault_identity(vault.id) == (vault.id, vault.path_override)
    session.close.assert_called_once()


def test_missing_vault_directory_is_unavailable_and_never_prepared(stored_vault, monkeypatch):
    vault, _ = stored_vault

    def unexpected_write(*args, **kwargs):
        raise AssertionError("A saved identity lookup must not create directories")

    monkeypatch.setattr(Path, "mkdir", unexpected_write)
    assert routing._read_vault_identity(vault.id) is None
    assert not Path(vault.path_override).exists()


def test_failed_directory_probe_is_not_an_available_vault(stored_vault, monkeypatch):
    vault, _ = stored_vault
    is_dir = Path.is_dir

    def unavailable(path):
        if str(path) == vault.path_override:
            raise PermissionError("Synthetic unavailable vault")
        return is_dir(path)

    monkeypatch.setattr(Path, "is_dir", unavailable)
    assert routing._read_vault_identity(vault.id) is None
