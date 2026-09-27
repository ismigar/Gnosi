"""Regression coverage for folder-aware agent context, without provider traffic."""

from types import SimpleNamespace

import pytest

from backend.agent import internal_sources
from backend.domains.agent.sources import mail
from backend.domains.agent.sources.scopes import normalize_internal_scope


@pytest.fixture(autouse=True)
def allowed_accounts(monkeypatch):
    monkeypatch.setattr(
        internal_sources,
        "_allowed_accounts",
        lambda requested, **_: requested or ["a@test", "b@test"],
    )


def test_multiple_accounts_and_identical_uids_retain_folder_identity(monkeypatch):
    from backend.api import mail_routes

    calls = []

    async def messages(**kwargs):
        calls.append((kwargs["email"], kwargs["folder"]))
        return {
            "messages": [
                {
                    "id": "imap_7",
                    "date": f"2026-01-0{len(calls)}T00:00:00Z",
                    "subject": kwargs["folder"],
                }
            ]
        }

    monkeypatch.setattr(mail_routes, "get_messages", messages)
    scope = normalize_internal_scope(
        "mail",
        {
            "accounts": ["a@test", "b@test"],
            "folders_by_account": {"a@test": ["INBOX", "Sent::é"], "b@test": ["Archive"]},
            "limit": 2,
        },
    )
    result = mail._mail_search(scope, "budget")
    assert calls == [("a@test", "INBOX"), ("a@test", "Sent::é"), ("b@test", "Archive")]
    assert [row["folder"] for row in result["records"]] == ["Archive", "Sent::é"]
    assert len({row["id"] for row in result["records"]}) == 2
    reads = []
    monkeypatch.setattr(
        mail, "_read_mail_message", lambda *args: reads.append(args) or {"body_text": "evidence"}
    )
    for row in result["records"]:
        assert mail._mail_read(scope, row["id"])["body"] == "evidence"
    assert reads == [("b@test", "Archive", "imap_7"), ("a@test", "Sent::é", "imap_7")]


@pytest.mark.parametrize(
    "bad_account,bad_folder", [("outside@test", "INBOX"), ("a@test", "Private")]
)
def test_exact_read_rejects_out_of_scope_without_contacting_provider(
    monkeypatch, bad_account, bad_folder
):
    scope = normalize_internal_scope(
        "mail", {"accounts": ["a@test"], "folders_by_account": {"a@test": ["INBOX", "Archive"]}}
    )
    monkeypatch.setattr(
        mail, "_read_mail_message", lambda *_: pytest.fail("Provider should not be called")
    )
    with pytest.raises(PermissionError):
        mail._mail_read(scope, mail._record_id(bad_account, bad_folder, "imap_7"))


def test_old_scope_and_identifiers_work_only_with_one_folder(monkeypatch):
    scope = normalize_internal_scope("mail", {"accounts": ["a@test"], "folder": "Archive"})
    assert mail.mail_folders(scope, "a@test") == ["Archive"]
    monkeypatch.setattr(
        mail, "_read_mail_message", lambda account, folder, identifier: {"body_text": folder}
    )
    assert mail._mail_read(scope, "a@test::imap_7")["body"] == "Archive"
    scope["folders_by_account"] = {"a@test": ["INBOX", "Archive"]}
    with pytest.raises(ValueError, match="Search again"):
        mail._mail_read(scope, "a@test::imap_7")
    assert mail.mail_folders(scope, "b@test") == ["Archive"]


@pytest.mark.parametrize(
    "value", [{"a@test": []}, {"a@test": ["\r\n"]}, {"a@test": "INBOX"}, ["INBOX"]]
)
def test_invalid_folder_selections_do_not_widen_scope(value):
    with pytest.raises(ValueError):
        normalize_internal_scope("mail", {"folders_by_account": value})


def test_folder_names_keep_case_and_deduplicate_only_exact_matches():
    scope = normalize_internal_scope(
        "mail", {"folders_by_account": {" A@TEST ": ["News", "news", "News"]}}
    )
    assert scope["folders_by_account"] == {"a@test": ["News", "news"]}


@pytest.mark.parametrize("raise_error", [False, True])
def test_partial_search_returns_evidence_and_explicit_folder_failure(monkeypatch, raise_error):
    from backend.api import mail_routes

    async def messages(**kwargs):
        if kwargs["folder"] == "Broken":
            if raise_error:
                raise TimeoutError("provider unavailable")
            return {"messages": [], "error": "provider unavailable"}
        return {"messages": [{"id": "imap_8", "body_text": "evidence"}]}

    monkeypatch.setattr(mail_routes, "get_messages", messages)
    result = mail._mail_search(
        normalize_internal_scope(
            "mail", {"accounts": ["a@test"], "folders_by_account": {"a@test": ["INBOX", "Broken"]}}
        ),
        "",
    )
    assert len(result["records"]) == 1
    assert result["partial"] is True
    assert result["errors"][0]["folder"] == "Broken"


def test_imap_raw_names_and_aliases_resolve_without_default_fallback(monkeypatch):
    from backend.domains.mail.providers.hybrid import _imap_folder_name
    from backend.services import imap_mail_sync_service

    monkeypatch.setattr(
        imap_mail_sync_service,
        "_discover_folders",
        lambda _: [("Enviats", "Sent"), ("Projectes", "Received")],
    )
    assert _imap_folder_name(None, "Enviats") == "Enviats"
    assert _imap_folder_name(None, "SENT") == "Enviats"
    assert _imap_folder_name(None, "Projectes") == "Projectes"
    assert _imap_folder_name(None, "missing") is None


def test_microsoft_read_requires_current_folder_membership(monkeypatch):
    from backend.services import microsoft_mail_service as service

    calls = []
    monkeypatch.setattr(
        service, "_authed_get", lambda email, path, **_: calls.append(path) or {"id": "folder-A"}
    )
    monkeypatch.setattr(
        service,
        "microsoft_get_message",
        lambda *_: {"_folder_id": "folder-B", "body_text": "private"},
    )
    assert service.microsoft_get_message_in_folder("a@test", "id", "INBOX") is None
    monkeypatch.setattr(
        service,
        "microsoft_get_message",
        lambda *_: {"_folder_id": "folder-A", "body_text": "allowed"},
    )
    assert (
        service.microsoft_get_message_in_folder("a@test", "id", "INBOX")["body_text"] == "allowed"
    )
    assert calls == ["/me/mailFolders/inbox", "/me/mailFolders/inbox"]


def test_scoped_read_never_falls_back_to_saved_vault_messages(monkeypatch):
    from backend.services import integration_manager, hybrid_mail_service

    manager = SimpleNamespace(
        get_mail_account=lambda _: {},
        is_imap_account=lambda _: True,
        is_microsoft_account=lambda _: False,
    )
    monkeypatch.setattr(integration_manager, "integration_manager", manager)
    with pytest.raises(PermissionError):
        mail._read_mail_message("a@test", "INBOX", "imap_7")
    manager.get_mail_account = lambda _: {"email": "a@test"}
    monkeypatch.setattr(hybrid_mail_service, "imap_get_message", lambda *_: None)
    with pytest.raises(KeyError):
        mail._read_mail_message("a@test", "INBOX", "imap_7")
