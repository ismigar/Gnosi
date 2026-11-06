"""Administrator-only public URL import; creation never publishes a website."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import Field

from backend.services.plugin_access import require_plugins
from backend.services.workspace_service import WorkspaceContext, require_role

from . import url_import
from .models import Contract, SiteConfig


class WebsiteImportRequest(Contract):
    url: str = Field(min_length=1, max_length=8000)
    max_pages: int = Field(default=20, ge=1, le=100)


class WebsiteImportPage(Contract):
    id: str
    title: str
    path: str
    language: str


class WebsiteImportPreview(Contract):
    id: str
    url: str
    name: str
    pages: list[WebsiteImportPage]
    warnings: list[str]
    expires_at: str
    assets_count: int


class WebsiteImportCreate(Contract):
    preview_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    selected_page_ids: list[str] = Field(min_length=1, max_length=100)


router = APIRouter(dependencies=[Depends(require_plugins("web-publishing"))])
Admin = Annotated[WorkspaceContext, Depends(require_role("admin"))]


@router.post("/import/preview", response_model=WebsiteImportPreview)
def preview_url(request: WebsiteImportRequest, context: Admin) -> WebsiteImportPreview:
    from .api import store_for
    return WebsiteImportPreview.model_validate(url_import.preview(store_for(context), request.url, request.max_pages))


@router.post("/import/create", response_model=SiteConfig, status_code=201)
def create_from_url(request: WebsiteImportCreate, context: Admin) -> SiteConfig:
    from .api import store_for
    return url_import.create(store_for(context), request.preview_id, request.name, request.selected_page_ids)
