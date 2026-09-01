"""PDF annotation compatibility with real SQLite and in-process HTTP.

Only the subprocess wrapper is collected by default. Backend imports occur in
the clean child after validation paths, credentials and providers are isolated.
No application lifespan, live server, migration or real vault is started.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.routing import APIRoute
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from backend.services.workspace_service import WorkspaceContext


PDF_MODULE = "backend.domains.vault.annotations.pdf_routes"
SOURCE_URI = "file:///synthetic/paper.pdf"
# Complete PDF-only OpenAPI, including inherited auth headers/cookie, captured
# before the composition refactor at the supplied 2fc2a799f checkpoint.
PDF_OPENAPI_SHA256 = "24e86a8339efa3167777a5fd81fb047c5057bcc4d05716c22dfe77942c18434f"
RESPONSE_KEYS = {
    "id", "source_uri", "page", "type", "color", "rects", "text", "comment",
    "tags", "created_at", "updated_at",
}


@pytest.mark.parametrize("import_order", ["facade-first", "domain-first"])
def test_pdf_annotation_typed_composition_in_isolated_subprocess(import_order: str) -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-pdf-composition-") as temporary:
        root = Path(temporary).resolve()
        for child in ("data", "vault", "host"):
            (root / child).mkdir()
        config = root / "vault" / ".gnosi"
        config.mkdir()
        (config / "params.yaml").write_text(
            json.dumps({"ai": {"providers": {}}}), encoding="utf-8",
        )
        (config / "plugins.json").write_text(json.dumps({
            "schema_version": 2, "enabled_builtin": [], "enabled_third_party": [],
            "disabled": ["ai-platform", "mail", "llm-wiki"],
        }), encoding="utf-8")
        # Allowlist instead of copying os.environ: no inherited API keys,
        # dotenv selectors, vault paths, proxies, auth tokens or live E2E flags.
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
            "GNOSI_REQUIRE_AUTH": "true",
            "GNOSI_MODE": "organization",
            "GNOSI_JWT_SECRET": "synthetic-pdf-fixture-secret-not-a-real-key",
            "GNOSI_PDF_TEST_IMPORT_ORDER": import_order,
        }
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "--tb=short", "-p", "no:cacheprovider",
             "--basetemp", str(root / "tests"), "-o", "python_functions=check_*",
             "backend/tests/test_pdf_annotation_typed_composition.py"],
            cwd=Path(__file__).resolve().parents[2], env=environment,
            capture_output=True, text=True, timeout=90, check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(f"{import_order}: {result.stdout}")


@pytest.fixture(scope="session")
def isolated_backend() -> None:
    assert "backend.api.vault_routes" not in sys.modules
    assert PDF_MODULE not in sys.modules
    root = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    assert root.is_absolute() and root.is_dir()
    for name, child in (
        ("GNOSI_DATA_DIR", "data"), ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"), ("HOME_HOST_PATH", "host"),
    ):
        assert Path(os.environ[name]) == root / child
    assert os.environ["GNOSI_DISABLE_SCHEDULER"] == "1"
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"
    assert not {"GNOSI_API_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"} & os.environ.keys()
    first = (PDF_MODULE if os.environ["GNOSI_PDF_TEST_IMPORT_ORDER"] == "domain-first"
             else "backend.api.vault_routes")
    importlib.import_module(first)

    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()


def _pdf_routes() -> list[APIRoute]:
    from fastapi.routing import APIRoute

    from backend.api import vault_routes

    return [
        route for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__module__ == PDF_MODULE
    ]


@dataclass
class AnnotationFixture:
    app: FastAPI
    client: TestClient
    db: Session
    context: WorkspaceContext


@pytest.fixture
def annotation_fixture(isolated_backend: None, tmp_path: Path) -> Iterator[AnnotationFixture]:
    from fastapi import APIRouter, FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import Table, create_engine
    from sqlalchemy.orm import Session

    from backend.data.db import get_db
    from backend.models.pdf_annotation import PdfAnnotation
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context

    engine = create_engine(
        f"sqlite:///{tmp_path / 'annotations.sqlite3'}",
        connect_args={"check_same_thread": False},
    )
    table = PdfAnnotation.__table__
    assert isinstance(table, Table)
    table.create(engine)
    context = WorkspaceContext("synthetic-workspace", "synthetic-user", "editor", tmp_path)
    app = FastAPI()
    # Do not append routes straight to the app: their original dependency
    # provider would ignore fixture overrides and return 401. include_router
    # binds the existing handlers/dependencies to this isolated application.
    pdf_router = APIRouter()
    pdf_router.routes.extend(_pdf_routes())
    app.include_router(pdf_router)

    def database() -> Iterator[Session]:
        with Session(engine) as request_db:
            yield request_db

    def workspace() -> WorkspaceContext:
        return context

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_workspace_context] = workspace
    try:
        with Session(engine) as db, TestClient(app) as client:
            yield AnnotationFixture(app, client, db, context)
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def check_route_model_and_facade_identity(isolated_backend: None) -> None:
    from backend.api import vault_routes
    from backend.data.db import get_db
    from backend.domains.vault.annotations import pdf_routes
    from backend.models.pdf_annotation import PdfAnnotation
    from backend.services.workspace_service import get_workspace_context, require_role

    assert pdf_routes.router is vault_routes.router
    assert getattr(pdf_routes, "_PdfAnnotation") is PdfAnnotation
    assert getattr(pdf_routes, "_ann_get_db") is get_db
    assert getattr(pdf_routes, "require_role") is require_role
    assert PdfAnnotation.__module__ == "backend.models.pdf_annotation"
    for request_model in (pdf_routes._PdfAnnotationCreate, pdf_routes._PdfAnnotationUpdate):
        assert request_model.__module__ == "backend.api.vault_routes"
        assert getattr(vault_routes, request_model.__name__) is request_model
    for response_class in (
        pdf_routes.PdfAnnotationResponse, pdf_routes.PdfAnnotationDeletedResponse,
    ):
        assert response_class.__module__ == PDF_MODULE
        assert getattr(vault_routes, response_class.__name__) is response_class

    routes = _pdf_routes()
    assert [(route.path, route.methods, route.name) for route in routes] == [
        ("/pdf-annotations", {"GET"}, "list_pdf_annotations"),
        ("/pdf-annotations", {"POST"}, "create_pdf_annotation"),
        ("/pdf-annotations/{ann_id}", {"PATCH"}, "update_pdf_annotation"),
        ("/pdf-annotations/{ann_id}", {"DELETE"}, "delete_pdf_annotation"),
    ]
    for route, response_model in zip(routes, (
        list[pdf_routes.PdfAnnotationResponse], pdf_routes.PdfAnnotationResponse,
        pdf_routes.PdfAnnotationResponse, pdf_routes.PdfAnnotationDeletedResponse,
    ), strict=True):
        assert route.endpoint is getattr(pdf_routes, route.name)
        assert route.endpoint is getattr(vault_routes, route.name)
        assert route.response_model == response_model
        assert route.status_code is None
        assert route.dependencies[0].dependency is get_workspace_context
        assert len(route.dependencies) == (1 if route.methods == {"GET"} else 2)
    original_routes = tuple(vault_routes.router.routes)
    importlib.import_module(PDF_MODULE)
    importlib.import_module("backend.api.vault_routes")
    assert tuple(vault_routes.router.routes) == original_routes


def check_complete_pdf_openapi_is_unchanged(annotation_fixture: AnnotationFixture) -> None:
    response = annotation_fixture.client.get("/openapi.json")
    assert response.status_code == 200
    schema: object = response.json()
    digest = hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()
    assert digest == PDF_OPENAPI_SHA256


def check_real_sqlite_http_crud(annotation_fixture: AnnotationFixture) -> None:
    from backend.models.pdf_annotation import PdfAnnotation

    fixture = annotation_fixture
    body = {
        "source_uri": SOURCE_URI, "page": 2, "type": "highlight",
        "color": "#abcdef", "rects": [{"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.03}],
        "text": "Citació àgil", "comment": "Comentari", "tags": "revisió,pdf",
    }
    response = fixture.client.post("/pdf-annotations", json=body)
    assert response.status_code == 200
    created: dict[str, object] = response.json()
    assert set(created) == RESPONSE_KEYS
    assert created == {
        **body, "id": 1, "created_at": created["created_at"], "updated_at": created["updated_at"],
    }
    for field in ("created_at", "updated_at"):
        timestamp = created[field]
        assert isinstance(timestamp, str)
        datetime.fromisoformat(timestamp)
    row = fixture.db.query(PdfAnnotation).one()
    assert row.rects_json == json.dumps(body["rects"])
    assert row.managed_key is None
    assert row.text == "Citació àgil"

    listed = fixture.client.get("/pdf-annotations", params={"source_uri": SOURCE_URI})
    assert listed.status_code == 200
    assert listed.json() == [created]
    assert fixture.client.get(
        "/pdf-annotations", params={"source_uri": "file:///other.pdf"},
    ).json() == []

    response = fixture.client.patch("/pdf-annotations/1", json={
        "color": None, "rects": None, "text": None, "comment": None, "tags": None,
    })
    assert response.status_code == 200
    assert response.json() == created

    updates = {"color": "", "rects": [], "text": "", "comment": "", "tags": ""}
    response = fixture.client.patch("/pdf-annotations/1", json=updates)
    assert response.status_code == 200
    updated: dict[str, object] = response.json()
    assert updated == {**created, **updates, "updated_at": updated["updated_at"]}
    assert updated["updated_at"] != created["updated_at"]
    fixture.db.expire_all()
    assert row.rects_json == "[]"
    assert row.color == ""

    # Null/omitted fields are deliberately not a request to clear the value.
    for no_change in ({}, dict.fromkeys(updates), {"source_uri": "ignored", "page": 9,
                                                 "type": "ignored", "unknown": True}):
        response = fixture.client.patch("/pdf-annotations/1", json=no_change)
        assert response.status_code == 200
        assert response.json() == updated

    response = fixture.client.delete("/pdf-annotations/1")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "id": 1}
    fixture.db.expire_all()
    assert fixture.db.query(PdfAnnotation).count() == 0
    assert fixture.client.get("/pdf-annotations", params={"source_uri": SOURCE_URI}).json() == []


@pytest.mark.parametrize("kind", [
    "highlight", "underline", "strikeout", "comment", "area", "text", "note", "ink", "image",
])
def check_all_supported_types_and_historical_defaults(
    annotation_fixture: AnnotationFixture, kind: str,
) -> None:
    from backend.models.pdf_annotation import PdfAnnotation

    fixture = annotation_fixture
    for color in ({}, {"color": None}, {"color": ""}):
        response = fixture.client.post("/pdf-annotations", json={
            "source_uri": "", "page": -1, "type": kind, "rects": [], "unknown": "ignored",
            **color,
        })
        assert response.status_code == 200
        created: dict[str, object] = response.json()
        assert created == {
            "id": created["id"], "source_uri": "", "page": -1, "type": kind,
            "color": "#ffeb3b", "rects": [], "text": None, "comment": None, "tags": None,
            "created_at": created["created_at"], "updated_at": created["updated_at"],
        }
    assert fixture.db.query(PdfAnnotation).count() == 3
    assert all(row.rects_json is None for row in fixture.db.query(PdfAnnotation).all())


def check_pydantic_coercion_and_json_storage(annotation_fixture: AnnotationFixture) -> None:
    from backend.models.pdf_annotation import PdfAnnotation

    response = annotation_fixture.client.post("/pdf-annotations", json={
        "source_uri": SOURCE_URI, "page": "0", "type": "ink",
        "rects": [{"x": "1.5", "custom": -3, "accent_à": True}],
    })
    assert response.status_code == 200
    created: dict[str, object] = response.json()
    assert created["page"] == 0
    assert created["rects"] == [{"x": 1.5, "custom": -3.0, "accent_à": 1.0}]
    row = annotation_fixture.db.query(PdfAnnotation).one()
    assert row.rects_json == json.dumps(created["rects"])
    response = annotation_fixture.client.patch("/pdf-annotations/1", json={
        "rects": [{"x": "2.5", "accent_à": False}],
    })
    assert response.status_code == 200
    assert response.json()["rects"] == [{"x": 2.5, "accent_à": 0.0}]
    annotation_fixture.db.refresh(row)
    assert row.rects_json == json.dumps([{"x": 2.5, "accent_à": 0.0}])


def check_sqlite_filter_and_page_creation_order(annotation_fixture: AnnotationFixture) -> None:
    from backend.models.pdf_annotation import PdfAnnotation

    fixture = annotation_fixture
    earlier = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    later = datetime(2024, 1, 3, 3, 4, 5, tzinfo=timezone.utc)
    for identifier, page, created, source in (
        (1, 2, earlier, SOURCE_URI), (2, 1, later, SOURCE_URI),
        (3, 1, earlier, SOURCE_URI), (4, 0, earlier, "other"),
    ):
        fixture.db.add(PdfAnnotation(
            id=identifier, source_uri=source, page=page, type="highlight",
            created_at=created, updated_at=later,
        ))
    fixture.db.commit()
    response = fixture.client.get("/pdf-annotations", params={"source_uri": SOURCE_URI})
    assert response.status_code == 200
    items: list[dict[str, object]] = response.json()
    assert [item["id"] for item in items] == [3, 2, 1]
    assert items[0]["created_at"] == "2024-01-02T03:04:05"
    assert items[0]["updated_at"] == "2024-01-03T03:04:05"


@pytest.mark.parametrize("kind", ["invalid", "Highlight", "", " highlight "])
def check_unsupported_type_error(annotation_fixture: AnnotationFixture, kind: str) -> None:
    from backend.models.pdf_annotation import PdfAnnotation

    response = annotation_fixture.client.post("/pdf-annotations", json={
        "source_uri": SOURCE_URI, "page": 1, "type": kind,
    })
    assert response.status_code == 400
    assert response.json() == {"detail": f"Unsupported annotation type: {kind}"}
    assert annotation_fixture.db.query(PdfAnnotation).count() == 0


@pytest.mark.parametrize("method", ["patch", "delete"])
def check_missing_annotation_error(annotation_fixture: AnnotationFixture, method: str) -> None:
    response = annotation_fixture.client.request(method, "/pdf-annotations/999", json={})
    assert response.status_code == 404
    assert response.json() == {"detail": "Annotation not found"}


@pytest.mark.parametrize(("method", "url", "body", "location", "error_type"), [
    ("get", "/pdf-annotations", None, ["query", "source_uri"], "missing"),
    ("get", "/pdf-annotations?source_uri=", None, ["query", "source_uri"], "string_too_short"),
    ("post", "/pdf-annotations", None, ["body"], "missing"),
    ("post", "/pdf-annotations", {"page": 1, "type": "highlight"},
     ["body", "source_uri"], "missing"),
    ("post", "/pdf-annotations", {"source_uri": SOURCE_URI, "type": "highlight"},
     ["body", "page"], "missing"),
    ("post", "/pdf-annotations", {"source_uri": SOURCE_URI, "page": 1},
     ["body", "type"], "missing"),
    ("post", "/pdf-annotations", {"source_uri": SOURCE_URI, "page": 1.5, "type": "highlight"},
     ["body", "page"], "int_from_float"),
    ("post", "/pdf-annotations", {"source_uri": SOURCE_URI, "page": 1, "type": "highlight",
                                  "rects": [{"x": "not-a-number"}]},
     ["body", "rects", 0, "x"], "float_parsing"),
    ("patch", "/pdf-annotations/999", {"rects": {}}, ["body", "rects"], "list_type"),
    ("patch", "/pdf-annotations/999", {"color": 42}, ["body", "color"], "string_type"),
    ("patch", "/pdf-annotations/invalid", {}, ["path", "ann_id"], "int_parsing"),
    ("delete", "/pdf-annotations/invalid", None, ["path", "ann_id"], "int_parsing"),
])
def check_validation_errors(
    annotation_fixture: AnnotationFixture, method: str, url: str,
    body: object, location: list[str | int], error_type: str,
) -> None:
    from backend.models.pdf_annotation import PdfAnnotation

    response = annotation_fixture.client.request(method, url, json=body)
    assert response.status_code == 422
    messages = {
        "missing": "Field required",
        "string_too_short": "String should have at least 1 character",
        "int_from_float": "Input should be a valid integer, got a number with a fractional part",
        "float_parsing": "Input should be a valid number, unable to parse string as a number",
        "list_type": "Input should be a valid list",
        "string_type": "Input should be a valid string",
        "int_parsing": "Input should be a valid integer, unable to parse string as an integer",
    }
    invalid_inputs: dict[str, object] = {
        "missing": body if location[0] == "body" else None,
        "string_too_short": "", "int_from_float": 1.5, "float_parsing": "not-a-number",
        "list_type": {}, "string_type": 42, "int_parsing": "invalid",
    }
    expected: dict[str, object] = {
        "type": error_type, "loc": location, "msg": messages[error_type],
        "input": invalid_inputs[error_type],
    }
    if error_type == "string_too_short":
        expected["ctx"] = {"min_length": 1}
    assert response.json() == {"detail": [expected]}
    assert annotation_fixture.db.query(PdfAnnotation).count() == 0


@pytest.mark.parametrize("role", ["viewer", "unrecognized"])
def check_real_editor_guard(annotation_fixture: AnnotationFixture, role: str) -> None:
    from backend.models.pdf_annotation import PdfAnnotation

    fixture = annotation_fixture
    row = PdfAnnotation(source_uri=SOURCE_URI, page=1, type="note", text="keep")
    fixture.db.add(row)
    fixture.db.commit()
    fixture.context.role = role
    response = fixture.client.get("/pdf-annotations", params={"source_uri": SOURCE_URI})
    assert response.status_code == 200
    assert len(response.json()) == 1
    for method, url, body in (
        ("post", "/pdf-annotations", {"source_uri": SOURCE_URI, "page": 1, "type": "note"}),
        ("patch", "/pdf-annotations/1", {"text": "forbidden"}),
        ("delete", "/pdf-annotations/1", None),
    ):
        response = fixture.client.request(method, url, json=body)
        assert response.status_code == 403
        assert response.json() == {
            "detail": f"Insufficient permission. Role editor is required (you have {role})",
        }
    fixture.db.refresh(row)
    assert row.text == "keep"
    assert fixture.db.query(PdfAnnotation).count() == 1


@pytest.mark.parametrize("role", ["owner", "admin", "editor", "EDITOR"])
def check_authorized_roles(annotation_fixture: AnnotationFixture, role: str) -> None:
    annotation_fixture.context.role = role
    response = annotation_fixture.client.post("/pdf-annotations", json={
        "source_uri": SOURCE_URI, "page": 1, "type": "note",
    })
    assert response.status_code == 200
    response = annotation_fixture.client.patch("/pdf-annotations/1", json={"text": "ok"})
    assert response.status_code == 200
    assert annotation_fixture.client.delete("/pdf-annotations/1").status_code == 200


def check_direct_crud_returns_dictionaries(annotation_fixture: AnnotationFixture) -> None:
    from fastapi import HTTPException

    from backend.domains.vault.annotations import pdf_routes

    db = annotation_fixture.db
    created = pdf_routes.create_pdf_annotation(
        pdf_routes._PdfAnnotationCreate(source_uri=SOURCE_URI, page=1, type="note"), db,
    )
    assert type(created) is dict
    assert set(created) == RESPONSE_KEYS
    identifier = created["id"]
    listed = pdf_routes.list_pdf_annotations(SOURCE_URI, db)
    assert type(listed) is list
    assert type(listed[0]) is dict
    assert listed == [created]
    updated = pdf_routes.update_pdf_annotation(
        identifier, pdf_routes._PdfAnnotationUpdate(comment="actualitzat", rects=[]), db,
    )
    assert type(updated) is dict
    assert updated["comment"] == "actualitzat"
    assert updated["rects"] == []
    deleted = pdf_routes.delete_pdf_annotation(identifier, db)
    assert type(deleted) is dict
    assert deleted == {"status": "ok", "id": identifier}
    with pytest.raises(HTTPException) as error:
        pdf_routes.delete_pdf_annotation(identifier, db)
    assert error.value.status_code == 404
    assert error.value.detail == "Annotation not found"


@pytest.mark.parametrize(("stored", "expected"), [
    (None, []), ("", []), ("[]", []), ("null", None), ("false", False), ("42", 42),
    ('"literal"', "literal"), ('{"custom": [1, null]}', {"custom": [1, None]}),
    ('[{"x": 1, "x": 2}]', [{"x": 2}]), ('[{"x": "1.5"}]', [{"x": "1.5"}]),
])
def check_direct_json_semantics(
    isolated_backend: None, stored: str | None, expected: object,
) -> None:
    from backend.domains.vault.annotations.pdf_routes import _pdf_annotation_to_dict
    from backend.models.pdf_annotation import PdfAnnotation

    timestamp = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    row = PdfAnnotation(
        id=7, source_uri=SOURCE_URI, page=1, type="note", color=None, rects_json=stored,
        text=None, comment=None, tags=None, created_at=timestamp, updated_at=None,
        managed_key="not-exposed",
    )
    payload = _pdf_annotation_to_dict(row)
    assert type(payload) is dict
    assert payload == {
        "id": 7, "source_uri": SOURCE_URI, "page": 1, "type": "note", "color": None,
        "rects": expected, "text": None, "comment": None, "tags": None,
        "created_at": "2024-01-02T03:04:05+00:00", "updated_at": None,
    }


@pytest.mark.parametrize("stored", ["NaN", "Infinity", "-Infinity"])
def check_direct_nonfinite_json_is_not_normalized(isolated_backend: None, stored: str) -> None:
    from backend.domains.vault.annotations.pdf_routes import _pdf_annotation_to_dict
    from backend.models.pdf_annotation import PdfAnnotation

    result = _pdf_annotation_to_dict(PdfAnnotation(rects_json=stored))["rects"]
    assert isinstance(result, float)
    if stored == "NaN":
        assert math.isnan(result)
    else:
        assert result == float(stored)


def check_corrupt_stored_json_keeps_error(annotation_fixture: AnnotationFixture) -> None:
    from backend.domains.vault.annotations.pdf_routes import _pdf_annotation_to_dict
    from backend.models.pdf_annotation import PdfAnnotation

    row = PdfAnnotation(source_uri=SOURCE_URI, page=1, type="note", rects_json="{")
    annotation_fixture.db.add(row)
    annotation_fixture.db.commit()
    with pytest.raises(json.JSONDecodeError):
        _pdf_annotation_to_dict(row)
    with pytest.raises(json.JSONDecodeError):
        annotation_fixture.client.get("/pdf-annotations", params={"source_uri": SOURCE_URI})


@pytest.mark.parametrize("stored", ["null", "false", "42", '{"x": 1}'])
def check_http_still_validates_stored_rectangles(
    annotation_fixture: AnnotationFixture, stored: str,
) -> None:
    from fastapi.exceptions import ResponseValidationError

    from backend.models.pdf_annotation import PdfAnnotation

    annotation_fixture.db.add(PdfAnnotation(
        source_uri=SOURCE_URI, page=1, type="note", rects_json=stored,
    ))
    annotation_fixture.db.commit()
    with pytest.raises(ResponseValidationError):
        annotation_fixture.client.get("/pdf-annotations", params={"source_uri": SOURCE_URI})
