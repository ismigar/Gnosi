"""Authenticated website editor and private administrator operations."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from backend.services.plugin_access import require_plugins
from backend.services.workspace_service import WorkspaceContext, require_role

from . import exporter, private_service, publication, runtime
from .models import (
    CatalogueItem, ConnectionStatus, LocalServeResponse, PrivateServiceRequest, PrivateServiceResponse,
    ServiceSettings, ServiceSettingsResponse, SiteBlock, SiteConfig, SiteCreate, SiteJob, SitePage,
    SitePreview, SitePreviewRequest, SitePublishRequest, SiteRelease, SiteSource, SiteStatus, SiteTarget,
    SiteTheme, TargetConnection,
)
from .storage import SiteStore


router = APIRouter(prefix="/sites", tags=["sites"], dependencies=[Depends(require_plugins("web-publishing"))])
Editor = Annotated[WorkspaceContext, Depends(require_role("editor"))]
Admin = Annotated[WorkspaceContext, Depends(require_role("admin"))]


def store_for(context: WorkspaceContext) -> SiteStore:
    from backend.domains.vault.publishing.api import dependencies
    dependencies(context).validate_access()
    return SiteStore(context)


@router.get("", response_model=list[SiteConfig])
def list_sites(context: Editor) -> list[SiteConfig]:
    return store_for(context).list()


@router.post("", response_model=SiteConfig, status_code=201)
def create_site(request: SiteCreate, context: Admin) -> SiteConfig:
    store = store_for(context)
    site = SiteConfig(name=request.name)
    site.targets[0].enabled = True
    site.pages = [SitePage(title=request.name, path="/ca", enabled=True, template="home", blocks=[SiteBlock(type="text", title=request.name)])]
    if request.import_pilot:
        driver = Path(os.environ.get("GNOSI_WEB_PUBLISH_DRIVER", ""))
        if not driver.is_absolute() or not driver.is_file():
            raise HTTPException(409, "Configure the existing pilot publisher before importing it")
        if any(existing.legacy_pilot for existing in store.list()):
            raise HTTPException(409, "The existing pilot has already been imported")
        site.legacy_pilot = True
        site.origin = "https://temenosismael.org"
        site.targets.append(SiteTarget(id="pangea-staging", name="Pangea", environment="staging", adapter="legacy-pangea", base_url="https://temenosismael.org/_gnosi-proves/webs/" + site.id + "/current", enabled=True))
        from .importer import seed_import
        seed_import(store, site, driver.parent.parent)
    return store.save(site, create=True)


@router.get("/catalogue", response_model=list[CatalogueItem])
def catalogue(context: Editor) -> list[CatalogueItem]:
    return exporter.catalogue(store_for(context))


@router.get("/{site_id}", response_model=SiteStatus)
def site_status(site_id: str, context: Editor) -> SiteStatus:
    store = store_for(context)
    site = store.load(site_id)
    return SiteStatus(site=site, jobs=publication.jobs(store, site_id), releases=publication.releases(store, site_id), service_available=private_service.SERVICE_ROOT.joinpath("cli.php").is_file())


@router.put("/{site_id}", response_model=SiteConfig)
def save_site(site_id: str, request: SiteConfig, context: Editor) -> SiteConfig:
    store = store_for(context)
    if request.id != site_id:
        raise HTTPException(422, "The website identity cannot change")
    current = store.load(site_id)
    if context.role not in {"owner", "admin"} and request.targets != current.targets:
        raise HTTPException(403, "Only administrators can change website destinations")
    old_forms = {form.id: form for form in current.forms}
    for form in request.forms:
        old = old_forms.get(form.id)
        if old and form.model_dump(exclude={"revision"}) != old.model_dump(exclude={"revision"}):
            form.revision = old.revision + 1
        elif old:
            form.revision = old.revision
    return store.save(request)


@router.post("/{site_id}/preview", response_model=SitePreview)
def preview(site_id: str, request: SitePreviewRequest, context: Editor) -> SitePreview:
    store = store_for(context)
    return publication.preview(store, store.load(site_id), request.target_id)


@router.post("/{site_id}/publish", response_model=SiteJob, status_code=202)
def publish(site_id: str, request: SitePublishRequest, context: Editor) -> SiteJob:
    store = store_for(context)
    return publication.enqueue(store, store.load(site_id), request)


@router.get("/{site_id}/jobs", response_model=list[SiteJob])
def jobs(site_id: str, context: Editor) -> list[SiteJob]:
    store = store_for(context)
    store.load(site_id)
    return publication.jobs(store, site_id)


@router.post("/{site_id}/jobs/{job_id}/cancel", response_model=SiteJob)
def cancel(site_id: str, job_id: str, context: Editor) -> SiteJob:
    store = store_for(context)
    store.load(site_id)
    return publication.cancel(store, site_id, job_id)


@router.post("/{site_id}/rollback/{release_id}", response_model=SiteRelease)
def rollback(site_id: str, release_id: str, context: Editor) -> SiteRelease:
    store = store_for(context)
    return publication.rollback(store, store.load(site_id), release_id)


@router.get("/{site_id}/theme/export", response_model=SiteTheme)
def export_theme(site_id: str, context: Editor) -> SiteTheme:
    return store_for(context).load(site_id).theme


@router.post("/{site_id}/theme/import", response_model=SiteConfig)
def import_theme(site_id: str, request: SiteTheme, context: Editor) -> SiteConfig:
    store = store_for(context)
    site = store.load(site_id)
    site.theme = request
    return store.save(site)


@router.get("/{site_id}/theme/font", response_class=Response, responses={200: {"content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}})
def font_preview(site_id: str, source: str, context: Editor) -> Response:
    from .fonts import preview_font
    store = store_for(context)
    raw, media_type = preview_font(store, store.load(site_id), source)
    return Response(raw, media_type=media_type, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/{site_id}/theme/history", response_model=list[SiteTheme])
def theme_history(site_id: str, context: Editor) -> list[SiteTheme]:
    return store_for(context).themes(site_id)


@router.get("/{site_id}/service-settings", response_model=ServiceSettingsResponse)
def service_settings(site_id: str, context: Admin, target_id: str = "local") -> ServiceSettingsResponse:
    return private_service.settings_response(store_for(context), site_id, target_id)


@router.put("/{site_id}/service-settings", response_model=ServiceSettingsResponse)
def save_service_settings(site_id: str, request: ServiceSettings, context: Admin, target_id: str = "local") -> ServiceSettingsResponse:
    return private_service.save_settings(store_for(context), site_id, request, target_id)


@router.post("/{site_id}/service", response_model=PrivateServiceResponse)
def private_operation(site_id: str, request: PrivateServiceRequest, context: Admin) -> PrivateServiceResponse:
    store = store_for(context)
    result = private_service.invoke(store, store.load(site_id), request.action, request.request, request.target_id)
    return PrivateServiceResponse(data=result)


@router.get("/{site_id}/targets/{target_id}/connection", response_model=TargetConnection)
def connection(site_id: str, target_id: str, context: Admin) -> TargetConnection:
    return runtime.connection(store_for(context), site_id, target_id)


@router.put("/{site_id}/targets/{target_id}/connection", response_model=TargetConnection)
def save_connection(site_id: str, target_id: str, request: TargetConnection, context: Admin) -> TargetConnection:
    return runtime.save_connection(store_for(context), site_id, target_id, request)


@router.post("/{site_id}/targets/{target_id}/probe", response_model=ConnectionStatus)
def probe(site_id: str, target_id: str, context: Admin) -> ConnectionStatus:
    store = store_for(context)
    return runtime.probe(store, store.load(site_id), target_id)


@router.post("/{site_id}/targets/{target_id}/serve", response_model=LocalServeResponse)
def serve(site_id: str, target_id: str, context: Admin) -> LocalServeResponse:
    store = store_for(context)
    site = store.load(site_id)
    target = next((target for target in site.targets if target.id == target_id), None)
    if not target or target.adapter != "local" or target.environment != "local":
        raise HTTPException(409, "Select a local website destination")
    active = store.site_dir(site_id) / "active" / target_id
    if runtime.active_release(store, site, target) is None:
        raise HTTPException(409, "Publish a local version before starting the server")
    return LocalServeResponse(url=runtime.start_server(store, site, target_id, active), running=True)


@router.get("/{site_id}/targets/{target_id}/serve", response_model=LocalServeResponse)
def server_status(site_id: str, target_id: str, context: Admin) -> LocalServeResponse:
    store = store_for(context)
    return runtime.server_status(store, store.load(site_id), target_id)


@router.post("/{site_id}/targets/{target_id}/stop", response_model=LocalServeResponse)
def stop_server(site_id: str, target_id: str, context: Admin) -> LocalServeResponse:
    store = store_for(context)
    return runtime.stop_server(store, store.load(site_id), target_id)
