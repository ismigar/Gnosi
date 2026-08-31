"""Tests for the deterministic technical-documentation generator."""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

from pipeline.skills.technical_documentation.scripts.generate import (
    RouterRegistration,
    build_api_catalog,
    build_data_model_catalog,
    collect_environment_references,
    declares_router,
    format_environment_default,
    frontend_files,
    is_owned_inventory_file,
    join_url_paths,
    load_domains,
    matches_for_globs,
    parse_route_module,
    python_files,
    safe_unparse,
)

APP_ROOT = Path(__file__).resolve().parents[4]


def test_join_url_paths_normalizes_mount_and_router_prefixes() -> None:
    """URL fragments retain parameters and exactly one separator."""
    assert join_url_paths("/api/", "/vault", "/pages/{page_id}") == "/api/vault/pages/{page_id}"
    assert join_url_paths("", "/") == "/"


def test_secret_defaults_are_always_redacted() -> None:
    """A source-written secret default never enters generated documentation."""
    value = ast.Constant(value="visible-in-source-but-still-sensitive")
    assert format_environment_default("EXAMPLE_API_KEY", value) == "redacted"
    assert format_environment_default("EXAMPLE_TIMEOUT", ast.Constant(value="30")) == "'30'"


def test_safe_unparse_normalizes_lambda_without_arguments() -> None:
    """Generated expressions remain stable across supported Python versions."""
    expression = ast.parse("lambda: value", mode="eval").body

    assert safe_unparse(expression) == "lambda: value"


def test_javascript_environment_names_are_not_truncated(tmp_path: Path) -> None:
    """Mixed-case and dollar-bearing property names retain their full spelling."""
    desktop = tmp_path / "desktop"
    desktop.mkdir()
    (desktop / "fixture.js").write_text(
        "process.env.SystemRoot;\n"
        "process.env.GNOSI_DATA_DIR;\n"
        "process.env.lowercase;\n"
        "process.env.UPPER$Suffix;\n"
        "import.meta.env.VITE_mixedCase;\n",
        encoding="utf-8",
    )
    references = collect_environment_references(tmp_path)
    assert {(item.name, item.line, item.runtime) for item in references} == {
        ("SystemRoot", 1, "Node.js"),
        ("GNOSI_DATA_DIR", 2, "Node.js"),
        ("lowercase", 3, "Node.js"),
        ("UPPER$Suffix", 4, "Node.js"),
        ("VITE_mixedCase", 5, "Vite"),
    }
    assert all(item.default == "runtime-provided" for item in references)


def test_route_module_combines_all_prefixes(tmp_path: Path) -> None:
    """Static route discovery reports effective mount paths and guards."""
    app_root = tmp_path / "gnosi"
    api_root = app_root / "backend" / "api"
    api_root.mkdir(parents=True)
    route_path = api_root / "sample_routes.py"
    route_path.write_text(
        "from fastapi import APIRouter, Depends\n"
        "router = APIRouter(prefix='/items', tags=['items'])\n"
        "@router.get('/{item_id}')\n"
        "async def get_item(item_id: str, user=Depends(current_user)):\n"
        "    '''Return one item.'''\n"
        "    return item_id\n",
        encoding="utf-8",
    )
    registration = RouterRegistration(
        module="sample_routes",
        prefix="/api",
        tags=("Sample",),
        line=10,
    )

    operations = parse_route_module(route_path, app_root, registration)

    assert len(operations) == 1
    assert operations[0].path == "/api/items/{item_id}"
    assert operations[0].method == "GET"
    assert operations[0].guards == "Depends(current_user)"
    assert operations[0].tags == ("Sample", "items")
    assert operations[0].summary == "Return one item."


