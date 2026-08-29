"""HTTP contract for host-local Vault open actions."""

from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.registry.contracts import (
    LocalPathOpenRequest,
    LocalPathOpenResponse,
    ResourceOpenResponse,
)


def _route(handler_name: str) -> APIRoute:
    return next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == handler_name
    )


def test_local_open_routes_publish_typed_responses() -> None:
    assert _route("open_local_path").response_model is LocalPathOpenResponse
    assert _route("open_resource").response_model is ResourceOpenResponse


def test_local_path_request_preserves_path_and_url_aliases() -> None:
    assert LocalPathOpenRequest(path="~/Document.pdf").path == "~/Document.pdf"
    assert LocalPathOpenRequest(url="file:///tmp/Document.pdf").url == (
        "file:///tmp/Document.pdf"
    )
