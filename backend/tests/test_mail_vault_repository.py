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


@pytest.mark.parametrize("blind_recipients", ["blind@example.test", ["one@example.test", "two@example.test"], ""])
def test_local_draft_listing_preserves_blind_recipients_and_account_scope(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, blind_recipients: str | list[str],
) -> None:
    import yaml

    monkeypatch.setattr(vault, "get_mail_vault_path", lambda: tmp_path)
    for account in ("author@example.test", "other@example.test"):
        metadata = {
            "type": "Draft", "id": account, "account": account,
            "title": "Saved draft", "recipients": "reader@example.test",
            "cc": "copy@example.test", "bcc": blind_recipients,
        }
        (tmp_path / f"draft_{account}.md").write_text(
            f"---\n{yaml.safe_dump(metadata)}---\n\nPreserved body", encoding="utf-8",
        )

    drafts = vault._load_vault_drafts("author@example.test")

    assert len(drafts) == 1
    assert drafts[0]["account"] == "author@example.test"
    assert drafts[0]["recipient"] == "reader@example.test"
    assert drafts[0]["cc"] == "copy@example.test"
    assert drafts[0]["bcc"] == blind_recipients
    assert drafts[0]["body_text"].strip() == "Preserved body"
