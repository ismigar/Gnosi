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


def test_missing_vault_directory_is_still_prepared(stored_vault):
    vault, _ = stored_vault
    assert routing._read_vault_identity(vault.id) == (vault.id, vault.path_override)
    assert Path(vault.path_override).is_dir()


def test_failed_directory_preparation_is_not_an_available_vault(stored_vault, monkeypatch):
    vault, _ = stored_vault
    mkdir = Path.mkdir

    def unavailable(path, *args, **kwargs):
        if str(path) == vault.path_override:
            raise PermissionError("Synthetic unavailable vault")
        return mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", unavailable)
    assert routing._read_vault_identity(vault.id) is None
