"""Frozen route and ownership contract for the PR6 assets/files extraction."""

from __future__ import annotations

import ast
import inspect

from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.assets import api as assets_api
from backend.domains.vault.assets.schemas import AssetUploadResponse
from backend.domains.vault.files import api as files_api
from backend.domains.vault.files.state import file_serving_state

RouteFingerprint = tuple[str, str, str]

EXPECTED_ROUTE_FINGERPRINT: tuple[RouteFingerprint, ...] = (
    ("POST", "/upload-cover", "upload_cover"),
    ("POST", "/upload-icon", "upload_icon"),
    ("POST", "/import-icon-url", "import_icon_from_url"),
    ("POST", "/assets/upload", "upload_asset"),
    ("GET", "/assets/{asset_path:path}", "get_asset"),
    ("GET", "/images/{image_path:path}", "serve_vault_image"),
    ("GET", "/library/{rel_path:path}", "serve_library_file"),
    ("GET", "/raw/{rel_path:path}", "serve_vault_raw_file"),
    ("GET", "/thumb/{rel_url:path}", "serve_thumb"),
    ("POST", "/local-file/register", "register_local_file"),
    (
        "GET",
        "/local-file/{token}/{filename:path}",
        "serve_local_file",
    ),
    ("GET", "/local-file/{token}", "serve_local_file"),
    ("GET", "/custom-icons", "get_custom_icons"),
    ("PUT", "/custom-icons", "save_custom_icons"),
    ("POST", "/upload-property-file", "upload_property_file"),
    ("POST", "/link-existing-file", "link_existing_file"),
    ("POST", "/delete-physical-file", "delete_physical_file"),
)

TARGET_HANDLER_NAMES = frozenset(
    handler_name for _method, _path, handler_name in EXPECTED_ROUTE_FINGERPRINT
)
PROTECTED_ROUTES = frozenset(
    {
        ("POST", "/upload-cover"),
        ("POST", "/upload-icon"),
        ("POST", "/import-icon-url"),
        ("POST", "/assets/upload"),
        ("POST", "/local-file/register"),
        ("PUT", "/custom-icons"),
        ("POST", "/upload-property-file"),
        ("POST", "/link-existing-file"),
        ("POST", "/delete-physical-file"),
    }
)


def _route_fingerprint() -> tuple[RouteFingerprint, ...]:
    fingerprint: list[RouteFingerprint] = []
    for route in vault_routes.router.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.endpoint.__name__ not in TARGET_HANDLER_NAMES:
            continue
        fingerprint.extend(
            (method, route.path, route.endpoint.__name__) for method in sorted(route.methods)
        )
    return tuple(fingerprint)


def test_assets_files_route_fingerprint_is_unchanged() -> None:
    assert _route_fingerprint() == EXPECTED_ROUTE_FINGERPRINT


def test_assets_files_status_and_dependency_contract_is_unchanged() -> None:
    routes = [
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in TARGET_HANDLER_NAMES
    ]
    assert len(routes) == len(EXPECTED_ROUTE_FINGERPRINT)
    for route in routes:
        assert route.status_code is None
        assert len(route.methods) == 1
        method = next(iter(route.methods))
        expected_dependency_count = 2 if (method, route.path) in PROTECTED_ROUTES else 1
        assert len(route.dependencies) == expected_dependency_count
        assert route.dependencies[0].dependency is vault_routes.get_workspace_context


def test_assets_files_handlers_are_canonical_domain_exports() -> None:
    asset_handlers = {
        "upload_cover",
        "upload_icon",
        "import_icon_from_url",
        "upload_asset",
        "get_asset",
        "serve_vault_image",
        "get_custom_icons",
        "save_custom_icons",
    }
    for name in TARGET_HANDLER_NAMES:
        expected_module = assets_api if name in asset_handlers else files_api
        assert getattr(vault_routes, name) is getattr(expected_module, name)


def test_asset_upload_exposes_its_typed_response_contract() -> None:
    route = next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == "upload_asset"
    )
    assert route.response_model is AssetUploadResponse


def test_legacy_facade_does_not_define_target_handlers() -> None:
    tree = ast.parse(inspect.getsource(vault_routes))
    defined = {
        node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert defined.isdisjoint(TARGET_HANDLER_NAMES)


def test_mutable_file_state_has_one_owner() -> None:
    assert vault_routes._VAULT_IMAGE_SEMAPHORE is file_serving_state.semaphore
    assert vault_routes._LOCAL_LINKS_LOCK is vault_routes._LOCAL_LINK_STORE.lock
    assert vault_routes._custom_icons_lock is vault_routes._CUSTOM_ICON_STORE.lock


def test_domains_do_not_import_the_legacy_facade() -> None:
    for module in (assets_api, files_api):
        source = inspect.getsource(module)
        assert "backend.api.vault_routes" not in source
