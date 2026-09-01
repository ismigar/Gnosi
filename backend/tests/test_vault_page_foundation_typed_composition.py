"""Page document contracts exercised only in isolated child processes."""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from types import ModuleType
from typing import get_type_hints

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_page_foundation_in_isolated_subprocess() -> None:
    assert _run_import_order("facade") == _run_import_order("foundation")


def _run_import_order(first_module: str) -> str:
    with tempfile.TemporaryDirectory(prefix="gnosi-page-foundation-") as temporary:
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
            "GNOSI_JWT_SECRET": "synthetic-page-foundation-fixture-not-a-real-key",
            "GNOSI_FOUNDATION_IMPORT_FIRST": first_module,
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
                "--maxfail=1",
                "backend/tests/test_vault_page_foundation_typed_composition.py",
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)
        return (root / "bootstrap-report.json").read_text()


@pytest.fixture(scope="session", autouse=True)
def isolated_backend() -> Iterator[None]:
    # The outer collector must never import or configure the backend.
    if "GNOSI_FOUNDATION_IMPORT_FIRST" not in os.environ:
        yield
        return
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
    assert not {"OPENAI_API_KEY", "GNOSI_SHARED_ENV_FILE", "GNOSI_API_TOKEN"} & os.environ.keys()

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("External I/O is forbidden in page foundation checks")

    with pytest.MonkeyPatch.context() as guard:
        guard.setattr(requests.sessions.Session, "request", forbidden)
        guard.setattr(urllib.request, "urlopen", forbidden)
        guard.setattr(socket, "create_connection", forbidden)
        guard.setattr(socket.socket, "connect", forbidden)
        guard.setattr(subprocess, "Popen", forbidden)
        module = (
            "backend.domains.vault.pages.foundation"
            if os.environ["GNOSI_FOUNDATION_IMPORT_FIRST"] == "foundation"
            else "backend.api.vault_routes"
        )
        importlib.import_module(module)
        from backend.config.validation_runtime import validation_runtime_enabled

        assert validation_runtime_enabled()
        _write_bootstrap_report(root)
        yield


def _write_bootstrap_report(root: Path) -> None:
    from fastapi.openapi.utils import get_openapi
    from fastapi.routing import APIRoute

    from backend.api import vault_routes

    routes = [route for route in vault_routes.router.routes if isinstance(route, APIRoute)]
    report = {
        "routes": [
            {
                "path": route.path,
                "methods": sorted(route.methods or ()),
                "endpoint": f"{route.endpoint.__module__}.{route.endpoint.__qualname__}",
                "dependencies": [
                    getattr(dependency.dependency, "__qualname__", None)
                    for dependency in route.dependencies
                ],
            }
            for route in routes
        ],
        "openapi": get_openapi(title="Synthetic bootstrap", version="1", routes=routes),
    }
    (root / "bootstrap-report.json").write_text(json.dumps(report, sort_keys=True))


def check_initialization_is_idempotent_and_keeps_captured_functions() -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.api import core_routes, pages_queries
    from backend.domains.vault.assets import persistence, quarantine, table_paths
    from backend.domains.vault.pages import foundation
    from backend.domains.vault.tables import folders

    writer = foundation._PAGE_MARKDOWN_WRITER_DEPENDENCIES
    formulas = foundation._FORMULA_RECALCULATION_DEPENDENCIES
    queries = pages_queries._deps()
    owners = [persistence, quarantine, table_paths, folders]
    dependencies = [owner._deps() for owner in owners]
    routes = list(facade.router.routes)
    foundation.initialize_foundation(facade)
    foundation.initialize_foundation(facade)
    assert foundation._PAGE_MARKDOWN_WRITER_DEPENDENCIES is writer
    assert foundation._FORMULA_RECALCULATION_DEPENDENCIES is formulas
    assert pages_queries._deps() is queries
    assert all(owner._deps() is dependency for owner, dependency in zip(owners, dependencies))
    assert facade.router.routes == routes
    assert queries.parse_frontmatter is foundation.parse_frontmatter
    assert queries.enrich_single_page is foundation._enrich_single_query_page
    assert core_routes._CREATE_PAGE_DEPENDENCIES.recompute_formulas is (
        foundation._recompute_cross_record_formulas_for_table
    )
    assert facade.save_page_md is foundation.save_page_md
    assert facade.list_pages is foundation.list_pages is pages_queries.list_pages


