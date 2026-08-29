"""Typed response contract for Command Palette Markdown imports."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.routing import APIRoute


def _route() -> APIRoute:
    from backend.domains.vault.pages import sync_routes

    return next(
        route
        for route in sync_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == "import_markdown"
    )


def test_markdown_import_route_exposes_typed_response_model() -> None:
    from backend.domains.vault.pages import sync_routes

    route = _route()

    assert route.path == "/import"
    assert route.methods == {"POST"}
    assert route.response_model is sync_routes.ImportResponse


def test_markdown_import_preserves_result_and_written_page(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from backend.domains.vault.pages import sync_routes
    from backend.services import context_vars

    indexed: list[Path] = []
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(sync_routes._legacy, "register_page_in_index", indexed.append)

    result = asyncio.run(
        sync_routes.import_markdown(
            sync_routes.ImportRequest(
                files=[
                    sync_routes.ImportFile(
                        name="Research.md",
                        content="# Evidence\n\nOne fact",
                    )
                ],
                folder="Imported notes",
            )
        )
    )

    assert result == {"imported": 1, "errors": [], "folder": "Imported notes"}
    assert len(indexed) == 1
    written = tmp_path / "Imported notes" / "Research.md"
    assert written.is_file()
    assert "# Evidence" in written.read_text(encoding="utf-8")
