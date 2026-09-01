"""Synthetic media HTTP, sidecar and compatibility checks in clean subprocesses.

Only the wrapper is collected normally. No application lifespan, live service,
native picker, provider request or cloud hydration is exercised.
"""

from __future__ import annotations

import ast
import asyncio
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
from typing import TYPE_CHECKING, get_type_hints

import pytest

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.services.media_service import MediaService

ROOT = Path(__file__).resolve().parents[2]
MODULE = "backend.domains.vault.media.routes"
DELEGATED = {
    "serve_vault_image",
    "serve_library_file",
    "serve_vault_raw_file",
    "serve_thumb",
    "register_local_file",
    "serve_local_file",
    "get_custom_icons",
    "save_custom_icons",
    "upload_property_file",
    "link_existing_file",
    "delete_physical_file",
    "duplicate_page",
}


@pytest.mark.parametrize("order", ["facade-first", "domain-first"])
def test_vault_media_composition_in_isolated_subprocess(order: str) -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-media-composition-") as temporary:
        fixture = Path(temporary).resolve()
        for name in ("data", "vault", "host"):
            (fixture / name).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(fixture),
            "GNOSI_DATA_DIR": str(fixture / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(fixture / "vault"),
            "VAULT_HOST_PATH": str(fixture / "vault"),
            "HOME_HOST_PATH": str(fixture / "host"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_REQUIRE_AUTH": "1",
            "GNOSI_MODE": "organization",
            "GNOSI_JWT_SECRET": "synthetic-media-test-not-an-account-secret",
            "GNOSI_MEDIA_IMPORT_ORDER": order,
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
                str(fixture / "tests"),
                "-o",
                "python_functions=check_*",
                "backend/tests/test_vault_media_typed_composition.py",
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(f"{order}: {result.stdout}")


@pytest.fixture(scope="session")
def isolated_backend() -> Iterator[None]:
    import requests

    assert MODULE not in sys.modules and "backend.api.vault_routes" not in sys.modules
    fixture = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    for variable, name in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        assert Path(os.environ[variable]) == fixture / name
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"
    assert (
        not {"OPENAI_API_KEY", "UNSPLASH_ACCESS_KEY", "GNOSI_SHARED_ENV_FILE"} & os.environ.keys()
    )

    def prohibit_network(*args: object, **kwargs: object) -> None:
        raise AssertionError("No external HTTP is permitted in media composition tests")

    with pytest.MonkeyPatch.context() as guard:
        guard.setattr(requests.sessions.Session, "request", prohibit_network)
        importlib.import_module(
            MODULE
            if os.environ["GNOSI_MEDIA_IMPORT_ORDER"] == "domain-first"
            else "backend.api.vault_routes"
        )
        from backend.config.validation_runtime import validation_runtime_enabled

        assert validation_runtime_enabled()
        yield


@dataclass
class MediaFixture:
    app: FastAPI
    client: TestClient
    service: MediaService
    root: Path


@pytest.fixture
def media(
    isolated_backend: None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[MediaFixture]:
    from fastapi import APIRouter, FastAPI
    from fastapi.routing import APIRoute
    from fastapi.testclient import TestClient

    from backend.api import vault_routes
    from backend.domains.vault.media import routes
    from backend.services import media_service
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context

    vault = tmp_path / "vault"
    (vault / "Images" / "General").mkdir(parents=True)
    monkeypatch.setattr(media_service, "_active_vault_path", lambda: vault)
    monkeypatch.setattr(media_service, "_PERSIST_DIR", tmp_path / "media-cache")
    service = media_service.MediaService()
    monkeypatch.setattr(vault_routes, "media_service", service)
    selected = APIRouter()
    selected.routes.extend(
        route
        for route in routes.router.routes
        if isinstance(route, APIRoute)
        and (route.endpoint.__module__ == MODULE or route.endpoint.__name__ in DELEGATED)
    )
    app = FastAPI()
    app.include_router(selected, prefix="/api/vault", tags=["Vault"])
    context = WorkspaceContext(
        user_id="synthetic-user",
        workspace_id="synthetic-workspace",
        role="admin",
        vault_path=vault,
    )
    app.dependency_overrides[get_workspace_context] = lambda: context
    with TestClient(app, raise_server_exceptions=False) as client:
        yield MediaFixture(app, client, service, vault)


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return value


def check_openapi_operations_and_referenced_schemas_are_unchanged(media: MediaFixture) -> None:
    committed = json.loads((ROOT / "openapi/openapi.json").read_text())
    current = media.app.openapi()
    assert len(current["paths"]) == 23
    for path, operation in current["paths"].items():
        assert operation == committed["paths"][path], path
    for name, schema in current.get("components", {}).get("schemas", {}).items():
        assert schema == committed["components"]["schemas"][name], name


def check_identities_route_order_and_shared_state(media: MediaFixture) -> None:
    from fastapi.routing import APIRoute

    from backend.api import vault_routes
    from backend.domains.vault.api import pages_duplicate
    from backend.domains.vault.assets import api as assets
    from backend.domains.vault.files import api as files
    from backend.domains.vault.files import property_service, thumbnails
    from backend.domains.vault.files.state import file_serving_state
    from backend.domains.vault.media import routes, schemas

    assert routes.router is vault_routes.router
    assert routes._VAULT_IMAGE_SEMAPHORE is file_serving_state.semaphore
    assert routes._LOCAL_LINKS_LOCK is vault_routes._LOCAL_LINK_STORE.lock
    assert routes._THUMB_ROOTS_MAP is thumbnails.THUMB_ROOTS_MAP
    assert routes._STORAGE_FOLDER_ALIASES is property_service.STORAGE_FOLDER_ALIASES
    assert get_type_hints(routes.create_media_view)["payload"] is schemas.MediaViewInput
    assert get_type_hints(routes.update_media_view)["payload"] is schemas.MediaViewInput
    assert routes.UnsplashSearchResponse.__module__ == MODULE
    for name in DELEGATED:
        owner = (
            pages_duplicate
            if name == "duplicate_page"
            else assets
            if name in {"serve_vault_image", "get_custom_icons", "save_custom_icons"}
            else files
        )
        assert getattr(routes, name) is getattr(owner, name)
        assert getattr(vault_routes, name) is getattr(owner, name)
    endpoints = [
        r
        for r in routes.router.routes
        if isinstance(r, APIRoute) and r.endpoint.__module__ == MODULE
    ]
    assert [r.path for r in endpoints] == [
        "/media/roots",
        "/media",
        "/media/albums",
        "/media/tree",
        "/media/upload",
        "/media/metadata",
        "/media/views",
        "/media/views",
        "/media/views/{view_id}",
        "/media/views/{view_id}",
        "/pick-folder",
        "/pick-file",
        "/unsplash/search",
    ]
    assert len({(r.path, tuple(r.methods or ())) for r in endpoints}) == 13
    for endpoint in endpoints:
        assert endpoint.status_code is None
        assert len(endpoint.dependencies) == (1 if endpoint.methods == {"GET"} else 2)


@pytest.mark.parametrize(
    "path,detail",
    [
        ("/media?root=wrong", "Root invàlid: 'wrong'"),
        ("/media?sort=wrong", "sort invàlid: 'wrong'"),
        ("/media?dir=wrong", "dir invàlid: 'wrong'"),
        ("/media/tree?root=wrong", "Root invàlid: 'wrong'"),
    ],
)
def check_invalid_browser_parameters(media: MediaFixture, path: str, detail: str) -> None:
    response = media.client.get("/api/vault" + path)
    assert response.status_code == 400 and response.json() == {"detail": detail}


@pytest.mark.parametrize("query", ["limit=0", "limit=501", "offset=-1", "size_min=-1"])
def check_query_validation(media: MediaFixture, query: str) -> None:
    assert media.client.get("/api/vault/media?" + query).status_code == 422


def check_upload_metadata_filters_and_sidecar_roundtrip(media: MediaFixture) -> None:
    response = media.client.post(
        "/api/vault/media/upload?album=General/Child",
        files={"file": ("sample.pdf", b"%PDF-synthetic-media", "application/pdf")},
    )
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["filename"] == "sample.pdf" and item["kind"] == "pdf"
    assert (media.root / "Images/General/Child/sample.pdf").read_bytes() == b"%PDF-synthetic-media"
    metadata = {"tags": ["Review", "Àlbum"], "description": "Synthetic paper"}
    for payload in (
        {"path_in_root": "General/Child/sample.pdf", "metadata": metadata},
        {"filename": "sample.pdf", "album": "General/Child", "metadata": metadata},
    ):
        response = media.client.patch("/api/vault/media/metadata", json=payload)
        assert response.status_code == 200 and response.json() == {"status": "ok"}
    page = media.client.get("/api/vault/media?root=images&kinds=pdf&q=sample&tags_any=review")
    assert page.status_code == 200 and page.json()["total"] == 1
    assert page.json()["items"][0]["description"] == "Synthetic paper"
    sidecar = media.service._user_meta_path()
    assert sidecar is not None and sidecar.is_relative_to(media.root)
    stored = json.loads(sidecar.read_text())
    assert stored["items"]["images::General/Child/sample.pdf"]["description"] == "Synthetic paper"
    assert media.client.get("/api/vault/media/albums").json() == ["General"]
    tree = media.client.get("/api/vault/media/tree?path=General").json()
    assert tree == [{"name": "Child", "path": "General/Child", "has_children": False}]


def check_saved_view_persistence_and_error_statuses(media: MediaFixture) -> None:
    response = media.client.post("/api/vault/media/views", json={"label": "PDFs"})
    assert response.status_code == 200, response.text
    created = response.json()
    view_id = created["id"]
    assert created["label"] == "PDFs"
    updated = media.client.patch(f"/api/vault/media/views/{view_id}", json={"label": "Renamed"})
    assert updated.status_code == 200 and updated.json()["id"] == view_id
    assert updated.json()["created_at"] == created["created_at"]
    path = media.service._views_path()
    assert path is not None and path.is_relative_to(media.root)
    assert json.loads(path.read_text())["items"][0]["label"] == "Renamed"
    media.service._views = None
    assert media.client.get("/api/vault/media/views").json()[0]["label"] == "Renamed"
    assert media.client.delete(f"/api/vault/media/views/{view_id}").json() == {"status": "ok"}
    for method in ("patch", "delete"):
        missing = media.client.request(method, f"/api/vault/media/views/{view_id}", json={})
        assert missing.status_code == 404 and missing.json() == {"detail": "Vista no trobada"}
    blank = media.client.post("/api/vault/media/views", json={})
    assert blank.status_code == 400


@pytest.mark.parametrize(
    "payload,status,detail",
    [
        ({"metadata": {}}, 400, "`path_in_root` or `filename` is required"),
        ({"metadata": {}, "root": "bad"}, 400, "Root invàlid: 'bad'"),
        ({"metadata": {}, "filename": "sample.pdf"}, 500, "Persistence error"),
    ],
)
def check_metadata_failures(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, object],
    status: int,
    detail: str,
) -> None:
    monkeypatch.setattr(media.service, "update_metadata", lambda *args, **kwargs: False)
    response = media.client.patch("/api/vault/media/metadata", json=payload)
    assert response.status_code == status and response.json() == {"detail": detail}


def check_open_values_and_late_service_replacement(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes
    from backend.domains.vault.media import routes, schemas
    from backend.services.media_service import MediaService

    metadata: dict[str, object] = {"date": date(2026, 8, 31), "custom": [None, 3]}
    seen: list[tuple[str, object, str]] = []

    def update(path: str, value: dict[str, object], root: str) -> bool:
        seen.append((path, value, root))
        return True

    replacement = MediaService()
    monkeypatch.setattr(replacement, "update_metadata", update)
    monkeypatch.setattr(replacement, "create_view", lambda _data: metadata)
    monkeypatch.setattr(vault_routes, "media_service", replacement)
    result = asyncio.run(routes.update_media_metadata(metadata, "a", "images", None, None))
    assert result == {"status": "ok"}
    assert seen == [("a", metadata, "images")] and seen[0][1] is metadata
    assert asyncio.run(routes.create_media_view(schemas.MediaViewInput(label="View"))) is metadata


def check_every_browser_filter_reaches_the_service_unchanged(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.media.composition import media_service

    seen: list[tuple[str | None, dict[str, object]]] = []

    def query(album: str | None, **kwargs: object) -> dict[str, object]:
        seen.append((album, kwargs))
        return {"items": [], "total": 0, "limit": 7, "offset": 3, "root": "assets"}

    monkeypatch.setattr(media.service, "get_all_media", query)
    assert media_service() is media.service
    response = media.client.get(
        "/api/vault/media",
        params={
            "album": "General/Child",
            "limit": "7",
            "offset": "3",
            "root": "assets",
            "kinds": "image,pdf",
            "extensions": "png,pdf",
            "q": "needle",
            "desc_contains": "text",
            "tags_any": "one,two",
            "tags_all": "three",
            "tags_none": "four",
            "size_min": "1",
            "size_max": "100",
            "mtime_from": "2026-01-01",
            "mtime_to": "2026-08-31",
            "sort": "size",
            "dir": "asc",
        },
    )
    assert response.status_code == 200
    assert seen == [
        (
            "General/Child",
            {
                "limit": 7,
                "offset": 3,
                "root": "assets",
                "kinds": "image,pdf",
                "extensions": "png,pdf",
                "q": "needle",
                "desc_contains": "text",
                "tags_any": "one,two",
                "tags_all": "three",
                "tags_none": "four",
                "size_min": 1,
                "size_max": 100,
                "mtime_from": "2026-01-01",
                "mtime_to": "2026-08-31",
                "sort": "size",
                "dir_": "asc",
            },
        )
    ]


def check_unsplash_success_payload_over_http(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import requests

    class Reply:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> object:
            return {
                "results": [
                    {
                        "id": "photo-1",
                        "urls": {
                            "regular": "https://img.test/full",
                            "small": "https://img.test/thumb",
                        },
                        "user": {"name": "Ada", "links": {"html": "https://unsplash.test/ada"}},
                    }
                ],
                "total_pages": 3,
            }

    monkeypatch.setenv("UNSPLASH_ACCESS_KEY", "synthetic")
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: Reply())
    response = media.client.get("/api/vault/unsplash/search?query=knowledge&page=2")
    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "id": "photo-1",
                "url": "https://img.test/full",
                "thumb": "https://img.test/thumb",
                "author": "Ada",
                "author_url": "https://unsplash.test/ada",
            }
        ],
        "total_pages": 3,
    }


@pytest.mark.parametrize("value", [{}, {"results": []}, {"results": {}}, {"results": ""}])
def check_unsplash_empty_defaults(isolated_backend: None, value: object) -> None:
    from backend.domains.vault.media.unsplash_payload import search_payload

    assert search_payload(value) == {"results": [], "total_pages": 1}


@pytest.mark.parametrize(
    "value",
    [None, 2, [], {"results": None}, {"results": [None]}, {"results": [{"id": "missing-fields"}]}],
)
def check_unsplash_bad_shapes_map_to_502(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
    value: object,
) -> None:
    import requests

    class Reply:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> object:
            return value

    monkeypatch.setenv("UNSPLASH_ACCESS_KEY", "synthetic")
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: Reply())
    response = media.client.get("/api/vault/unsplash/search?query=synthetic")
    assert response.status_code == 502
    assert response.json() == {"detail": "Error fetching from Unsplash API"}


