"""Direct-call contracts for typed public API and sharing responses."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi.routing import APIRoute


def test_public_routes_keep_historical_mapping_shapes(monkeypatch) -> None:
    from backend.api import public_routes

    token = SimpleNamespace(user_id="user-1", scopes="read,write")
    assert public_routes.public_ping(token) == {
        "ok": True,
        "user_id": "user-1",
        "scopes": "read,write",
    }

    monkeypatch.setattr(
        public_routes,
        "_write_vault_page",
        lambda *_args: {"id": "page-1", "path": "Wiki/Page.md"},
    )
    created = public_routes.public_create_page(
        public_routes.PublicPageRequest(title="Page"),
        token,
    )
    assert created == {
        "status": "created",
        "id": "page-1",
        "path": "Wiki/Page.md",
    }


def test_clipper_config_keeps_optional_field_shape(monkeypatch) -> None:
    from backend.api import public_routes

    monkeypatch.setattr(
        public_routes,
        "_clipper_state",
        lambda: (True, {"fields": ["title"]}),
    )
    monkeypatch.setattr(
        public_routes,
        "_clipper_target",
        lambda _cfg: (
            {"id": "resources", "name": "Resources"},
            {"option_catalogs": {}},
        ),
    )
    monkeypatch.setattr(
        public_routes.web_clipper,
        "form_fields",
        lambda *_args: [{"id": "title", "name": "Title", "type": "text"}],
    )

    result = public_routes.public_clip_config(
        SimpleNamespace(user_id="user-1"),
        SimpleNamespace(workspace_id="workspace-1"),
    )

    assert result == {
        "enabled": True,
        "table": {"id": "resources", "name": "Resources"},
        "fields": [{"id": "title", "name": "Title", "type": "text"}],
    }


class _ShareQuery:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def filter(self, *_conditions: object) -> _ShareQuery:
        return self

    def all(self) -> list[SimpleNamespace]:
        return self.rows


class _ShareDatabase:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def query(self, *_entities: object) -> _ShareQuery:
        return _ShareQuery(self.rows)


def test_share_routes_keep_nested_mapping_shapes() -> None:
    from backend.api import share_routes

    created_at = datetime(2026, 8, 28, tzinfo=timezone.utc)
    link = SimpleNamespace(
        id="share-1",
        page_id="page-1",
        permission="view",
        created_by="user-1",
        created_at=created_at,
        expires_at=None,
        revoked=0,
    )

    serialized = share_routes._serialize(link)
    listed = asyncio.run(share_routes.list_share_links("page-1", db=_ShareDatabase([link])))

    assert serialized == {
        "token": "share-1",
        "page_id": "page-1",
        "permission": "view",
        "created_by": "user-1",
        "created_at": "2026-08-28T00:00:00+00:00",
        "expires_at": None,
        "revoked": False,
        "url": "/s/share-1",
    }
    assert listed == {"shares": [serialized]}


def test_share_routes_publish_typed_response_contracts() -> None:
    from backend.api import share_routes

    routes = {
        route.endpoint.__name__: route
        for route in share_routes.router.routes
        if isinstance(route, APIRoute)
    }
    assert routes["create_share_link"].response_model is share_routes.ShareLinkResponse
    assert routes["list_share_links"].response_model is share_routes.ShareListResponse
    assert routes["revoke_share_link"].response_model is share_routes.RevokedShareResponse
    assert routes["read_shared_page"].response_model is share_routes.SharedPageResponse