def test_route_module_follows_imported_router_registrars(tmp_path: Path) -> None:
    """Injected-router registration remains visible in the API catalog."""
    app_root = tmp_path / "gnosi"
    api_root = app_root / "backend" / "api"
    domain_root = app_root / "backend" / "domains" / "items"
    api_root.mkdir(parents=True)
    domain_root.mkdir(parents=True)
    route_path = api_root / "sample_routes.py"
    route_path.write_text(
        "from fastapi import APIRouter, Depends\n"
        "from backend.domains.items import api as items_api\n"
        "router = APIRouter(prefix='/items', tags=['items'], "
        "dependencies=[Depends(workspace)])\n"
        "items_api.register_routes(router)\n",
        encoding="utf-8",
    )
    domain_path = domain_root / "api.py"
    domain_path.write_text(
        "from fastapi import Depends\n"
        "async def create_item(user=Depends(current_user)):\n"
        "    '''Create one item.'''\n"
        "    return user\n"
        "def register_routes(router):\n"
        "    router.add_api_route(\n"
        "        '/dynamic', create_item, methods=['POST'],\n"
        "        dependencies=[Depends(editor)],\n"
        "    )\n",
        encoding="utf-8",
    )
    registration = RouterRegistration(
        module="sample_routes",
        prefix="/api",
        tags=("Sample",),
        line=10,
    )

    operations = parse_route_module(route_path, app_root, registration)

    assert len(operations) == 1
    assert operations[0].path == "/api/items/dynamic"
    assert operations[0].method == "POST"
    assert operations[0].handler == "create_item"
    assert operations[0].module == "backend/domains/items/api.py"
    assert operations[0].tags == ("Sample", "items")
    assert operations[0].guards == (
        "[Depends(workspace)], [Depends(editor)], Depends(current_user)"
    )
    assert operations[0].summary == "Create one item."


def test_api_catalog_is_deterministic() -> None:
    """Repeated static inspection produces byte-identical API reference."""
    first = build_api_catalog(APP_ROOT)
    second = build_api_catalog(APP_ROOT)
    assert first == second
    assert "# API catalog" in first
    assert "`/api/health`" in first


def test_safe_unparse_normalizes_lambda_spacing() -> None:
    """AST formatting differences between Python versions cannot stale pages."""
    expression = ast.parse("lambda value: value", mode="eval").body

    assert safe_unparse(expression) == "lambda value: value"


def test_only_real_router_modules_are_classified(tmp_path: Path) -> None:
    """Auxiliary files under backend/api are not reported as unmounted routers."""
    router = tmp_path / "router.py"
    router.write_text("router = APIRouter()\n", encoding="utf-8")
    helper = tmp_path / "helper.py"
    helper.write_text("def normalize(value):\n    return value\n", encoding="utf-8")
    assert declares_router(router)
    assert not declares_router(helper)


def test_data_model_catalog_redacts_sensitive_defaults() -> None:
    """Mapped schema reference includes tables without revealing secret defaults."""
    catalog = build_data_model_catalog(APP_ROOT)
    assert "# Relational data model" in catalog
    assert "`users`" in catalog
    assert "`newsletter_account`" in catalog
    assert "redacted" in catalog


def test_data_model_catalog_supports_sqlalchemy_2_mapped_columns(tmp_path: Path) -> None:
    """Annotated ``mapped_column`` declarations retain type and nullability."""
    app_root = tmp_path / "gnosi"
    model_root = app_root / "backend" / "models"
    model_root.mkdir(parents=True)
    (model_root / "sample.py").write_text(
        "class Sample:\n"
        "    __tablename__ = 'samples'\n"
        "    legacy = Column(Integer, primary_key=True)\n"
        "    title: Mapped[str] = mapped_column(String, nullable=False)\n"
        "    note: Mapped[str | None] = mapped_column()\n",
        encoding="utf-8",
    )

    catalog = build_data_model_catalog(app_root)

    assert "Discovered **1 mapped tables** and **3 mapped columns**." in catalog
    assert "| `legacy` | `Integer` | yes | — |" in catalog
    assert "| `title` | `String` | — | no |" in catalog
    assert r"| `note` | `str \| None` | — | yes |" in catalog


def test_coverage_globs_exclude_cache_artifacts(tmp_path: Path) -> None:
    """Broad domain patterns must ignore local bytecode and cache files."""
    source = tmp_path / "extensions" / "adapter.py"
    cache = tmp_path / "extensions" / "__pycache__" / "adapter.pyc"
    source.parent.mkdir(parents=True)
    cache.parent.mkdir(parents=True)
    source.write_text("VALUE = 1\n", encoding="utf-8")
    cache.write_bytes(b"local-only bytecode")

    assert matches_for_globs(tmp_path, ["extensions/**/*"]) == [source]


