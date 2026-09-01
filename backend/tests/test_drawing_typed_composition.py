"""Exercise typed drawing/history composition in an isolated child process."""

from __future__ import annotations

import ast
import asyncio
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, get_type_hints

import pytest

if TYPE_CHECKING:
    from backend.domains.vault.drawings.service import DrawingDependencies

ROOT = Path(__file__).resolve().parents[2]
DRAWING_ID = "11111111-2222-4333-8444-555555555555"


def test_drawing_composition_in_isolated_subprocess() -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-drawing-composition-") as temporary:
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
            "GNOSI_JWT_SECRET": "synthetic-drawing-tests-not-an-account-secret",
        }
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "-p",
                "no:cacheprovider",
                "--basetemp",
                str(fixture / "tests"),
                "-o",
                "python_functions=check_*",
                "backend/tests/test_drawing_typed_composition.py",
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


@pytest.fixture
def vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    from backend.api import vault_routes

    root = tmp_path / "vault"
    (root / "Drawings").mkdir(parents=True)

    def get_path(key: str) -> Path:
        return root / "Drawings" if key == "DIBUIXOS" else root

    monkeypatch.setattr(vault_routes, "get_p", get_path)
    monkeypatch.setattr(vault_routes, "_trash_root", lambda: root / ".trash")
    yield root


