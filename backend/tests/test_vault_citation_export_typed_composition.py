"""Offline citation composition contracts; only the child imports the backend."""

from __future__ import annotations

import ast
import importlib
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from backend.domains.vault.citations.export_contracts import Metadata
    from backend.services.workspace_service import WorkspaceContext

ROOT = Path(__file__).resolve().parents[2]
MODULE = "backend.domains.vault.citations.export_routes"
ROUTE_NAMES = (
    "format_citation",
    "format_citations",
    "format_bibliography",
    "export_page",
    "get_reference_table",
    "set_reference_table",
    "create_reference_table",
    "clear_reference_table",
)


@pytest.mark.parametrize("suite", ["composition", "existing-regressions"])
def test_citation_export_composition_in_isolated_subprocess(suite: str) -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-citation-composition-") as temporary:
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
            "GNOSI_JWT_SECRET": "synthetic-citation-fixture-not-an-account-key",
        }
        selected = (
            [
                "-o",
                "python_functions=check_*",
                "backend/tests/test_vault_citation_export_typed_composition.py",
            ]
            if suite == "composition"
            else [
                "backend/tests/test_pandoc_bin.py",
                "backend/tests/test_references_io.py",
                "backend/tests/test_vault_export_domain_contract.py",
                "backend/tests/test_vault_comments_links_citations_contract.py",
                "backend/tests/test_ssrf_guard.py",
                "backend/tests/test_citation_io_response_contract.py",
                "backend/tests/test_reference_table_race.py",
                "backend/tests/test_option_catalogs.py",
                "backend/tests/test_item_type_normalization.py",
                "backend/tests/test_typed_citation_pdf_routes.py",
            ]
        )
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
                *selected,
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            # This budget includes a cold backend import and the entire suite,
            # not one request. Keep runtime/export timeouts unchanged.
            timeout=300,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


@pytest.fixture(scope="session")
def isolated_backend() -> None:
    assert "backend.api.vault_routes" not in sys.modules
    assert MODULE not in sys.modules
    root = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    assert root.is_absolute() and root.is_dir()
    for selector, suffix in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        assert Path(os.environ[selector]) == root / suffix
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"
    assert os.environ["GNOSI_DISABLE_SCHEDULER"] == "1"
    assert not {"OPENAI_API_KEY", "GNOSI_SHARED_ENV_FILE", "GNOSI_API_TOKEN"} & os.environ.keys()
    importlib.import_module("backend.api.vault_routes")
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()


@dataclass
class CitationFixture:
    root: Path
    client: TestClient
    metadata: Metadata
    calls: list[tuple[list[str], Path]]
    context: WorkspaceContext


