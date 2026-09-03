"""Lookup composition checks; backend imports occur only in an isolated child."""

from __future__ import annotations

import asyncio
import ast
import importlib
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from backend.domains.vault.citations.pdf_fallback import PdfFallbackDependencies

ROOT = Path(__file__).resolve().parents[2]
LOOKUP_PATHS = (
    "/lookup-metadata",
    "/generate-citation-key",
    "/recognize-pdf",
    "/translate-url",
    "/import-references",
    "/promote-zotero-extra",
    "/bulk-update-metadata",
    "/bulk-apply-template",
    "/csl/styles",
    "/export-references",
    "/search-citations",
    "/resolve-by-citation-key",
)


@pytest.mark.parametrize("first_module", ["facade", "lookup"])
def test_citation_lookup_composition_in_isolated_subprocess(first_module: str) -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-lookup-composition-") as temporary:
        root = Path(temporary).resolve()
        for name in ("data", "vault", "host"):
            (root / name).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_REQUIRE_AUTH": "1",
            "GNOSI_JWT_SECRET": "synthetic-lookup-fixture-not-an-account-key",
            "GNOSI_LOOKUP_IMPORT_FIRST": first_module,
        }
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "--tb=short",
                "-p",
                "no:cacheprovider",
                "--basetemp",
                str(root / "tests"),
                "-o",
                "python_functions=check_*",
                "backend/tests/test_vault_citation_lookup_typed_composition.py",
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


@pytest.fixture(scope="session")
def isolated_backend() -> Iterator[None]:
    import socket
    import urllib.request

    import requests

    root = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    assert root.is_absolute() and root.is_dir()
    assert "backend.api.vault_routes" not in sys.modules
    for variable, name in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        assert Path(os.environ[variable]) == root / name
    assert os.environ["GNOSI_DISABLE_SCHEDULER"] == "1"
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"
    assert not {"OPENAI_API_KEY", "GNOSI_SHARED_ENV_FILE", "GNOSI_API_TOKEN"} & os.environ.keys()

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("External I/O is forbidden in isolated lookup checks")

    with pytest.MonkeyPatch.context() as guard:
        guard.setattr(requests.sessions.Session, "request", forbidden)
        guard.setattr(urllib.request, "urlopen", forbidden)
        guard.setattr(socket, "create_connection", forbidden)
        guard.setattr(socket.socket, "connect", forbidden)
        guard.setattr(subprocess, "Popen", forbidden)
        first_module = (
            "backend.domains.vault.citations.lookup_routes"
            if os.environ["GNOSI_LOOKUP_IMPORT_FIRST"] == "lookup"
            else "backend.api.vault_routes"
        )
        importlib.import_module(first_module)
        from backend.config.validation_runtime import validation_runtime_enabled

        assert validation_runtime_enabled()
        yield


def check_checked_facade_aliases_match_runtime_owners(isolated_backend: None) -> None:
    """Every type-only claim must match the real export, in both import orders."""
    from backend.api import vault_routes as facade

    source = ast.parse((ROOT / "backend/api/vault_routes.py").read_text())
    block = next(
        statement
        for statement in source.body
        if isinstance(statement, ast.If)
        and isinstance(statement.test, ast.Name)
        and statement.test.id == "TYPE_CHECKING"
    )
    symbols: dict[str, object] = {}
    declared: set[str] = set()

    def resolve_alias(value: ast.expr) -> object:
        if isinstance(value, ast.Name):
            return symbols[value.id]
        assert isinstance(value, ast.Attribute)
        return getattr(resolve_alias(value.value), value.attr)

    for statement in block.body:
        if isinstance(statement, ast.ImportFrom):
            assert statement.module is not None
            owner = importlib.import_module(statement.module)
            for alias in statement.names:
                name = alias.asname or alias.name
                value = getattr(owner, alias.name)
                symbols[name] = value
                if not name.startswith("_typed_"):
                    assert getattr(facade, name) is value, name
                    declared.add(name)
        elif isinstance(statement, (ast.Assign, ast.AnnAssign)):
            if isinstance(statement, ast.Assign):
                assert len(statement.targets) == 1
                target = statement.targets[0]
            else:
                target = statement.target
            value = statement.value
            assert isinstance(target, ast.Name)
            assert value is not None
            expected = resolve_alias(value)
            assert getattr(facade, target.id) is expected, target.id
            symbols[target.id] = expected
            declared.add(target.id)
    lookup = ast.parse((ROOT / "backend/domains/vault/citations/lookup_routes.py").read_text())
    used = {
        node.attr
        for node in ast.walk(lookup)
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "_vault"
    }
    # file_etag is an explicit real import; every dynamic dependency is checked.
    from backend.utils.safe_io import file_etag

    assert facade.file_etag is file_etag
    assert used <= declared | {"file_etag"}


