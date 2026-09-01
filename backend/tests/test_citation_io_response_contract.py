"""Typed JSON contracts and binary preservation for citation I/O routes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, FastAPI
from fastapi.responses import Response
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.domains.vault.citations import io_api
from backend.domains.vault.schemas.pages import PageSaveRequest


def _dependencies(tmp_path: Path) -> io_api.ReferencesIoDependencies:
    async def create_page(
        _request: PageSaveRequest,
        _background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        return {"id": "page-1"}

    def parse_references(raw: str, _fmt: str) -> list[dict[str, Any]]:
        if raw.strip() == "empty":
            return []
        return [{"Citation Key": "smith2020", "Title": "Reference"}]

    return io_api.ReferencesIoDependencies(
        active_vault_path=lambda: tmp_path,
        load_registry=lambda: {"tables": [{"id": "resources"}]},
        item_type_catalog_names=lambda _table, _registry: [],
        resolve_existing_keys=lambda: lambda: set(),
        normalize_item_type=lambda value, _catalog: value,
        resolve_ensure_index=lambda: lambda _vault_key: {},
        find_page=lambda _page_id: None,
        parse_frontmatter=lambda _content, _path: ({}, ""),
        normalize_doi=lambda value: value,
        normalize_isbn=lambda value: value,
        normalize_title=lambda value: str(value).casefold(),
        detect_format=lambda _raw: "bibtex",
        parse_references=parse_references,
        serialize_references=lambda _metadata, _fmt: "@book{smith2020}\n",
        find_existing_match=lambda _entry, _indexes, _keys: None,
        add_to_indexes=lambda _entry, _key, _indexes: None,
        resolve_create_page=lambda: create_page,
        resolve_invalidate_index=lambda: lambda: None,
        page_snapshot=lambda: [],
        list_styles=lambda: [
            {
                "id": "apa",
                "file": "apa.csl",
                "title": None,
                "source": "bundled",
            }
        ],
        save_uploaded_style=lambda _raw, _filename: {
            "id": "custom",
            "file": "custom.csl",
            "title": "Custom",
            "checksum": "sha256:test",
        },
    )


def _router(tmp_path: Path) -> APIRouter:
    router = APIRouter()
    dependencies = _dependencies(tmp_path)
    io_api.register_import_route(
        router,
        editor_dependencies=[],
        dependencies=dependencies,
    )
    io_api.register_catalog_export_routes(
        router,
        upload_dependencies=[],
        export_dependencies=[],
        dependencies=dependencies,
    )
    return router


def _route(router: APIRouter, method: str, path: str) -> APIRoute:
    return next(
        route
        for route in router.routes
        if isinstance(route, APIRoute) and route.path == path and method in (route.methods or set())
    )


def test_citation_io_routes_expose_json_models_and_keep_binary_export(
    tmp_path: Path,
) -> None:
    router = _router(tmp_path)

    import_route = _route(router, "POST", "/import-references")
    assert import_route.response_model is io_api.ImportReferencesResponse
    assert import_route.response_model_exclude_unset is True
    assert _route(router, "GET", "/csl/styles").response_model is io_api.CslStylesResponse
    assert _route(router, "POST", "/csl/styles").response_model is io_api.CslStyleResponse

    export_route = _route(router, "GET", "/export-references")
    assert export_route.response_model is None
    assert export_route.response_class is Response


def test_citation_io_routes_preserve_json_extras_status_and_binary_body(
    tmp_path: Path,
) -> None:
    app = FastAPI()
    app.include_router(_router(tmp_path), prefix="/api/vault")
    client = TestClient(app)

    imported = client.post(
        "/api/vault/import-references?table_id=resources&fmt=auto",
        files={"file": ("references.bib", b"normal", "application/x-bibtex")},
    )
    assert imported.status_code == 200
    assert imported.json() == {
        "created": 1,
        "skipped": 0,
        "items": [
            {
                "id": "page-1",
                "citation_key": "smith2020",
                "title": "Reference",
            }
        ],
        "skipped_details": [],
        "skipped_keys": [],
        "skip_summary": {"citation_key": 0, "doi": 0, "isbn": 0, "title": 0},
        "errors": [],
        "format": "bibtex",
    }

    empty = client.post(
        "/api/vault/import-references?table_id=resources&fmt=auto",
        files={"file": ("empty.bib", b"empty", "application/x-bibtex")},
    )
    assert empty.status_code == 200
    assert empty.json() == {
        "created": 0,
        "skipped": 0,
        "items": [],
        "skipped_details": [],
        "skipped_keys": [],
        "skip_summary": {},
        "errors": [],
        "format": "bibtex",
        "message": "No references were found in the file",
    }

    styles = client.get("/api/vault/csl/styles")
    assert styles.status_code == 200
    assert styles.json() == {
        "styles": [
            {
                "id": "apa",
                "file": "apa.csl",
                "title": None,
                "source": "bundled",
            }
        ]
    }

    uploaded = client.post(
        "/api/vault/csl/styles",
        files={"file": ("custom.csl", b"<style/>", "application/xml")},
    )
    assert uploaded.status_code == 200
    assert uploaded.json() == {
        "id": "custom",
        "file": "custom.csl",
        "title": "Custom",
        "checksum": "sha256:test",
    }

    exported = client.get("/api/vault/export-references?table_id=resources&fmt=bibtex")
    assert exported.status_code == 200
    assert exported.content == b"@book{smith2020}\n"
    assert exported.headers["content-type"] == "application/x-bibtex"
    assert exported.headers["content-disposition"] == ('attachment; filename="recursos.bib"')