def check_unsplash_request_and_uncoerced_leaves(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import requests

    from backend.domains.vault.media import routes

    photo_id: object = [None, True]
    total: object = {"unknown": [1]}
    raw = {
        "results": [
            {
                "id": photo_id,
                "urls": {"regular": None, "small": 4},
                "user": {"name": False, "links": {"html": ["link"]}},
            }
        ],
        "total_pages": total,
    }
    calls: list[tuple[str, dict[str, object]]] = []

    class Reply:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> object:
            return raw

    def get(url: str, **kwargs: object) -> Reply:
        calls.append((url, kwargs))
        return Reply()

    monkeypatch.setenv("UNSPLASH_ACCESS_KEY", "synthetic")
    monkeypatch.setattr(requests, "get", get)
    result = asyncio.run(routes.unsplash_search("knowledge", 2))
    assert result["results"][0]["id"] is photo_id and result["total_pages"] is total
    assert result["results"][0]["author"] is False
    assert calls == [
        (
            "https://api.unsplash.com/search/photos",
            {
                "headers": {"Authorization": "Client-ID synthetic"},
                "params": {
                    "query": "knowledge",
                    "page": 2,
                    "per_page": 21,
                    "orientation": "landscape",
                },
                "timeout": 10,
            },
        )
    ]
    # HTTP validation was never bypassed by the open direct-call contract.
    assert media.client.get("/api/vault/unsplash/search?query=x").status_code == 500


def check_unsplash_missing_key_and_provider_failure(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import requests

    response = media.client.get("/api/vault/unsplash/search?query=x")
    assert response.status_code == 500
    assert response.json() == {
        "detail": "Unsplash API Key is not configured in .env (UNSPLASH_ACCESS_KEY)"
    }

    def failure(*args: object, **kwargs: object) -> None:
        raise requests.Timeout("synthetic timeout")

    monkeypatch.setenv("UNSPLASH_ACCESS_KEY", "synthetic")
    monkeypatch.setattr(requests, "get", failure)
    response = media.client.get("/api/vault/unsplash/search?query=x")
    assert response.status_code == 502
    assert response.json() == {"detail": "Error fetching from Unsplash API"}


@pytest.mark.parametrize("kind", ["file", "folder"])
@pytest.mark.parametrize("failure,status", [("empty", 204), ("timeout", 408), ("error", 500)])
def check_native_picker_failures_without_launching_picker(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    failure: str,
    status: int,
) -> None:
    from fastapi import HTTPException

    from backend.domains.vault.media import routes

    def picker(script: str) -> str:
        assert "choose " + kind in script
        if failure == "timeout":
            raise subprocess.TimeoutExpired("synthetic", 60)
        if failure == "error":
            raise OSError("synthetic failure")
        return ""

    monkeypatch.setattr(routes, "_run_osascript_picker", picker)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.pick_file() if kind == "file" else routes.pick_folder())
    assert error.value.status_code == status
    if status == 204:
        assert error.value.detail == f"No {kind} selected"
    if status == 408:
        assert error.value.detail == f"{kind.title()} picker timed out"


def check_native_picker_success_without_launching_picker(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.media import routes

    target = media.root / "synthetic.txt"
    target.write_text("hello")
    monkeypatch.setattr(routes, "_run_osascript_picker", lambda _script: str(target))
    assert asyncio.run(routes.pick_file()) == {"path": str(target), "name": target.name, "size": 5}
    assert asyncio.run(routes.pick_folder()) == {"path": str(target)}
    target.unlink()
    assert asyncio.run(routes.pick_file())["size"] == 0


@pytest.mark.parametrize("dashboard", [False, True])
def check_duplicate_late_callbacks_and_task_identity(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
    dashboard: bool,
) -> None:
    from fastapi import BackgroundTasks

    from backend.api import vault_routes
    from backend.domains.vault.media import routes

    source = media.root / ("source.json" if dashboard else "source.md")
    source.write_text("synthetic content")
    metadata: dict[str, object] = {
        "id": "source",
        "title": "Original",
        "date": date(2026, 8, 31),
        "parent_id": ["legacy", None],
        "is_database": "yes",
    }
    written: list[dict[str, object]] = []
    indexed: list[Path] = []
    linked: list[Path] = []

    def write_dashboard(**kwargs: object) -> None:
        written.append(kwargs)

    def save(path: Path, data: dict[str, object], content: str) -> None:
        written.append({"file_path": path, "metadata": data, "content": content})

    def ensure(data: dict[str, object], *, regenerate: bool) -> dict[str, object]:
        assert regenerate
        return data

    def link(path: Path) -> None:
        linked.append(path)

    monkeypatch.setattr(vault_routes, "find_page_path", lambda _page_id: source)
    monkeypatch.setattr(vault_routes, "_is_dashboard_file_path", lambda _path: dashboard)
    monkeypatch.setattr(vault_routes, "_read_dashboard_file", lambda _path: (metadata, "body"))
    monkeypatch.setattr(vault_routes, "parse_frontmatter", lambda _raw, _path: (metadata, "body"))
    monkeypatch.setattr(vault_routes, "_write_dashboard_file", write_dashboard)
    monkeypatch.setattr(vault_routes, "_ensure_recursos_citation_key", ensure)
    monkeypatch.setattr(vault_routes, "save_page_md", save)
    monkeypatch.setattr(vault_routes, "_add_page_to_index_cache", indexed.append)
    monkeypatch.setattr(vault_routes, "update_link_index_for_page", link)
    tasks = BackgroundTasks()
    result = asyncio.run(routes.duplicate_page("source", tasks))
    assert result["status"] == "created" and result["title"] == "Original (Copy)"
    assert result["id"] != "source"
    assert len(written) == 1 and indexed == [written[0]["file_path"]]
    assert _mapping(written[0]["metadata"])["date"] is metadata["date"]
    assert metadata["title"] == "Original"
    if dashboard:
        assert written[0]["parent_id"] is metadata["parent_id"]
        assert written[0]["is_database"] is True
    assert len(tasks.tasks) == 1 and tasks.tasks[0].func is link
    asyncio.run(tasks())
    assert linked == indexed


def check_file_compatibility_helpers_use_canonical_dependencies(
    media: MediaFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.files import api as files
    from backend.domains.vault.media import routes

    mapping = {"synthetic": "/synthetic/file"}
    monkeypatch.setattr(files, "_load_local_links", lambda: mapping)
    assert routes._load_local_links() is mapping
    monkeypatch.setattr(files, "_resolve_thumb_source", lambda _url: media.root)
    assert routes._resolve_thumb_source("synthetic") is media.root
    assert routes._normalize_storage_folder("BIBLIOTECA") == "library"
    assert routes._effective_storage_folder("", "free") == "assets"
    assert routes._numbered_candidate(media.root, "file", ".pdf", 2) == media.root / "file-2.pdf"
    response = routes._thumb_no_store(503, "synthetic")
    assert response.status_code == 503 and "no-store" in response.headers["Cache-Control"]


def check_no_untyped_escape_hatches_in_owned_modules(isolated_backend: None) -> None:
    for name in ("routes.py", "composition.py", "contracts.py", "unsplash_payload.py"):
        source = (ROOT / "backend/domains/vault/media" / name).read_text()
        tree = ast.parse(source)
        assert not any(
            isinstance(n, ast.Name) and n.id in {"Any", "_LegacyAny", "_legacy"}
            for n in ast.walk(tree)
        )
        assert "type: ignore" not in source
        casts = [
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "cast"
        ]
        assert len(casts) == (1 if name == "composition.py" else 0)