def test_owned_source_discovery_excludes_suffixed_runtime_artifacts(
    tmp_path: Path,
) -> None:
    """Packaged Python runtimes and desktop builds are never owned source."""
    owned_python = tmp_path / "backend" / "service.py"
    runtime_python = tmp_path / "electron" / ".venv-python" / "test_vendor.py"
    owned_frontend = tmp_path / "electron" / "main.js"
    packaged_frontend = tmp_path / "electron" / "dist-python" / "bundle.js"
    for path in (owned_python, runtime_python, owned_frontend, packaged_frontend):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("VALUE = 1\n", encoding="utf-8")

    assert python_files(tmp_path) == [owned_python]
    assert frontend_files(tmp_path / "electron") == [owned_frontend]
    assert is_owned_inventory_file(owned_python)
    assert not is_owned_inventory_file(runtime_python)
    assert not is_owned_inventory_file(packaged_frontend)


def test_inventory_excludes_local_state_and_packaging_outputs(tmp_path: Path) -> None:
    """Local secrets, auth state, logs, and packaging output are not source."""
    owned_source = tmp_path / "integrations" / "adapter.py"
    local_files = [
        tmp_path / "backend" / "data" / "logs" / "runtime.log",
        tmp_path / "e2e" / "tests" / ".auth" / "state.json",
        tmp_path / "electron" / "python-build" / "backend.spec",
        tmp_path / "pipeline" / "private_skills" / "secrets" / "config.json",
        tmp_path / "pipeline" / "skills" / "zotero_sync" / "zotero_db_config.json",
        tmp_path / "integrations" / "libreoffice-cite" / "gnosi-cite.oxt",
    ]
    for path in [owned_source, *local_files]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("local fixture\n", encoding="utf-8")

    assert is_owned_inventory_file(owned_source)
    assert all(not is_owned_inventory_file(path) for path in local_files)


def test_local_scratch_and_private_tools_do_not_change_public_catalogs(tmp_path: Path) -> None:
    """Ignored migration helpers must not make local and clean-CI counts differ."""
    owned = tmp_path / "pipeline" / "skills" / "example" / "source.py"
    owned.parent.mkdir(parents=True)
    owned.write_text("VALUE = 1\n", encoding="utf-8")
    before = python_files(tmp_path)
    for relative in (
        "pipeline/sandbox/relocate.py",
        "pipeline/sandbox/parser.mjs",
        "pipeline/private_skills/local_only/tool.py",
        "pipeline/private_skills/local_only/SKILL.md",
        "frontend/.tmp/fixture/probe.ts",
        "frontend/.vite/cached.js",
        "pipeline/.ruff_cache/metadata.json",
    ):
        scratch = tmp_path / relative
        scratch.parent.mkdir(parents=True, exist_ok=True)
        scratch.write_text("private scratch fixture\n", encoding="utf-8")
        assert not is_owned_inventory_file(scratch)

    assert python_files(tmp_path) == before == [owned]
    assert frontend_files(tmp_path) == []
    assert matches_for_globs(tmp_path, ["pipeline/**/*", "frontend/**/*"]) == [owned]


@pytest.mark.parametrize("field,value", [
    ("id", 42), ("name", " "), ("guide", None),
    ("source_globs", "frontend/**/*"), ("test_globs", [False]),
    ("directives", {"path": "private.md"}),
])
def test_domain_fields_are_validated_before_catalog_generation(
    tmp_path: Path, field: str, value: object,
) -> None:
    """Unknown JSON values must not escape into typed catalog operations."""
    domain: dict[str, object] = {
        "id": "test", "name": "Test", "guide": "docs/test.md",
        "source_globs": ["frontend/**/*"], "test_globs": [], "directives": [],
    }
    config = tmp_path / "domains.json"
    config.write_text(json.dumps([domain]), encoding="utf-8")
    assert load_domains(config) == [domain]
    domain[field] = value
    config.write_text(json.dumps([domain]), encoding="utf-8")
    with pytest.raises(ValueError, match=f"Domain field {field}"):
        load_domains(config)
