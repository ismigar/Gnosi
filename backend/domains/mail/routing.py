"""Canonical mail router registration object."""

from fastapi import APIRouter, Depends

from backend.services.workspace_service import get_workspace_context


router = APIRouter(
    prefix="/api/mail",
    tags=["mail"],
    dependencies=[Depends(get_workspace_context)],
)
