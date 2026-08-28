from pathlib import Path

import pytest

from backend.domains.mail.repositories import vault


def test_mail_vault_path_prefers_primary_vault(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vault, "get_primary_vault_path", lambda: Path("/primary"))
    monkeypatch.setattr(vault, "get_active_vault_path", lambda: Path("/active"))

    assert vault.get_mail_vault_path() == Path("/primary/Mail")


def test_mail_vault_path_falls_back_to_active_vault(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vault, "get_primary_vault_path", lambda: None)
    monkeypatch.setattr(vault, "get_active_vault_path", lambda: Path("/active"))

    assert vault.get_mail_vault_path() == Path("/active/Mail")


def test_mail_vault_path_requires_a_configured_vault(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vault, "get_primary_vault_path", lambda: None)
    monkeypatch.setattr(vault, "get_active_vault_path", lambda: None)

    with pytest.raises(RuntimeError, match="No active vault"):
        vault.get_mail_vault_path()