def check_late_vault_override_is_seen_without_recomposition(
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes
    from backend.domains.vault.drawings import routes

    dependencies = routes._DRAWING_DEPENDENCIES
    assert dependencies.vault_root() == vault
    replacement = vault.parent / "second-vault"
    monkeypatch.setattr(vault_routes, "get_p", lambda _key: replacement)
    assert dependencies.vault_root() == replacement
    assert dependencies.drawings_directory() == replacement
    assert routes._DRAWING_DEPENDENCIES is dependencies


def check_writer_overrides_preserve_json_options(
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes
    from backend.domains.vault.drawings import routes

    calls: list[tuple[Path, object, dict[str, object]]] = []

    def writer(path: Path, data: object, **options: object) -> None:
        calls.append((path, data, options))

    monkeypatch.setattr(vault_routes, "safe_write_json", writer)
    target = vault / "drawing.json"
    payload = {"title": "Dibuix català", "data": {"value": None}}
    routes._DRAWING_DEPENDENCIES.write_drawing_json(target, payload)
    routes._DRAWING_DEPENDENCIES.write_trash_json(target, payload)
    assert calls == [
        (target, payload, {"indent": 2, "ensure_ascii": False}),
        (target, payload, {"indent": 2}),
    ]


def check_real_drawing_save_backup_delete_restore(vault: Path) -> None:
    from backend.api import vault_routes
    from backend.domains.vault.drawings import routes
    from backend.domains.vault.pages.runtime import DrawingSaveRequest

    original = {"document": {"shapes": [1, True, None]}, "schema": {"version": 1}}
    newer = {"document": {"shapes": []}, "schema": {"version": 2}}
    result = asyncio.run(
        routes.save_drawing(
            DRAWING_ID,
            DrawingSaveRequest(title="Original", data=original, metadata={}),
        )
    )
    assert result == {"status": "success", "id": DRAWING_ID}
    asyncio.run(
        routes.save_drawing(
            DRAWING_ID,
            DrawingSaveRequest(title="Segon", data=newer, metadata={}),
        )
    )
    backups = list((vault / ".history" / DRAWING_ID).glob("*.tldraw.json"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text())["data"] == original
    assert asyncio.run(routes.get_drawing(DRAWING_ID)) == newer
    deleted = asyncio.run(routes.delete_drawing(DRAWING_ID))
    assert deleted["status"] == "soft_deleted"
    assert deleted["title"] == "Segon"
    assert not (vault / "Drawings" / f"{DRAWING_ID}.tldraw.json").exists()
    vault_routes._restore_page_from_trash(DRAWING_ID)
    assert asyncio.run(routes.get_drawing(DRAWING_ID)) == newer


def check_service_output_identity_is_not_normalized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.drawings import routes, service

    # The legacy direct helper returns arbitrary decoded inner data; the HTTP
    # response model remains responsible for validating the document shape.
    payload: object = [None, True, {"custom": "value"}]

    async def get_drawing(_id: str, _dependencies: DrawingDependencies) -> object:
        return payload

    monkeypatch.setattr(service, "get_drawing", get_drawing)
    assert asyncio.run(routes.get_drawing(DRAWING_ID)) is payload


@pytest.mark.parametrize(
    "operation,status,detail",
    [
        ("get", 404, "Drawing not found"),
        ("delete", 404, "Drawing not found"),
    ],
)
def check_missing_drawing_error_contract(
    vault: Path,
    operation: str,
    status: int,
    detail: str,
) -> None:
    from fastapi import HTTPException

    from backend.domains.vault.drawings import routes

    action = routes.get_drawing if operation == "get" else routes.delete_drawing
    with pytest.raises(HTTPException) as error:
        asyncio.run(action(DRAWING_ID))
    assert error.value.status_code == status
    assert error.value.detail == detail


def check_shared_router_and_model_identity_are_preserved() -> None:
    from fastapi.routing import APIRoute

    from backend.api import vault_routes
    from backend.domains.vault.drawings import routes
    from backend.domains.vault.pages.runtime import DrawingSaveRequest

    assert routes.router is vault_routes.router
    assert get_type_hints(routes.save_drawing)["request"] is DrawingSaveRequest
    assert DrawingSaveRequest.__module__ == "backend.api.vault_routes"
    targets = [
        route
        for route in routes.router.routes
        if isinstance(route, APIRoute) and route.path.startswith("/drawings")
    ]
    assert len(targets) == 4
    for route in targets:
        assert getattr(vault_routes, route.endpoint.__name__) is route.endpoint


def check_history_force_and_content_writers_keep_existing_return_contract(vault: Path) -> None:
    from backend.domains.vault.drawings import routes

    create_file: Callable[[str, Path, bool], object] = routes._create_page_version
    create_content: Callable[[str, str], object] = routes._create_page_version_from_content
    page = vault / "page.md"
    page.write_text("original", encoding="utf-8")
    assert create_file(DRAWING_ID, page, False) is None
    assert create_file(DRAWING_ID, page, False) is None
    history = vault / ".history" / DRAWING_ID
    assert len(list(history.glob("*.md"))) == 1
    page.write_text("new content", encoding="utf-8")
    assert create_file(DRAWING_ID, page, True) is None
    assert {item.read_text() for item in history.glob("*.md")} == {"original", "new content"}
    other_id = "22222222-3333-4444-8555-666666666666"
    assert create_content(other_id, "captured content") is None
    assert next((vault / ".history" / other_id).glob("*.md")).read_text() == "captured content"


def check_history_metadata_keeps_non_json_values(
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import date

    from backend.domains.vault.api import history

    target = vault / ".history" / DRAWING_ID
    target.mkdir(parents=True)
    stamp = "20260831_000000"
    (target / f"{stamp}.md").write_text("source", encoding="utf-8")
    metadata: dict[str, object] = {"date": date(2026, 8, 31), "nested": {"key": [1, None]}}
    dependencies = replace(
        history._deps(), parse_frontmatter=lambda _text, _path: (metadata, " body ")
    )
    monkeypatch.setattr(history, "_dependencies", dependencies)
    result = asyncio.run(history.get_page_version_content(DRAWING_ID, stamp))
    assert result["metadata"] is metadata
    assert result["content"] == "body"


def check_typed_modules_do_not_reintroduce_any_or_untyped_module_access() -> None:
    for name in (
        "backend/domains/vault/drawings/routes.py",
        "backend/domains/vault/drawings/composition.py",
        "backend/domains/vault/api/history.py",
    ):
        tree = ast.parse((ROOT / name).read_text())
        assert not any(
            isinstance(node, ast.Name) and node.id in {"Any", "_LegacyAny"}
            for node in ast.walk(tree)
        )
        assert not any(
            isinstance(node, ast.Attribute) and node.attr == "Any" for node in ast.walk(tree)
        )
