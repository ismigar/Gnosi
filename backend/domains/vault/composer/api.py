"""Editor-authorized Note Composer routes with a mandatory preview contract."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from backend.domains.vault.registry.state import RegistryData
from backend.services.workspace_service import WorkspaceContext, require_role

from .schemas import ComposerApplyRequest, ComposerPreview, ComposerRequest, ComposerResult
from .service import ComposerDependencies, apply_plan, build_plan


def dependencies(context: WorkspaceContext) -> ComposerDependencies:
    from backend.domains.vault.api.core_composition import vault
    from backend.domains.vault.pages.foundation import _read_dashboard_file
    from backend.domains.vault.pages.cache import invalidate_cached_preview
    from backend.domains.vault.pages.creation_recovery import recovery_access_guard
    from backend.domains.vault.pages.index_service import refresh_page_index_entry
    from backend.services.vault_routing import canonical_vault_browser_path
    from backend.data.management_db import get_mgmt_session
    from backend.models.management import Vault
    from backend.api.collab_routes import manager
    from backend.config.app_config import load_params

    params = load_params(strict_env=False)
    project = params.paths.get("PROJECT_DIR") or Path.cwd()
    vault_ids: list[str] = []
    vault_slugs: list[str] = []
    with get_mgmt_session() as session:
        for vault_record in session.query(Vault).filter(Vault.workspace_id == context.workspace_id).all():
            if vault_record.path_override:
                candidate = Path(vault_record.path_override)
                if not candidate.is_absolute() and params.gnosi_mode != "personal":
                    candidate = project / candidate
            else:
                candidate = (params.paths.get("VAULT") or context.vault_path) if params.gnosi_mode == "personal" else project / "workspaces" / context.workspace_id / "vault"
            if candidate.resolve() == context.vault_path.resolve():
                vault_ids.append(str(vault_record.id))
                if vault_record.slug:
                    vault_slugs.append(str(vault_record.slug))

    def validate_pages(ids: list[str]) -> None:
        if any(manager.peers(page_id) or any(manager.peers(f"{vault_id}\x1f{page_id}") for vault_id in vault_ids) for page_id in ids):
            raise HTTPException(409, "Close collaborative editors for the affected notes, then use source mode to compose them")

    def dashboards() -> list[str]:
        folder = vault.get_p("DASHBOARDS")
        if not folder.resolve().is_relative_to(context.vault_path.resolve()):
            raise HTTPException(409, "Dashboard storage must remain inside the selected vault")
        paths = list(folder.rglob("*.json")) if folder.exists() else []
        if any(not path.resolve().is_relative_to(context.vault_path.resolve()) for path in paths):
            raise HTTPException(409, "Dashboard storage must remain inside the selected vault")
        return [_read_dashboard_file(path)[1] for path in paths]

    def refresh(path: Path, metadata: RegistryData, body: str) -> None:
        refresh_page_index_entry(path, metadata, body)
        vault._add_page_to_index_cache(path)
        vault.update_link_index_for_page(path)
        vault._pages_cache_invalidate_all()
        invalidate_cached_preview(str(metadata.get("id") or path.stem))

    return ComposerDependencies(
        parse=vault.parse_frontmatter, save=vault.save_page_md, refresh=refresh,
        unsupported_bodies=dashboards,
        validate_access=recovery_access_guard(context),
        validate_pages=validate_pages,
        local_prefixes=ComposerDependencies.local_prefixes + (canonical_vault_browser_path("knowledge", "page/"),)
        + tuple(f"/api/v1/vaults/{vault_id}/knowledge/pages/" for vault_id in vault_ids + vault_slugs)
        + tuple(f"/@{slug}/knowledge/page/" for slug in vault_slugs),
    )


async def preview_composer(request: ComposerRequest, context: WorkspaceContext = Depends(require_role("editor"))) -> ComposerPreview:
    return build_plan(context.vault_path, request, dependencies(context)).preview


async def apply_composer(request: ComposerApplyRequest, context: WorkspaceContext = Depends(require_role("editor"))) -> ComposerResult:
    return await apply_plan(context.vault_path, request, dependencies(context))


def register_routes(router: APIRouter) -> None:
    router.add_api_route("/composer/preview", preview_composer, methods=["POST"], response_model=ComposerPreview)
    router.add_api_route("/composer/apply", apply_composer, methods=["POST"], response_model=ComposerResult)
