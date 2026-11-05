"""HTTP contract for host-local Vault open actions."""

import asyncio
from pathlib import Path
from urllib.parse import quote
from unittest.mock import AsyncMock

from fastapi.routing import APIRoute
import pytest

from backend.api import vault_routes
from backend.domains.vault.registry import runtime
from backend.domains.vault.registry.contracts import (
    LocalPathOpenRequest,
    LocalPathOpenResponse,
    ResourceOpenResponse,
)
from backend.services.context_vars import active_vault_path


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


@pytest.mark.parametrize("encoded", [False, True])
def test_external_open_resolves_the_original_library_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, encoded: bool,
) -> None:
    library = tmp_path / "Library"
    document = library / "Research" / "Anàlisi de la religio\u0301.pdf"
    document.parent.mkdir(parents=True)
    document.write_bytes(b"synthetic document")
    relative = document.relative_to(library).as_posix()
    source = f"/api/vault/library/{quote(relative) if encoded else relative}"
    opened: list[str] = []
    materialize = AsyncMock()
    monkeypatch.setattr(vault_routes, "_library_roots", lambda _vault: [library])
    monkeypatch.setattr(vault_routes, "_materialize_if_online_only", materialize)
    monkeypatch.setattr(runtime, "_safe_open_target", opened.append)
    token = active_vault_path.set(tmp_path)
    try:
        result = asyncio.run(runtime.open_local_path(LocalPathOpenRequest(path=source)))
    finally:
        active_vault_path.reset(token)
    assert result == {"status": "ok", "target": str(document), "kind": "file"}
    assert opened == [str(document)]
    materialize.assert_awaited_once_with(document, "open-local-path")
