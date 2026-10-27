"""Authenticated management and one token-authorized, read-only public route."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.services.plugin_access import require_plugins
from backend.services.workspace_service import WorkspaceContext, require_role

from . import service
from .schemas import (PublicationBundle, PublicationCandidate, PublicationCommit, PublicationPreviewResponse,
                      PublicationRevoke, PublicationSelection, PublicationSummary)

public_router = APIRouter()


def dependencies(context: WorkspaceContext) -> service.PublicationDependencies:
    from backend.domains.vault.api.core_composition import vault
    from backend.domains.vault.pages.creation_recovery import recovery_access_guard
    from backend.services.vault_routing import canonical_vault_browser_path

    return service.PublicationDependencies(parse=vault.parse_frontmatter,
        validate_access=recovery_access_guard(context),
        local_prefixes=(canonical_vault_browser_path("knowledge", "page/"),))


def publication_pages(context: WorkspaceContext = Depends(require_role("editor"))) -> list[PublicationCandidate]:
    return service.candidates(context.vault_path, dependencies(context))


def list_publications(context: WorkspaceContext = Depends(require_role("editor")),
                      db: Session = Depends(get_mgmt_db)) -> list[PublicationSummary]:
    return service.list_sites(db, service.PublicationScope.from_context(context))


def preview_publication(request: PublicationSelection, context: WorkspaceContext = Depends(require_role("editor")),
                        db: Session = Depends(get_mgmt_db)) -> PublicationPreviewResponse:
    return service.preview(db, service.PublicationScope.from_context(context), context.vault_path, request, dependencies(context))


def commit_publication(request: PublicationCommit, context: WorkspaceContext = Depends(require_role("editor")),
                       db: Session = Depends(get_mgmt_db)) -> PublicationSummary:
    dependencies(context).validate_access()
    return service.commit(db, service.PublicationScope.from_context(context), request.preview_id)


def revoke_publication(site_id: Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")], request: PublicationRevoke,
                       context: WorkspaceContext = Depends(require_role("editor")),
                       db: Session = Depends(get_mgmt_db)) -> PublicationSummary:
    dependencies(context).validate_access()
    return service.revoke(db, service.PublicationScope.from_context(context), site_id, request.expected_revision)


@public_router.get("/published/{token}", response_model=PublicationBundle)
def read_publication(token: Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{43}$")], response: Response,
                     db: Session = Depends(get_mgmt_db)) -> PublicationBundle:
    response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                             "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff"})
    return service.published(db, token)


def register_routes(router: APIRouter) -> None:
    management = APIRouter(dependencies=[Depends(require_plugins("share-links"))])
    management.add_api_route("/publishing/pages", publication_pages, methods=["GET"], response_model=list[PublicationCandidate])
    management.add_api_route("/publishing", list_publications, methods=["GET"], response_model=list[PublicationSummary])
    management.add_api_route("/publishing/preview", preview_publication, methods=["POST"], response_model=PublicationPreviewResponse)
    management.add_api_route("/publishing/commit", commit_publication, methods=["POST"], response_model=PublicationSummary)
    management.add_api_route("/publishing/{site_id}/revoke", revoke_publication, methods=["POST"], response_model=PublicationSummary)
    from .web import router as web_router
    management.include_router(web_router)
    router.include_router(management)
    from backend.domains.sites.api import router as sites_router
    router.include_router(sites_router)
