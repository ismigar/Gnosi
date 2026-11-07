"""Authenticated catalogue and local import for website typography."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query, Response
from backend.services.workspace_service import WorkspaceContext, require_role
from .font_catalogue import CATALOGUE, FontCatalogueEntry, FontImportRequest, catalogue_preview, import_fonts
from .models import SiteFont

router = APIRouter()
Editor = Annotated[WorkspaceContext, Depends(require_role('editor'))]


@router.get('/fonts/catalogue', response_model=list[FontCatalogueEntry])
def catalogue(context: Editor) -> list[FontCatalogueEntry]:
    return CATALOGUE


@router.get('/fonts/catalogue/preview', response_class=Response)
def preview(context: Editor, catalogue_id: Annotated[str, Query(max_length=100)]) -> Response:
    raw, media_type = catalogue_preview(catalogue_id)
    return Response(raw, media_type=media_type, headers={'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff'})


@router.post('/{site_id}/theme/fonts/import', response_model=list[SiteFont])
def import_font(site_id: str, request: FontImportRequest, context: Editor) -> list[SiteFont]:
    from .api import store_for
    return import_fonts(store_for(context), site_id, request)