def check_lookup_keeps_late_provider_mapping_and_unknown_values(
    isolated_backend: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.citations import lookup_routes as routes

    extension = {"opaque": [False, 0, None, {"label": "Mercè"}]}
    metadata: dict[str, object] = {"Title": "Synthetic bibliography", "extension": extension}
    calls: list[str] = []

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("Only the selected provider may be invoked")

    def normalize(value: dict[str, object]) -> dict[str, object]:
        assert value is metadata and value["extension"] is extension
        calls.append("normalize")
        value["Item Type"] = "document"
        return value

    def inject(value: dict[str, object]) -> dict[str, object]:
        assert value is metadata
        calls.append("key")
        value["Citation Key"] = "synthetic2026"
        monkeypatch.setattr(facade, "_normalize_suggested_item_type", normalize)
        return value

    def map_work(work: dict[str, object]) -> dict[str, object]:
        assert work == {"title": "provider"}
        calls.append("map")
        monkeypatch.setattr(facade, "_inject_citation_key", inject)
        return metadata

    def fetch(url: str) -> str:
        assert url == "https://api.crossref.org/works/10.1234/synthetic"
        calls.append("fetch")
        monkeypatch.setattr(facade, "_crossref_to_recursos", map_work)
        return json.dumps({"message": {"title": "provider"}})

    for name in (
        "_crossref_to_recursos",
        "_inject_citation_key",
        "_normalize_suggested_item_type",
        "_http_get_public",
    ):
        monkeypatch.setattr(facade, name, forbidden)
    monkeypatch.setattr(facade, "_http_get", fetch)
    result = asyncio.run(routes.lookup_metadata({"doi": "10.1234/synthetic"}))
    assert result == {
        "source": "crossref",
        "identifier": "10.1234/synthetic",
        "suggested": metadata,
        "error": None,
    }
    assert result["suggested"] is metadata
    assert metadata["extension"] is extension
    assert calls == ["fetch", "map", "key", "normalize"]


def check_authorship_preserves_property_and_extension_identity(
    isolated_backend: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.citations import lookup_routes as routes

    property_definition = MappingProxyType({"type": "autoria", "name": "Autoría"})
    table: dict[str, object] = {"properties": (property_definition,)}
    assert routes._reference_autoria_prop(table) is property_definition
    monkeypatch.setattr(facade, "get_reference_table_id", lambda: "refs")
    monkeypatch.setattr(facade, "get_table_id", lambda metadata: "refs")
    extension: list[object] = [False, None, {"nested": [0, ""]}]
    metadata: dict[str, object] = {"Authors": "Rodoreda, Mercè", "extension": extension}
    assert routes._fill_autoria_from_authors(metadata, table) is metadata
    assert metadata == {
        "Autoría": [{"nom": "Mercè", "cognom1": "Rodoreda", "cognom2": ""}],
        "extension": extension,
    }
    assert metadata["extension"] is extension
    authors = metadata["Autoría"]
    metadata["Authors"] = "Roig, Montserrat"
    assert routes._fill_autoria_from_authors(metadata, table) is metadata
    assert metadata["Autoría"] is authors
    assert metadata["Authors"] == "Roig, Montserrat"


def _pdf_dependencies(
    authors: Sequence[Mapping[str, object]],
    calls: list[str],
    mapped: list[dict[str, object]],
) -> PdfFallbackDependencies:
    from backend.domains.vault.citations.pdf_fallback import PdfFallbackDependencies

    def parse_authors(value: str) -> Sequence[Mapping[str, object]]:
        calls.append(value)
        return authors

    def map_item(item: dict[str, object]) -> dict[str, object]:
        mapped.append(item)
        return item

    return PdfFallbackDependencies(
        embedded_metadata=lambda data: {
            "title": "Lectura",
            "author": "Rodoreda and Roig",
            "year": "2026",
        },
        title_from_filename=lambda filename: filename,
        parse_authors=parse_authors,
        map_zotero_item=map_item,
        inject_citation_key=lambda metadata: metadata,
    )


@pytest.mark.parametrize("readonly", [False, True])
def check_pdf_author_callback_keeps_identity_and_accepts_readonly_records(
    isolated_backend: None,
    readonly: bool,
) -> None:
    from backend.domains.vault.citations.pdf_fallback import pdf_fallback_metadata

    first = {"family": "Rodoreda", "given": "Mercè"}
    second = {"family": "Roig", "given": "Montserrat"}
    mutable_authors: list[dict[str, str]] = [first, second]
    authors: Sequence[Mapping[str, object]] = (
        (MappingProxyType(first), MappingProxyType(second)) if readonly else mutable_authors
    )
    calls: list[str] = []
    mapped: list[dict[str, object]] = []
    dependencies = _pdf_dependencies(authors, calls, mapped)
    assert dependencies.parse_authors("identity") is authors
    calls.clear()
    result = pdf_fallback_metadata(
        b"synthetic-pdf",
        "fixture.pdf",
        {"doi": "10.1234/fixture"},
        dependencies,
    )
    assert calls == ["Rodoreda; Roig"]
    assert result is mapped[0]
    assert result == {
        "itemType": "document",
        "title": "Lectura",
        "date": "2026",
        "DOI": "10.1234/fixture",
        "creators": [
            {"creatorType": "author", "lastName": "Rodoreda", "firstName": "Mercè"},
            {"creatorType": "author", "lastName": "Roig", "firstName": "Montserrat"},
        ],
    }
    assert first == {"family": "Rodoreda", "given": "Mercè"}
    assert second == {"family": "Roig", "given": "Montserrat"}
    assert mutable_authors[0] is first and mutable_authors[1] is second


def check_pdf_uses_actual_typed_author_callback(isolated_backend: None) -> None:
    from backend.domains.vault.citations.export_routes import _parse_authors_to_csl
    from backend.domains.vault.citations.pdf_fallback import (
        PdfFallbackDependencies,
        pdf_fallback_metadata,
    )

    dependencies = PdfFallbackDependencies(
        embedded_metadata=lambda data: {"title": "Lectura", "author": "Rodoreda, Mercè"},
        title_from_filename=lambda filename: filename,
        parse_authors=_parse_authors_to_csl,
        map_zotero_item=lambda item: item,
        inject_citation_key=lambda metadata: metadata,
    )
    assert dependencies.parse_authors is _parse_authors_to_csl
    result = pdf_fallback_metadata(b"synthetic", "fixture.pdf", None, dependencies)
    assert result["creators"] == [
        {"creatorType": "author", "lastName": "Rodoreda", "firstName": "Mercè"},
    ]


def check_pdf_route_preserves_late_callback_and_metadata_identity(
    isolated_backend: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as vr
    from backend.domains.vault.citations import lookup_routes as routes

    authors = [{"family": "Rodoreda", "given": "Mercè"}]
    calls: list[str] = []
    mapped: list[dict[str, object]] = []

    def parse(value: str) -> list[dict[str, str]]:
        calls.append(value)
        return authors

    def map_item(item: dict[str, object]) -> dict[str, object]:
        mapped.append(item)
        return item

    monkeypatch.setattr(vr, "_parse_authors_to_csl", parse)
    monkeypatch.setattr(vr, "_inject_citation_key", lambda metadata: metadata)
    monkeypatch.setattr(routes, "_zotero_item_to_recursos", map_item)
    monkeypatch.setattr(
        routes,
        "_pdf_embedded_metadata",
        lambda data: {"title": "Lectura", "author": "Rodoreda, Mercè"},
    )
    result = routes._pdf_fallback_to_recursos(b"synthetic", "fixture.pdf")
    assert result is mapped[0]
    assert calls == ["Rodoreda, Mercè"]
    assert result["creators"] == [
        {"creatorType": "author", "lastName": "Rodoreda", "firstName": "Mercè"},
    ]
    monkeypatch.setattr(vr, "_parse_authors_to_csl", lambda value: [])
    next_result = routes._pdf_fallback_to_recursos(b"synthetic", "fixture.pdf")
    assert next_result is mapped[1] and "creators" not in next_result
    assert calls == ["Rodoreda, Mercè"]
    assert authors == [{"family": "Rodoreda", "given": "Mercè"}]


def _schema_refs(value: object) -> set[str]:
    if isinstance(value, dict):
        refs: set[str] = set()
        for key, child in value.items():
            if key == "$ref" and isinstance(child, str):
                refs.add(child.rsplit("/", 1)[-1])
            else:
                refs.update(_schema_refs(child))
        return refs
    if isinstance(value, list):
        return {name for child in value for name in _schema_refs(child)}
    return set()


def check_lookup_openapi_and_models_unchanged(isolated_backend: None) -> None:
    from fastapi import FastAPI
    from fastapi.routing import APIRoute

    from backend.api import vault_routes as vr
    from backend.domains.vault.citations import keys_api
    from backend.domains.vault.citations import lookup_routes as routes

    app = FastAPI()
    app.include_router(vr.router, prefix="/api/vault", tags=["Vault"])
    actual = app.openapi()
    baseline = json.loads((ROOT / "openapi/openapi.json").read_text())
    models = {
        "/lookup-metadata": routes.MetadataLookupResponse,
        "/translate-url": routes.UrlTranslationResponse,
        "/recognize-pdf": routes.PdfRecognitionResponse,
        "/promote-zotero-extra": routes.ZoteroExtraPromotionResponse,
        "/bulk-update-metadata": routes.BulkPageMutationResponse,
        "/generate-citation-key": keys_api.CitationKeyResponse,
    }
    assert routes.router is vr.router
    owned = [
        route
        for route in vr.router.routes
        if isinstance(route, APIRoute) and route.path in LOOKUP_PATHS
    ]
    assert tuple(route.path for route in owned) == (
        *LOOKUP_PATHS[:8],
        "/csl/styles",
        "/csl/styles",
        *LOOKUP_PATHS[9:],
    )
    pending: set[str] = set()
    for route in owned:
        assert getattr(vr, route.endpoint.__name__) is route.endpoint
        if route.path in models:
            assert route.response_model is models[route.path]
            assert route.response_model.__module__ in {
                routes.__name__,
                keys_api.__name__,
                "backend.domains.vault.schemas.pages",
            }
        path = "/api/vault" + route.path
        if route.path not in {"/bulk-update-metadata", "/generate-citation-key"}:
            assert actual["paths"][path] == baseline["paths"][path]
            pending.update(_schema_refs(actual["paths"][path]))
    visited: set[str] = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        schema = actual["components"]["schemas"][name]
        assert schema == baseline["components"]["schemas"][name]
        pending.update(_schema_refs(schema))


@pytest.mark.parametrize("table_id", [None, "", "missing-table"])
def check_template_without_table_keeps_exact_400(
    isolated_backend: None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    table_id: str | None,
) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api import vault_routes as vr
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context

    template = tmp_path / "template.md"
    template.write_text("synthetic template", encoding="utf-8")
    metadata: dict[str, object] = {"id": "template", "is_template": True}
    if table_id is not None:
        metadata["table_id"] = table_id
    calls: list[tuple[str, object]] = []

    def find_page(page_id: str) -> Path:
        calls.append(("find", page_id))
        return template

    def parse(content: str, path: Path) -> tuple[dict[str, object], str]:
        calls.append(("parse", path))
        assert content == "synthetic template"
        return metadata, "body"

    def find_table(identifier: str) -> None:
        calls.append(("table", identifier))
        return None

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("A missing template table must not start any mutation")

    monkeypatch.setattr(vr, "find_page_path", find_page)
    monkeypatch.setattr(vr, "parse_frontmatter", parse)
    monkeypatch.setattr(vr, "_table_by_id", find_table)
    monkeypatch.setattr(vr, "save_page_md", forbidden)
    monkeypatch.setattr(vr, "_get_page_write_lock", forbidden)
    monkeypatch.setattr(vr, "_refresh_page_index_entry", forbidden)
    monkeypatch.setattr(vr, "_pages_cache_invalidate_all", forbidden)
    app = FastAPI()
    app.include_router(vr.router, prefix="/api/vault", tags=["Vault"])
    context = WorkspaceContext("fixture", "fixture-user", "owner", tmp_path)
    app.dependency_overrides[get_workspace_context] = lambda: context
    with TestClient(app) as client:
        response = client.post(
            "/api/vault/bulk-apply-template",
            json={"template_id": "template", "page_ids": ["target"]},
        )
    assert response.status_code == 400
    assert response.json() == {"detail": "Template does not belong to a table"}
    expected: list[tuple[str, object]] = [("find", "template"), ("parse", template)]
    if table_id:
        expected.append(("table", table_id))
    assert calls == expected
    assert template.read_text() == "synthetic template"


def check_template_table_callback_is_nullable_and_late_bound(
    isolated_backend: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as vr
    from backend.domains.vault.api.configuration_routes import get_table_id
    from backend.domains.vault.citations import lookup_routes as routes
    from backend.domains.vault.pages.metadata_mutations import MetadataMutationDependencies

    dependencies: MetadataMutationDependencies = routes._metadata_mutation_dependencies()
    calls: list[dict[str, object]] = []
    metadata: dict[str, object] = {"is_template": True}

    def nullable(value: dict[str, object]) -> str | None:
        calls.append(value)
        return get_table_id(value)

    monkeypatch.setattr(vr, "get_table_id", nullable)
    assert dependencies.table_id(metadata) is None
    assert calls == [metadata] and calls[0] is metadata
    monkeypatch.setattr(vr, "get_table_id", lambda value: "replacement")
    assert dependencies.table_id(metadata) == "replacement"
    assert len(calls) == 1


def check_valid_template_flow_and_target_without_table(
    isolated_backend: None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import asynccontextmanager

    from backend.api import vault_routes as vr
    from backend.domains.vault.citations import lookup_routes as routes

    for name in ("template", "target", "unassigned"):
        (tmp_path / f"{name}.md").write_text(name, encoding="utf-8")
    records: dict[str, tuple[dict[str, object], str]] = {
        "template": ({"is_template": True, "table_id": "references", "Status": "new"}, "body"),
        "target": ({"table_id": "references", "Status": "old"}, "old body"),
        "unassigned": ({"Status": "old"}, "old body"),
    }
    calls: list[str] = []
    written: list[tuple[Path, dict[str, object], str]] = []

    @asynccontextmanager
    async def lock(page_id: str) -> AsyncIterator[None]:
        calls.append(f"lock:{page_id}")
        yield
        calls.append(f"unlock:{page_id}")

    async def get_lock(page_id: str) -> AbstractAsyncContextManager[None]:
        return lock(page_id)

    def find_table(table_id: str) -> dict[str, object]:
        calls.append(f"table:{table_id}")
        return {"id": table_id, "properties": [{"name": "Status"}]}

    def save(path: Path, metadata: dict[str, object], body: str) -> None:
        written.append((path, metadata, body))

    monkeypatch.setattr(vr, "find_page_path", lambda page_id: tmp_path / f"{page_id}.md")
    monkeypatch.setattr(vr, "parse_frontmatter", lambda raw, path: records[path.stem])
    monkeypatch.setattr(vr, "_table_by_id", find_table)
    monkeypatch.setattr(vr, "_get_page_write_lock", get_lock)
    monkeypatch.setattr(vr, "save_page_md", save)
    monkeypatch.setattr(vr, "file_etag", lambda path: "new-etag")
    monkeypatch.setattr(vr, "_refresh_page_index_entry", lambda path, md, body: None)
    monkeypatch.setattr(routes, "_invalidate_cite_key_index", lambda: calls.append("citations"))
    monkeypatch.setattr(vr, "_pages_cache_invalidate_all", lambda: calls.append("pages"))
    # The historical Python entry point also accepts a plain dictionary.
    from backend.domains.vault.pages import metadata_mutations

    result = asyncio.run(
        metadata_mutations.bulk_apply_template(
            {"template_id": "template", "page_ids": ["target", "unassigned", "target"]},
            routes._metadata_mutation_dependencies(),
        )
    )
    assert result == {
        "updated": 1,
        "updated_ids": ["target"],
        "updated_with_etags": [{"page_id": "target", "etag": "new-etag"}],
        "skipped": [],
        "conflicts": [],
        "errors": [{"page_id": "unassigned", "error": "different_table"}],
    }
    assert written == [
        (tmp_path / "target.md", {"table_id": "references", "Status": "new"}, "body")
    ]
    assert calls == [
        "table:references",
        "lock:target",
        "unlock:target",
        "lock:unassigned",
        "unlock:unassigned",
        "citations",
        "pages",
    ]
