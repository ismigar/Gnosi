"""Typed response contracts for the Vault media browser."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _routes() -> dict[str, APIRoute]:
    from backend.domains.vault.media import routes

    names = {
        "create_media_view",
        "delete_media_view",
        "get_all_media",
        "get_media_roots",
        "get_media_tree",
        "list_media_views",
        "update_media_metadata",
        "update_media_view",
        "upload_media",
    }
    return {
        route.endpoint.__name__: route
        for route in routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in names
    }


def test_media_browser_routes_publish_typed_models() -> None:
    from backend.domains.vault.media import routes, schemas

    registered = _routes()

    assert registered["get_media_roots"].response_model == list[schemas.MediaRootResponse]
    assert registered["get_all_media"].response_model is schemas.MediaPageResponse
    assert registered["get_media_tree"].response_model == list[schemas.MediaTreeNodeResponse]
    assert registered["upload_media"].response_model is schemas.MediaItemResponse
    assert registered["update_media_metadata"].response_model is schemas.MediaMutationResponse
    assert registered["list_media_views"].response_model == list[schemas.MediaViewResponse]
    assert registered["create_media_view"].response_model is schemas.MediaViewResponse
    assert registered["update_media_view"].response_model is schemas.MediaViewResponse
    assert registered["delete_media_view"].response_model is schemas.MediaMutationResponse
    assert registered["get_media_roots"].methods == {"GET"}
    assert registered["get_all_media"].methods == {"GET"}
    assert registered["get_media_tree"].methods == {"GET"}


def test_media_browser_models_preserve_service_shapes() -> None:
    from backend.domains.vault.media import schemas

    root = {
        "key": "library",
        "label": "Library",
        "url_prefix": "/api/vault/library/",
        "available": True,
    }
    tree = {"name": "Papers", "path": "Papers", "has_children": True}
    item = {
        "id": "media-1",
        "filename": "paper.pdf",
        "url": "/api/vault/library/Papers/paper.pdf",
        "path": "Library/Papers/paper.pdf",
        "path_in_root": "Papers/paper.pdf",
        "album": "Papers",
        "root": "library",
        "kind": "pdf",
        "size": 1024,
        "last_modified": "2026-08-29T06:00:00+00:00",
        "extension": "pdf",
        "date_taken": None,
        "location": None,
        "tags": ["research"],
        "description": "A paper",
    }
    page = {"items": [item], "total": 1, "limit": 200, "offset": 0, "root": "library"}

    assert schemas.MediaRootResponse.model_validate(root).model_dump() == root
    assert schemas.MediaTreeNodeResponse.model_validate(tree).model_dump() == tree
    assert schemas.MediaPageResponse.model_validate(page).model_dump() == page


def test_media_view_models_preserve_saved_sidecar_shapes() -> None:
    from backend.domains.vault.media import schemas

    view = {
        "id": "view_1",
        "label": "Research PDFs",
        "scope": {"root": "library", "album": "Papers"},
        "filters": {
            "kinds": ["pdf"],
            "q": "research",
            "tagsAny": ["review"],
            "datePreset": "all",
            "mtimeFrom": "",
            "mtimeTo": "",
            "sizePreset": "all",
        },
        "sort": {"field": "mtime", "dir": "desc"},
        "created_at": "2026-08-29T06:00:00Z",
        "updated_at": "2026-08-29T06:05:00Z",
    }

    assert schemas.MediaViewResponse.model_validate(view).model_dump() == view
    assert schemas.MediaMutationResponse.model_validate({"status": "ok"}).model_dump() == {
        "status": "ok"
    }
