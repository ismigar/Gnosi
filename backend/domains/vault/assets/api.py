"""HTTP adapters and route registration for vault assets."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.params import Depends as DependsParameter
from fastapi.responses import FileResponse

from backend.domains.vault.assets import service
from backend.domains.vault.assets.schemas import CustomIconsRequest, IconUrlImportRequest
from backend.domains.vault.assets.state import CustomIconStore


@dataclass(frozen=True)
class AssetApiDependencies:
    """Asset services composed by the legacy vault router."""

    service: service.AssetDependencies
    custom_icons: CustomIconStore
    materialize: Callable[[Path, str], Awaitable[None]]
    serve_contained: Callable[[Path, str], Awaitable[FileResponse]]
    serve_image: Callable[[Path, str], Awaitable[FileResponse]]


_dependencies: AssetApiDependencies | None = None


def configure(dependencies: AssetApiDependencies) -> None:
    """Configure the asset adapter once from the composition facade."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Vault asset API is already configured")
    _dependencies = dependencies


def _deps() -> AssetApiDependencies:
    if _dependencies is None:
        raise RuntimeError("Vault asset API has not been configured")
    return _dependencies


def _maybe_create_icon_thumbnail(icon_path: Path, digest: str) -> str | None:
    """Compatibility callback with the historical two-argument signature."""
    return service.maybe_create_icon_thumbnail(icon_path, digest, _deps().service)


def get_custom_icons_path() -> Path:
    return _deps().custom_icons.path()


def _load_custom_icons() -> list[str]:
    return _deps().custom_icons.load()


def _save_custom_icons(values: Sequence[str]) -> list[str]:
    try:
        return _deps().custom_icons.save(values)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not save custom icons: {exc}",
        ) from exc


def _is_image_upload(file: UploadFile) -> bool:
    return service.is_image_upload(file)


def _upload_image_to_assets_subdir(file: UploadFile, subdir: str) -> dict[str, str]:
    return service.upload_image_to_assets_subdir(file, subdir, _deps().service)


def _normalize_icon_extension(filename: str, content_type: str) -> str:
    return service.normalize_icon_extension(filename, content_type)


def _store_icon_bytes(
    payload: bytes,
    source_name: str,
    content_type: str,
) -> dict[str, str | None]:
    return service.store_icon_bytes(
        payload,
        source_name,
        content_type,
        _deps().service,
    )


async def upload_cover(file: UploadFile = File(...)) -> dict[str, str]:
    """Uploads an image to the Assets/Covers folder and returns the URL."""
    return await service.upload_cover(file, _deps().service)


async def upload_icon(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> dict[str, str | None]:
    """Uploads an image to the Assets/Icons folder and returns the URL."""
    return await service.upload_icon(
        background_tasks,
        file,
        _deps().service,
        _maybe_create_icon_thumbnail,
    )


async def import_icon_from_url(
    request: IconUrlImportRequest,
) -> dict[str, str | None]:
    """Downloads an external icon URL and stores it in Assets/Icons."""
    return await service.import_icon_from_url(request.url, _deps().service)


async def upload_asset(
    file: UploadFile = File(...),
    table_id: str | None = Query(None),
    target_name: str | None = Query(None),
) -> dict[str, object]:
    """Uploads an image or PDF to Assets/Inline or Assets/Files and returns the URL.
    If table_id is given, saves to Assets/<DB>/<Table>/Inline/ or .../Files/.
    `target_name` (optional): already-interpolated base name (e.g. "{title} {index}")
    to rename the file on disk with; if missing, the original name is used.

    """
    return await service.upload_asset(
        file,
        table_id,
        target_name,
        _deps().service,
    )


async def get_asset(asset_path: str) -> FileResponse:
    """Serves files from the Vault Assets directory.

    Delegates to `_serve_file_with_containment` to inherit the OneDrive
    warmup pattern — without this, online-only files under `Assets/` (e.g. the
    custom icons in `Assets/Icons/`) were served with HTTP 200 and a 0-byte
    body the first time they were requested, and the `<img>` tags were left
    broken on the frontend.

    """
    assets_path = _deps().service.get_path("ASSETS")
    if not assets_path:
        raise HTTPException(status_code=500, detail="Assets path is not configured")
    return await _deps().serve_contained(assets_path, asset_path)


async def serve_vault_image(image_path: str) -> FileResponse:
    """Serves images directly from VAULT/Images."""
    return await _deps().serve_image(_deps().service.get_path("VAULT"), image_path)


async def get_custom_icons() -> dict[str, object]:
    """Returns the shared custom icon library for Vault icon picker."""
    icons_path = _deps().custom_icons.path()
    if icons_path:
        await _deps().materialize(icons_path, "custom-icons")
    return {"icons": _deps().custom_icons.load()}


async def save_custom_icons(request: CustomIconsRequest) -> dict[str, object]:
    """Persists the shared custom icon library for Vault icon picker."""
    try:
        saved = _deps().custom_icons.save(request.icons)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not save custom icons: {exc}",
        ) from exc
    return {"icons": saved}


def register_primary_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
) -> None:
    """Register the pre-media asset routes at their historical position."""
    protected = list(editor_dependencies)
    router.add_api_route(
        "/upload-cover",
        upload_cover,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )
    router.add_api_route(
        "/upload-icon",
        upload_icon,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )
    router.add_api_route(
        "/import-icon-url",
        import_icon_from_url,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )
    router.add_api_route(
        "/assets/upload",
        upload_asset,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )
    router.add_api_route(
        "/assets/{asset_path:path}",
        get_asset,
        methods=["GET"],
        response_model=None,
    )


def register_image_route(router: APIRouter) -> None:
    """Register image serving immediately after the untouched media routes."""
    router.add_api_route(
        "/images/{image_path:path}",
        serve_vault_image,
        methods=["GET"],
        response_model=None,
    )


def register_custom_icon_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
) -> None:
    """Register custom-icon routes after local-file serving."""
    router.add_api_route(
        "/custom-icons",
        get_custom_icons,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/custom-icons",
        save_custom_icons,
        methods=["PUT"],
        dependencies=list(editor_dependencies),
        response_model=None,
    )


__all__ = [
    "AssetApiDependencies",
    "_is_image_upload",
    "_load_custom_icons",
    "_maybe_create_icon_thumbnail",
    "_normalize_icon_extension",
    "_save_custom_icons",
    "_store_icon_bytes",
    "_upload_image_to_assets_subdir",
    "configure",
    "get_asset",
    "get_custom_icons",
    "get_custom_icons_path",
    "import_icon_from_url",
    "register_custom_icon_routes",
    "register_image_route",
    "register_primary_routes",
    "save_custom_icons",
    "serve_vault_image",
    "upload_asset",
    "upload_cover",
    "upload_icon",
]