@pytest.fixture
def citation(
    isolated_backend: None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[CitationFixture]:
    import urllib.request

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api import vault_routes as vr
    from backend.domains.vault.citations import export_routes as routes
    from backend.domains.vault.citations import formatting
    from backend.services import context_vars, reference_table_config
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context

    assert tmp_path.is_relative_to(Path(os.environ["GNOSI_VALIDATION_ROOT"]))
    root = tmp_path / "vault"
    root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    (root / "Document amb espais.md").write_text(
        "---\ntitle: Document\n---\nText [@merce2026; @missing]. @merce2026\n"
        "{{bibliography:apa:ca}}\n",
        encoding="utf-8",
    )
    metadata: Metadata = {
        "Citation Key": "merce2026",
        "Title": "Lectura",
        "Item Type": "book",
        "Authors": "Rodoreda, Mercè",
        "Any": 2026,
        "DOI": "10.1234/EXAMPLE",
    }
    (root / "reference.md").write_text("---\nCitation Key: merce2026\n---\n", encoding="utf-8")
    token = context_vars.active_vault_path.set(root)
    monkeypatch.setattr(
        vr,
        "_ensure_cite_key_index",
        lambda _path: {
            "merce2026": {"id": "reference", "title": "Lectura"},
        },
    )
    monkeypatch.setattr(
        vr,
        "_page_index_entries",
        {
            str(root): {
                "reference.md": {"id": "reference", "title": "Lectura", "metadata": metadata},
            }
        },
    )
    monkeypatch.setattr(
        vr,
        "find_page_path",
        lambda ident: {
            "document": root / "Document amb espais.md",
            "reference": root / "reference.md",
        }.get(ident),
    )
    monkeypatch.setattr(vr, "parse_frontmatter", lambda _text, _path: (metadata, "body"))
    monkeypatch.setattr(routes, "_pandoc_bin", lambda: "synthetic-pandoc")
    monkeypatch.setattr(routes, "_resolve_csl_path", lambda _style: root / "fixture.csl")
    monkeypatch.setattr(formatting, "pandoc_binary", lambda: "synthetic-pandoc")
    monkeypatch.setattr(formatting, "resolve_csl_path", lambda _style: root / "fixture.csl")
    monkeypatch.setattr(reference_table_config, "CONFIG_PATH", root / "reference-config.json")

    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("External process/network forbidden in citation fixture")

    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(urllib.request, "urlopen", forbidden)
    calls: list[tuple[list[str], Path]] = []

    def process(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        path = kwargs["cwd"]
        assert isinstance(path, Path)
        assert kwargs == {"cwd": path, "capture_output": True, "text": True, "timeout": 60}
        calls.append((command, path))
        assert path.name.startswith("gnosi_export_")
        assert "Bibliografia" in (path / "input.md").read_text()
        assert not (path / "input.md").read_text().startswith("---")
        items = json.loads((path / "refs.json").read_text())
        assert len(items) == 1 and items[0]["id"] == "merce2026"
        output = command[command.index("-o") + 1]
        (path / output).write_bytes(b"synthetic-document")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", process)
    app = FastAPI()
    app.include_router(vr.router, prefix="/api/vault", tags=["Vault"])
    context = WorkspaceContext("fixture", "fixture-user", "owner", root)
    app.dependency_overrides[get_workspace_context] = lambda: context
    try:
        with TestClient(app) as client:
            yield CitationFixture(root, client, metadata, calls, context)
    finally:
        context_vars.active_vault_path.reset(token)


@pytest.mark.parametrize("format", ["docx", "odt", "html", "pdf", "tex", "markdown"])
def check_export_formats(citation: CitationFixture, format: str) -> None:
    from backend.domains.vault.citations.exporting import EXTENSIONS, MEDIA_TYPES

    response = citation.client.get(f"/api/vault/export/document?format={format}&locale=ca")
    assert response.status_code == 200, response.text
    assert response.content == b"synthetic-document"
    assert response.headers["content-type"].startswith(MEDIA_TYPES[format])
    assert response.headers["content-disposition"] == (
        f'attachment; filename="Document_amb_espais.{EXTENSIONS[format]}"'
    )
    command, temporary = citation.calls[0]
    assert command[0] == "synthetic-pandoc"
    assert "--citeproc" in command and "--bibliography" in command
    assert "--csl" in command and "lang=ca" in command
    assert ("--standalone" in command) is (format in {"docx", "odt", "pdf"})
    assert not temporary.exists()


@pytest.mark.parametrize(
    "failure,status,detail",
    [
        ("missing-page", 404, "Page not found"),
        ("missing-pandoc", 500, "fixture missing pandoc"),
        ("timeout", 504, "pandoc timeout after 60s"),
        ("stderr", 500, "pandoc failed: " + "E" * 500),
        ("no-output", 500, "pandoc no ha generat sortida"),
    ],
)
def check_export_failures(
    citation: CitationFixture,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
    status: int,
    detail: str,
) -> None:
    from backend.domains.vault.citations import export_routes as routes

    monkeypatch.setattr(routes, "_PANDOC_MISSING_MSG", "fixture missing pandoc")

    def process(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        if failure == "missing-pandoc":
            raise FileNotFoundError("synthetic")
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, 60)
        return subprocess.CompletedProcess(command, 1 if failure == "stderr" else 0, "", "E" * 700)

    monkeypatch.setattr(subprocess, "run", process)
    page = "missing" if failure == "missing-page" else "document"
    response = citation.client.get(f"/api/vault/export/{page}?format=html")
    assert response.status_code == status
    assert response.json() == {"detail": detail}


def check_invalid_format(citation: CitationFixture) -> None:
    response = citation.client.get("/api/vault/export/document?format=invalid")
    assert response.status_code == 422
    assert citation.calls == []


def check_facade_routes_and_openapi(citation: CitationFixture) -> None:
    from fastapi.routing import APIRoute

    from backend.api import vault_routes as vr
    from backend.domains.vault.citations import export_routes as routes
    from backend.domains.vault.citations import formatting
    from backend.domains.vault.citations import references_api
    from backend.domains.vault.citations.request_contracts import CitationFormattingRequest

    assert routes.router is vr.router
    owned = [
        route
        for route in vr.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in ROUTE_NAMES
    ]
    assert tuple(route.endpoint.__name__ for route in owned) == ROUTE_NAMES
    for route in owned:
        assert getattr(vr, route.endpoint.__name__) is route.endpoint
        if "reference_table" in route.endpoint.__name__:
            assert route.response_model is references_api.ReferenceTableResponse
    assert owned[0].response_model is formatting.FormattedCitationResponse
    assert owned[1].response_model is formatting.FormattedCitationsResponse
    assert owned[2].response_model is formatting.FormattedBibliographyResponse
    assert owned[1].dependant.body_params[0].field_info.annotation is CitationFormattingRequest
    assert owned[2].dependant.body_params[0].field_info.annotation is CitationFormattingRequest
    baseline = json.loads((ROOT / "openapi/openapi.json").read_text())
    actual = citation.client.get("/openapi.json").json()
    for path in ("/api/vault/format-citations", "/api/vault/format-bibliography"):
        request_schema = actual["paths"][path]["post"]["requestBody"]["content"][
            "application/json"
        ]["schema"]
        assert request_schema == {
            "$ref": "#/components/schemas/CitationFormattingRequest"
        }
    pending: set[str] = set()
    io_routes = [
        route
        for route in vr.router.routes
        if isinstance(route, APIRoute)
        and route.path in {"/import-references", "/csl/styles", "/export-references"}
    ]
    unchanged_routes = [*owned[3:], *io_routes]
    for route in unchanged_routes:
        path = "/api/vault" + route.path
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
    assert {"ReferenceTableResponse", "HTTPValidationError", "ValidationError"} <= visited


def _schema_refs(value: object) -> set[str]:
    if isinstance(value, dict):
        result: set[str] = set()
        reference = value.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
            result.add(reference.rsplit("/", 1)[1])
        for nested in value.values():
            result.update(_schema_refs(nested))
        return result
    if isinstance(value, list):
        return set().union(*(_schema_refs(nested) for nested in value))
    return set()


def check_index_identity_and_callback_binding(
    citation: CitationFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as vr
    from backend.domains.vault.citations import export_routes as routes
    from backend.domains.vault.citations.export_composition import vault

    original_path = routes._CITATION_FORMATTING_DEPENDENCIES.active_vault_path
    original_parser = routes._CITATION_FORMATTING_DEPENDENCIES.parse_frontmatter
    assert original_path() == citation.root
    monkeypatch.setattr(vr, "get_active_vault_path", lambda: "changed")
    assert routes._CITATION_EXPORT_DEPENDENCIES.active_vault_path() == "changed"
    assert routes._CITATION_FORMATTING_DEPENDENCIES.active_vault_path is original_path
    assert routes._REFERENCES_IO_DEPENDENCIES.parse_frontmatter is original_parser
    index = {"next": {"id": "next"}}
    monkeypatch.setattr(vr, "_ensure_cite_key_index", lambda _root: index)
    assert routes._CITATION_EXPORT_DEPENDENCIES.ensure_citation_index("changed") is index
    assert (
        routes._CITATION_FORMATTING_DEPENDENCIES.resolve_ensure_index() is vr._ensure_cite_key_index
    )
    assert vault._page_index_entries is vr._page_index_entries
    assert vault._page_index_lock is vr._page_index_lock
    entries = routes._citation_page_entries(str(citation.root))
    assert entries[0] is vr._page_index_entries[str(citation.root)]["reference.md"]
    assert routes._citation_page_entry_count(str(citation.root)) == 1
    assert (
        routes._citation_page_metadata_snapshot(str(citation.root))["reference"]
        is citation.metadata
    )


def check_unknown_metadata_identity(citation: CitationFixture) -> None:
    from backend.domains.vault.citations import export_routes as routes

    extra = {"date": date(2026, 8, 31), "values": (None, b"bytes", {"custom"})}
    citation.metadata["Unrecognized extension"] = extra
    snapshot = routes._citation_page_metadata_snapshot(str(citation.root))
    assert snapshot["reference"] is citation.metadata
    assert snapshot["reference"]["Unrecognized extension"] is extra
    items = routes._build_csl_items_for_keys(["merce2026", "missing", "merce2026"])
    assert [item["id"] for item in items] == ["merce2026", "merce2026"]
    assert citation.metadata["Unrecognized extension"] is extra
    assert citation.metadata["Authors"] == "Rodoreda, Mercè"


@pytest.mark.parametrize("fmt", ["bibtex", "ris"])
def check_reference_roundtrip_and_dedup(citation: CitationFixture, fmt: str) -> None:
    from backend.domains.vault.citations import export_routes as routes
    from backend.domains.vault.citations.export_contracts import DedupIndexes

    raw = routes._references_serialize([citation.metadata], fmt)
    assert routes._references_detect_format(raw) == fmt
    entries = routes._references_parse(raw, fmt)
    assert len(entries) == 1 and entries[0]["DOI"] == "10.1234/EXAMPLE"
    indexes: DedupIndexes = {"doi": {}, "isbn": {}, "title": {}}
    routes._references_add_indexes(entries[0], "original", indexes)
    routes._references_add_indexes(entries[0], "duplicate", indexes)
    assert indexes["doi"] == {"10.1234/example": "original"}
    assert routes._references_find_existing(entries[0], indexes, set()) == ("doi", "original")
    entries[0]["Citation Key"] = "occupied"
    assert routes._references_find_existing(entries[0], indexes, {"occupied"}) == (
        "citation_key",
        "occupied",
    )


def check_reference_designation_flow(
    citation: CitationFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import nullcontext

    from backend.api import vault_routes as vr
    from backend.domains.vault.citations.export_contracts import ReferenceRegistry, ReferenceTable

    table: ReferenceTable = {"id": "references", "name": "Biblioteca", "properties": []}
    registry: ReferenceRegistry = {"tables": [table]}
    saved: list[ReferenceRegistry] = []
    invalidations: list[bool] = []
    monkeypatch.setattr(vr, "_table_by_id", lambda ident: table if ident == "references" else None)
    monkeypatch.setattr(vr, "_reference_table_by_id_primary", vr._table_by_id)
    monkeypatch.setattr(vr, "load_registry", lambda: registry)
    monkeypatch.setattr(vr, "save_registry", saved.append)
    monkeypatch.setattr(vr, "registry_mutation", nullcontext)
    monkeypatch.setattr(vr, "_invalidate_cite_key_index", lambda: invalidations.append(True))
    before = citation.client.get("/api/vault/reference-table")
    assert before.json() == {"table_id": None, "configured": False, "name": None}
    response = citation.client.post("/api/vault/reference-table", json={"table_id": "references"})
    assert response.status_code == 200, response.text
    assert response.json()["columns_added"] == len(vr._REFERENCE_SCHEMA)
    assert saved == [registry] and saved[0] is registry
    assert citation.client.get("/api/vault/reference-table").json() == {
        "table_id": "references",
        "configured": True,
        "name": "Biblioteca",
    }
    again = citation.client.post("/api/vault/reference-table", json={"table_id": "references"})
    assert again.json()["columns_added"] == 0 and len(saved) == 1
    assert citation.client.delete("/api/vault/reference-table").json() == {
        "table_id": None,
        "configured": False,
    }
    assert len(invalidations) == 3
    assert len(table["properties"]) == len(vr._REFERENCE_SCHEMA)


@pytest.mark.parametrize(
    "payload,status,detail",
    [
        ({}, 400, "table_id is required"),
        ({"table_id": "unknown"}, 404, "Table unknown not found"),
    ],
)
def check_reference_errors(
    citation: CitationFixture,
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, str],
    status: int,
    detail: str,
) -> None:
    from backend.api import vault_routes as vr

    monkeypatch.setattr(vr, "_table_by_id", lambda _ident: None)
    response = citation.client.post("/api/vault/reference-table", json=payload)
    assert response.status_code == status
    assert response.json() == {"detail": detail}


def check_no_any_or_result_casts(citation: CitationFixture) -> None:
    for filename in ("export_routes.py", "export_contracts.py", "export_composition.py"):
        tree = ast.parse((ROOT / "backend/domains/vault/citations" / filename).read_text())
        assert not any(
            isinstance(node, ast.Name) and node.id in {"Any", "_LegacyAny"}
            for node in ast.walk(tree)
        )
        casts = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "cast"
        ]
        assert len(casts) == (1 if filename == "export_composition.py" else 0)


@pytest.mark.parametrize("kind", ["single", "batch", "bibliography"])
def check_formatting_http(
    citation: CitationFixture,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    from backend.domains.vault.citations import formatting

    def render(command: list[str], directory: Path, timeout: int) -> str:
        assert command[0] == "synthetic-pandoc"
        assert timeout == (20 if kind == "single" else 30)
        items = json.loads((directory / "refs.json").read_text())
        assert len(items) == 1 and items[0]["id"] == "merce2026"
        if kind == "single":
            return "Rodoreda (2026)\n\nBibliografia"
        if kind == "batch":
            assert (directory / "input.md").read_text().count("[@merce2026]") == 2
            return (
                "GCREF1BEG Primera GCREF1FIN\n\nGCREF2BEG Segona GCREF2FIN\n\n"
                "GCREF3BEG (@missing) GCREF3FIN"
            )
        return '<div id="refs"><div class="csl-entry">Rodoreda &amp; obra</div></div>'

    monkeypatch.setattr(formatting, "_run_pandoc", render)
    if kind == "single":
        response = citation.client.get("/api/vault/format-citation?key=merce2026")
        assert response.json() == {
            "key": "merce2026",
            "formatted": "Rodoreda (2026)",
            "resolved": True,
        }
    elif kind == "batch":
        response = citation.client.post(
            "/api/vault/format-citations",
            json={
                "keys": ["@merce2026", "merce2026", "missing"],
                "style": "apa",
                "locale": "ca",
            },
        )
        assert response.json() == {
            "items": [
                {"key": "merce2026", "ordinal": 1, "formatted": "Primera", "resolved": True},
                {"key": "merce2026", "ordinal": 2, "formatted": "Segona", "resolved": True},
                {"key": "missing", "ordinal": 3, "formatted": "(@missing)", "resolved": False},
            ],
            "style": "apa",
            "locale": "ca",
        }
    else:
        response = citation.client.post(
            "/api/vault/format-bibliography",
            json={
                "keys": ["merce2026", "missing"],
                "style": "apa",
                "locale": "ca",
            },
        )
        result = response.json()
        assert result["entries"] == ["Rodoreda & obra"]
        assert result["resolved"] == 1 and result["missing"] == ["missing"]
    assert response.status_code == 200


def check_formatting_request_compatibility(citation: CitationFixture) -> None:
    for path in ("/format-citations", "/format-bibliography"):
        malformed = citation.client.post(
            f"/api/vault{path}",
            json={"keys": "not-a-list", "future_extension": {"enabled": True}},
        )
        assert malformed.status_code == 400
        assert malformed.json() == {"detail": "keys must be a list"}

    empty_batch = citation.client.post(
        "/api/vault/format-citations",
        json={"keys": None, "style": 0, "locale": False, "future_extension": [1]},
    )
    assert empty_batch.status_code == 200
    assert empty_batch.json() == {"items": [], "style": "apa", "locale": "en-US"}

    empty_bibliography = citation.client.post(
        "/api/vault/format-bibliography",
        json={"future_extension": [1]},
    )
    assert empty_bibliography.status_code == 200
    assert empty_bibliography.json() == {
        "entries": [],
        "style": "apa",
        "locale": "en-US",
        "resolved": 0,
        "missing": [],
    }


def check_import_reference_flow(
    citation: CitationFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi import BackgroundTasks

    from backend.api import vault_routes as vr
    from backend.domains.vault.schemas.pages import PageSaveRequest

    created: list[PageSaveRequest] = []
    invalidations: list[bool] = []

    async def create(request: PageSaveRequest, _tasks: BackgroundTasks) -> Metadata:
        created.append(request)
        return {"id": "created"}

    monkeypatch.setattr(vr, "create_page", create)
    monkeypatch.setattr(vr, "_invalidate_cite_key_index", lambda: invalidations.append(True))
    monkeypatch.setattr(vr, "load_registry", lambda: {"tables": [{"id": "references"}]})
    raw = (
        "@book{new2026,title={Nou},author={Rodoreda, Mercè},year={2026},doi={10.1234/NEW}}\n"
        "@book{duplicate,title={Nou duplicat},doi={10.1234/new}}\n"
    )
    response = citation.client.post(
        "/api/vault/import-references?table_id=references&fmt=auto",
        files={"file": ("fixture.bib", raw.encode(), "text/plain")},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["created"] == 1 and result["skipped"] == 1 and result["errors"] == []
    assert result["skip_summary"]["doi"] == 1
    assert result["skipped_details"][0]["existing_key"] == "new2026"
    assert len(created) == 1 and created[0].metadata["Citation Key"] == "new2026"
    assert invalidations == [True]


def check_style_result_identity(citation: CitationFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.vault.citations import export_routes as routes
    from backend.services import csl_styles

    style: csl_styles.CslStyle = {"id": "synthetic", "title": None, "file": "synthetic.csl"}
    styles = [style]
    monkeypatch.setattr(csl_styles, "list_styles", lambda: styles)
    monkeypatch.setattr(csl_styles, "save_uploaded_style", lambda _raw, _name: style)
    assert routes._references_list_styles() is styles
    assert routes._references_save_style(b"not executed", "fixture.csl") is style


@pytest.mark.parametrize("role", ["owner", "admin", "editor", "viewer"])
@pytest.mark.parametrize("override", [False, True])
def check_import_context_authorship_and_role_denial(
    citation: CitationFixture,
    monkeypatch: pytest.MonkeyPatch,
    role: str,
    override: bool,
) -> None:
    from fastapi import BackgroundTasks

    from backend.api import vault_routes as vr
    from backend.domains.vault.api import core_routes, pages_commands
    from backend.domains.vault.pages import create_service
    from backend.domains.vault.schemas.pages import PageSaveRequest

    citation.context.role = role
    citation.context.user_id = "authenticated-import-author"
    observed: list[str | None] = []
    written: list[Metadata] = []

    def save(path: Path, metadata: Metadata, body: str) -> None:
        assert path.is_relative_to(citation.root)
        written.append(metadata)
        path.write_text("---\n" + json.dumps(metadata) + "\n---\n" + body, encoding="utf-8")

    fixture_dependencies = create_service.CreatePageDependencies(
        new_id=lambda: "fixture-created",
        normalize_metadata=lambda metadata: metadata,
        prepare_table_metadata=lambda metadata: (metadata, None),
        process_updates=lambda _ident, _old, metadata: metadata,
        stamp_author=core_routes._stamp_author,
        persist_assets=lambda metadata: metadata,
        ensure_citation_key=lambda metadata, _table: metadata,
        dedupe_citation_key=lambda metadata, _ident: metadata,
        fill_authorship=lambda metadata, _table: metadata,
        path_for=lambda _key: citation.root,
        is_calendar_entry=lambda _metadata: False,
        table_folder=lambda _metadata: citation.root,
        canonicalize_id=lambda value: str(value),
        parse_frontmatter=lambda _text, _path: ({}, ""),
        unique_file_path=lambda directory, _title, suffix: directory / f"created{suffix}",
        save_page=save,
        get_table_id=lambda _metadata: None,
        recompute_formulas=lambda _table, _ident: None,
        index_created_page=lambda _ident, _path: None,
        invalidate_page_responses=lambda: None,
        add_page_index=lambda _path: None,
        update_link_index=lambda _path: None,
        queue_planning=lambda _tasks: None,
        propagate_relations=lambda _ident, _table, _old, _new: None,
        resolve_page_context=lambda _metadata, _path: ("Fixture", "references"),
        emit_created=lambda _ident, _title: None,
    )

    async def create(
        request: PageSaveRequest,
        tasks: BackgroundTasks,
        user_id: str | None,
        dependencies: create_service.CreatePageDependencies,
    ) -> Metadata:
        assert dependencies is core_routes._CREATE_PAGE_DEPENDENCIES
        observed.append(user_id)
        return await create_service.create_page(request, tasks, user_id, fixture_dependencies)

    async def legacy_override(request: PageSaveRequest, tasks: BackgroundTasks) -> Metadata:
        observed.append("two-argument-override")
        return {"id": "overridden", "metadata": request.metadata}

    monkeypatch.setattr(pages_commands, "create_page_service", create)
    monkeypatch.setattr(
        core_routes, "_resolve_user_label", lambda identifier: f"label-{identifier}"
    )
    monkeypatch.setattr(vr, "create_page", legacy_override if override else core_routes.create_page)
    monkeypatch.setattr(vr, "load_registry", lambda: {"tables": [{"id": "references"}]})
    monkeypatch.setattr(vr, "_invalidate_cite_key_index", lambda: None)
    raw = b"@book{new2026,title={Nou},author={Rodoreda, Merce},year={2026}}"
    response = citation.client.post(
        "/api/vault/import-references?table_id=references&fmt=bibtex",
        headers={"X-User-ID": "untrusted-header-user"},
        files={"file": ("fixture.bib", raw, "text/plain")},
    )
    if role == "viewer":
        assert response.status_code == 403
        assert response.json()["detail"] == (
            "Insufficient permission. Role editor is required (you have viewer)"
        )
        assert not observed and not written
        assert not (citation.root / "created.md").exists()
        return
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1 and response.json()["errors"] == []
    if override:
        assert observed == ["two-argument-override"] and not written
    else:
        assert observed == ["authenticated-import-author"]
        assert written[0]["created_by"] == "label-authenticated-import-author"
        assert written[0]["last_edited_by"] == "label-authenticated-import-author"
        assert "untrusted-header-user" not in (citation.root / "created.md").read_text()
        persisted = json.loads((citation.root / "created.md").read_text().split("\n")[1])
        assert persisted == written[0]


def check_catalog_keeps_raw_mapping_identity(citation: CitationFixture) -> None:
    from backend.domains.vault.citations.export_contracts import ReferenceProperty
    from backend.domains.vault.tables.catalogs import core

    extension = {"date": date(2026, 8, 31), "binary": b"opaque", "nested": [None, True]}
    config: Metadata = {"options": ["Llibre"], "extension": extension}
    prop: ReferenceProperty = {"name": "Item Type", "config": config}
    assert core.get_prop_config(prop) is config
    assert core.get_prop_config(prop)["extension"] is extension
    assert core.get_prop_options(prop)[0]["name"] == "Llibre"
    assert prop["config"] is config and config["extension"] is extension
