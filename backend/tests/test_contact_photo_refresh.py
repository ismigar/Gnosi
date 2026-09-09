"""Photo sync must invalidate cached address-book responses."""

import asyncio
from pathlib import Path
from unittest.mock import Mock

import pytest

from backend.api import contacts_routes
from backend.domains.contacts.schemas import ContactSyncRequest
from backend.services.workspace_service import WorkspaceContext
from backend.utils.cache import SimpleCache


def test_contact_sync_invalidates_cached_photos(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = Mock()
    engine.sync_full_bidirectional.return_value = {}
    monkeypatch.setattr(contacts_routes, "ContactsSyncEngine", Mock(return_value=engine))
    cache = SimpleCache(default_ttl=60, max_size=2)
    cache.set("personal:None:None:None", [{"photo_url": "old-photo"}])
    monkeypatch.setattr(contacts_routes, "_contacts_cache", cache)

    result = asyncio.run(contacts_routes.sync_contacts(
        payload=ContactSyncRequest(provider="google", email="user@example.test"),
        x_user_email="",
        context=WorkspaceContext("personal", "user", "editor", Path("/synthetic-vault")),
        db=Mock(),
    ))

    assert result["status"] == "ok"
    assert cache.get("personal:None:None:None") is None
