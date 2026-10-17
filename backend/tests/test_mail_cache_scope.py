"""Mail snapshots and inline attachments retain their full request scope."""
import asyncio

import pytest

from backend.domains.mail import cache
from backend.domains.mail.routes import messages
from backend.services import hybrid_mail_service
from backend.services.context_vars import active_vault_path
from backend.services.integration_manager import integration_manager
from backend.utils.cache import SimpleCache


@pytest.mark.parametrize("changed", ["folder-case", "vault", "account"])
def test_inline_content_is_not_reused_for_a_distinct_mailbox_scope(monkeypatch, tmp_path, changed):
    monkeypatch.setattr(cache, "_INLINE_PARTS_CACHE", SimpleCache(default_ttl=120, max_size=16))
    token = active_vault_path.set(tmp_path / "one")
    try:
        parts = {"shared-cid": {"data": b"first scoped attachment", "content_type": "image/png"}}
        cache._set_cached_inline_parts("fixture@example.test", "imap_42", "Archive/Work", parts)
        assert cache._get_cached_inline_parts("FIXTURE@example.test", "imap_42", "Archive/Work") is parts
        email = "other@example.test" if changed == "account" else "fixture@example.test"
        folder = "Archive/work" if changed == "folder-case" else "Archive/Work"
        if changed == "vault":
            active_vault_path.set(tmp_path / "two")
        assert cache._get_cached_inline_parts(email, "imap_42", folder) is None
    finally:
        active_vault_path.reset(token)


def _prepare_lists(monkeypatch):
    monkeypatch.setattr(messages, "_MAIL_CACHE", SimpleCache(default_ttl=120, max_size=128))
    monkeypatch.setattr(integration_manager, "get_mail_account", lambda *_a, **_k: {"type": "manual"})
    calls = []
    def listed(_email, *, limit, **_kwargs):
        calls.append((active_vault_path.get(), limit))
        return {"messages": [{"id": f"{active_vault_path.get()}-{i}"} for i in range(limit)], "total": 100}
    monkeypatch.setattr(hybrid_mail_service, "imap_list_messages", listed)
    return calls


def test_remote_list_snapshot_does_not_cross_active_vaults(monkeypatch, tmp_path):
    calls = _prepare_lists(monkeypatch)
    async def scenario():
        token = active_vault_path.set(tmp_path / "one")
        try:
            first = await messages.get_messages("fixture@example.test", "all", None, 1, 0, None, None, False)
            active_vault_path.set(tmp_path / "two")
            second = await messages.get_messages("fixture@example.test", "all", None, 1, 0, None, None, False)
            assert first["messages"] != second["messages"]
            assert len(calls) == 2
        finally:
            active_vault_path.reset(token)
    asyncio.run(scenario())


def test_remote_list_snapshot_honors_the_requested_page_size(monkeypatch):
    calls = _prepare_lists(monkeypatch)
    async def scenario():
        assert len((await messages.get_messages("fixture@example.test", "all", None, 1, 0, None, None, False))["messages"]) == 1
        assert len((await messages.get_messages("fixture@example.test", "all", None, 2, 0, None, None, False))["messages"]) == 2
        assert len(calls) == 2
    asyncio.run(scenario())


def test_folder_counts_snapshot_does_not_cross_active_vaults(monkeypatch, tmp_path):
    monkeypatch.setattr(messages, "_COUNTS_CACHE", cache._MailCountsCache())
    monkeypatch.setattr(messages, "_COUNTS_INFLIGHT", {})
    calls = []
    async def counted(_email):
        calls.append(active_vault_path.get())
        return {"all": {"total": len(calls), "unread": 0}}
    monkeypatch.setattr(messages, "_load_mail_counts", counted)
    async def scenario():
        token = active_vault_path.set(tmp_path / "one")
        try:
            first = await messages.get_mail_counts("fixture@example.test")
            active_vault_path.set(tmp_path / "two")
            second = await messages.get_mail_counts("fixture@example.test")
            assert first != second
            assert calls == [tmp_path / "one", tmp_path / "two"]
        finally:
            active_vault_path.reset(token)
    asyncio.run(scenario())