def check_initializer_rejects_rebinding_without_mutating_owners() -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.pages import foundation

    writer = foundation._PAGE_MARKDOWN_WRITER_DEPENDENCIES
    routes = list(facade.router.routes)
    with pytest.raises(RuntimeError, match="already bound to another facade"):
        foundation.initialize_foundation(ModuleType("synthetic_other_facade"))
    assert foundation._PAGE_MARKDOWN_WRITER_DEPENDENCIES is writer
    assert facade.router.routes == routes
    foundation.initialize_foundation(facade)


def check_deferred_annotations_resolve_after_both_import_orders() -> None:
    from backend.domains.vault.pages import foundation
    from backend.domains.vault.schemas.pages import PageInfo

    assert get_type_hints(foundation.parse_frontmatter)["file_path"] == Path | None
    assert get_type_hints(foundation.save_page_md)["file_path"] is Path
    assert get_type_hints(foundation._get_pages_for_table)["return"] == list[PageInfo]
    assert get_type_hints(foundation.initialize_foundation) == {
        "legacy": ModuleType,
        "return": type(None),
    }


@pytest.mark.parametrize(
    "yaml_text", ["null", "false", "0", "''", "[]", "{}", "true", "3", "word", "[a, b]"]
)
def check_yaml_scalars_and_sequences_keep_empty_metadata(yaml_text: str) -> None:
    from backend.domains.vault.pages import foundation

    assert foundation.parse_frontmatter(f"---\n{yaml_text}\n---\nBody") == ({}, "Body")


def check_yaml_unknown_keys_values_and_alias_identity() -> None:
    from backend.domains.vault.pages import foundation

    metadata, body = foundation.parse_frontmatter(
        "---\nid: synthetic\n7: numeric key\nnull: null key\n"
        "2026-08-31: date key\nopaque: &opaque [false, 0, null, {label: Mercè}]\n"
        "alias: *opaque\n---\nBody"
    )
    assert metadata[7] == "numeric key"
    assert metadata[None] == "null key"
    assert metadata[date(2026, 8, 31)] == "date key"
    assert metadata["opaque"] == [False, 0, None, {"label": "Mercè"}]
    assert metadata["opaque"] is metadata["alias"]
    assert body == "Body"


@pytest.mark.parametrize(
    "yaml_text", ["bad: [", 'id: synthetic\ntitle: "unfinished\nflag: false\ncount: 0']
)
def check_malformed_yaml_rescue_keeps_top_level_values(yaml_text: str) -> None:
    from backend.domains.vault.pages import foundation
    from backend.services.frontmatter_fallback import parse_frontmatter_fallback

    expected = parse_frontmatter_fallback(yaml_text)
    assert foundation.parse_frontmatter(f"---\n{yaml_text}\n---\nBody") == (expected, "Body")


def check_unrecoverable_yaml_returns_original_document() -> None:
    from backend.domains.vault.pages import foundation

    content = "---\n[broken\n---\nBody"
    assert foundation.parse_frontmatter(content) == ({}, content)


@pytest.mark.parametrize("render", [False, True])
def check_parser_resolves_callbacks_in_existing_order(
    monkeypatch: pytest.MonkeyPatch,
    render: bool,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.pages import foundation

    calls: list[str] = []
    opaque = {"nested": [False, None]}
    metadata: dict[object, object] = {"id": "synthetic", 7: opaque}

    def transform(body: str) -> str:
        calls.append(body)
        return body + "!"

    def strip(value: object, keys: set[str] | None) -> object:
        calls.append("strip")
        assert value is metadata and keys == {"Related"}
        return value

    def future_strip(value: object, keys: set[str] | None) -> object:
        raise AssertionError("Callback replaced after callable evaluation was used too soon")

    def future_relations(table: object) -> set[str]:
        raise AssertionError("Relation callback replaced inside table lookup was used too soon")

    def relation_keys(table: object) -> set[str]:
        calls.append("relations")
        assert table is metadata
        monkeypatch.setattr(facade, "strip_relation_wikilinks", future_strip)
        return {"Related"}

    def table_by_id(table_id: str) -> object:
        calls.append("table")
        assert table_id == "table-synthetic"
        monkeypatch.setattr(facade, "relation_keys_from_table", future_relations)
        return metadata

    def table_id(value: object) -> str:
        calls.append("id")
        assert value is metadata
        monkeypatch.setattr(facade, "_table_by_id", table_by_id)
        return "table-synthetic"

    def sidecar(value: object, path: Path | None) -> object:
        calls.append("sidecar")
        assert value == {"title": "Original"} and path is None
        monkeypatch.setattr(facade, "get_table_id", table_id)
        return metadata

    for name in (
        "render_view_snapshots",
        "flatten_view_columns",
        "restore_view_fences",
        "strip_view_snapshots",
    ):
        monkeypatch.setattr(facade, name, transform)
    monkeypatch.setattr(facade, "apply_sidecar_to", sidecar)
    monkeypatch.setattr(facade, "relation_keys_from_table", relation_keys)
    monkeypatch.setattr(facade, "strip_relation_wikilinks", strip)
    parsed, body = foundation.parse_frontmatter(
        "---\ntitle: Original\n---\nBody", render_snapshots=render
    )
    assert parsed is metadata and parsed[7] is opaque and body == "Body!!"
    assert calls == ["Body", "Body!", "sidecar", "id", "table", "relations", "strip"]


def check_sidecar_merge_and_portable_writer_preserve_unknown_metadata(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.pages import foundation
    from backend.services import page_sidecar

    vault = tmp_path / "vault"
    (vault / ".gnosi").mkdir(parents=True)
    path = vault / "synthetic.md"
    opaque = [False, 0, None, {"label": "Mercè"}]
    metadata: dict[object, object] = {
        "id": "synthetic",
        "title": "Synthetic",
        "is_template": True,
        "title_manual": True,
        "opaque": opaque,
        7: "numeric key",
    }
    monkeypatch.setattr(facade, "get_table_id", lambda _metadata: None)
    monkeypatch.setattr(facade, "inject_view_snapshots", lambda body, **kwargs: body)
    page_sidecar.clear_vault_root_cache()
    foundation.save_page_md(path, metadata, "  Body\n")
    assert metadata["opaque"] is opaque and metadata[7] == "numeric key"
    raw = path.read_text()
    assert "is_template:" not in raw and "title_manual:" not in raw
    assert raw.endswith("\nBody\n")
    saved_sidecar = json.loads((vault / ".gnosi/page_meta/synthetic.json").read_text())
    assert saved_sidecar == {"is_template": True, "title_manual": True}
    parsed, body = foundation.parse_frontmatter(raw, path)
    assert parsed == metadata and body == "Body\n"


def check_writer_recovers_id_and_preserves_nested_values(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.pages import foundation

    path = tmp_path / "Synthetic.md"
    path.write_text("---\nid: synthetic-existing\ntitle: Existing title\n---\nOld")
    monkeypatch.setattr(facade, "get_table_id", lambda _metadata: None)
    monkeypatch.setattr(facade, "inject_view_snapshots", lambda body, **kwargs: body)
    metadata: dict[object, object] = {"opaque": [False, 0, None], 7: "key"}
    foundation.save_page_md(path, metadata, "New")
    parsed, _body = foundation.parse_frontmatter(path.read_text())
    assert parsed["id"] == "synthetic-existing"
    assert parsed["title"] == "Existing title"
    assert parsed["opaque"] == metadata["opaque"] and parsed[7] == "key"
    assert "id" not in metadata  # Existing writer deliberately creates an identity-repair copy.


@pytest.mark.parametrize("content", [None, {"widgets": [False, 0, None]}, "Plain body"])
def check_dashboard_roundtrip_content_and_unknown_values(content: object, tmp_path: Path) -> None:
    from backend.domains.vault.pages import foundation

    path = tmp_path / "Synthetic.json"
    document = {
        "id": "synthetic-dashboard",
        "title": "Synthetic dashboard",
        "parent_id": 0,
        "metadata": {"opaque": [False, 0, None], "content_format": "custom"},
        "content": content,
    }
    path.write_text(json.dumps(document))
    metadata, body = foundation._read_dashboard_file(path)
    assert metadata == {
        "id": "synthetic-dashboard",
        "title": "Synthetic dashboard",
        "parent_id": 0,
        "opaque": [False, 0, None],
        "content_format": "custom",
        "is_dashboard": True,
    }
    assert body == (
        "{}"
        if content is None
        else content
        if isinstance(content, str)
        else json.dumps(content, ensure_ascii=False, indent=2)
    )


@pytest.mark.parametrize("content", [None, False, 0, "scalar", []])
def check_dashboard_non_mapping_keeps_native_failure(content: object, tmp_path: Path) -> None:
    from backend.domains.vault.pages import foundation

    path = tmp_path / "Synthetic.json"
    path.write_text(json.dumps(content))
    with pytest.raises(AttributeError):
        foundation._read_dashboard_file(path)


def check_normalizers_preserve_dictionary_and_unknown_values() -> None:
    from backend.domains.vault.pages import foundation

    opaque = [False, None, {"label": "Mercè"}]
    metadata: dict[object, object] = {
        "Gnosi-ID": "synthetic",
        "opaque": opaque,
        7: "key",
        "cover": "Assets/cover.png",
    }
    assert foundation.normalize_metadata_ids(metadata) is metadata
    assert metadata["id"] == "synthetic" and "Gnosi-ID" not in metadata
    assert foundation._process_metadata_paths(metadata) is metadata
    assert metadata["cover"] == "/api/vault/assets/cover.png"
    assert metadata["opaque"] is opaque and metadata[7] == "key"


def check_virtual_fields_are_removed_without_mutating_original() -> None:
    from backend.domains.vault.pages import foundation

    opaque = [False, 0, None]
    metadata: dict[str, object] = {"virtual": 1, "fld_virtual": 2, "opaque": opaque}
    table = {"properties": [{"type": "virtual", "name": "virtual", "id": "fld_virtual"}]}
    assert foundation._strip_virtual_keys(metadata, None) is metadata
    result = foundation._strip_virtual_keys(metadata, table)
    assert result == {"opaque": opaque} and result["opaque"] is opaque
    assert "virtual" in metadata and "fld_virtual" in metadata


def check_relocation_preserves_collision_suffix_and_content(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.pages import foundation

    paths = {
        key: tmp_path / key for key in ("VAULT", "PLANTILLES", "CALENDAR", "WIKI", "DASHBOARDS")
    }
    for path in paths.values():
        path.mkdir()
    source = paths["WIKI"] / "Synthetic.md"
    source.write_text("Synthetic content")
    occupied = paths["PLANTILLES"] / source.name
    occupied.write_text("Existing content")
    monkeypatch.setattr(facade, "get_p", lambda key: paths[key])
    monkeypatch.setattr(facade, "is_calendar_entry", lambda metadata: False)
    moved = foundation.ensure_correct_page_location(source, {"is_template": True})
    assert moved == paths["PLANTILLES"] / "Synthetic (2).md"
    assert moved.read_text() == "Synthetic content"
    assert occupied.read_text() == "Existing content" and not source.exists()
