"""External share links for single vault pages (Notion-style).

A `ShareLink` row's id IS the opaque token in the public URL `/s/{token}`.
Authenticated endpoints (create/list/revoke) live under `/api/vault` and require
the `editor` role via the workspace context. The public read endpoint
`GET /api/share/{token}` is the ONLY anonymous path — it deliberately lives in
this router with NO `get_workspace_context` dependency so it can be reached
without a session, and it returns page content bounded by the link's permission.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.models.management import ShareLink
from backend.services.workspace_service import (
    WorkspaceContext,
    get_workspace_context,
    require_role,
)
from backend.services.context_vars import active_vault_path, get_active_vault_path
from backend.services.plugin_access import assert_plugins_enabled, require_plugins

log = logging.getLogger(__name__)

router = APIRouter()

_VALID_PERMISSIONS = {"view", "comment", "edit"}


def _request_vault_id(request: Request) -> Optional[str]:
    """Id of the request's active vault (header > `?vault=` > cookie), or None
    in single-vault. Saved on the link so it can be resolved later without any
    vault signal from the anonymous visitor."""
    for candidate in (
        request.headers.get("x-vault-id"),
        request.query_params.get("vault"),
        request.cookies.get("gnosi_active_vault"),
    ):
        if candidate and candidate.strip():
            return candidate.strip()
    return None


class ShareCreateRequest(BaseModel):
    permission: str = "view"  # view | comment | edit
    # Optional lifetime in days. None → never expires.
    expires_in_days: Optional[int] = None


class ShareLinkResponse(BaseModel):
    token: str
    page_id: str
    permission: str
    created_by: str | None
    created_at: str | None
    expires_at: str | None
    revoked: bool
    url: str


class ShareListResponse(BaseModel):
    shares: list[ShareLinkResponse]


class RevokedShareResponse(BaseModel):
    status: str
    token: str


class SharedPageContentResponse(BaseModel):
    id: str | None
    title: str | None
    content: str | None
    metadata: dict[str, Any]
    vault_id: str | None


class SharedPageResponse(BaseModel):
    token: str
    permission: str
    page: SharedPageContentResponse


def _serialize(link: ShareLink) -> dict[str, Any]:
    return ShareLinkResponse(
        token=cast(str, link.id),
        page_id=cast(str, link.page_id),
        permission=cast(str, link.permission),
        created_by=cast(str | None, link.created_by),
        created_at=link.created_at.isoformat() if link.created_at else None,
        expires_at=link.expires_at.isoformat() if link.expires_at else None,
        revoked=bool(link.revoked),
        url=f"/s/{link.id}",
    ).model_dump()


def _is_active(link: ShareLink) -> bool:
    if link.revoked:
        return False
    if link.expires_at:
        exp = link.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            return False
    return True


@router.post(
    "/vault/pages/{page_id}/share",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("share-links"))],
    response_model=ShareLinkResponse,
)
async def create_share_link(
    page_id: str,
    request: ShareCreateRequest,
    http_request: Request,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
) -> dict[str, Any]:
    """Creates a public share link for a page."""
    permission = (request.permission or "view").strip().lower()
    if permission not in _VALID_PERMISSIONS:
        raise HTTPException(status_code=422, detail="permission must be view|comment|edit")

    expires_at = None
    if request.expires_in_days is not None:
        if request.expires_in_days <= 0:
            raise HTTPException(status_code=422, detail="expires_in_days must be positive")
        from datetime import timedelta

        expires_at = datetime.now(timezone.utc) + timedelta(days=request.expires_in_days)

    link = ShareLink(
        page_id=page_id,
        workspace_id=getattr(context, "workspace_id", "personal"),
        vault_id=_request_vault_id(http_request),  # source vault (multi-vault)
        created_by=getattr(context, "user_id", None),
        permission=permission,
        expires_at=expires_at,
        revoked=0,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _serialize(link)


@router.get(
    "/vault/pages/{page_id}/shares",
    dependencies=[Depends(require_role("viewer")), Depends(require_plugins("share-links"))],
    response_model=ShareListResponse,
)
async def list_share_links(page_id: str, db: Session = Depends(get_mgmt_db)) -> dict[str, Any]:
    """Lists the active (non-revoked, non-expired) share links for a page."""
    rows = db.query(ShareLink).filter(ShareLink.page_id == page_id, ShareLink.revoked == 0).all()
    return ShareListResponse(
        shares=[
            ShareLinkResponse.model_validate(_serialize(row)) for row in rows if _is_active(row)
        ]
    ).model_dump()


@router.delete(
    "/vault/share/{token}",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("share-links"))],
    response_model=RevokedShareResponse,
)
async def revoke_share_link(token: str, db: Session = Depends(get_mgmt_db)) -> dict[str, Any]:
    """Revokes a share link (soft-delete: keeps the row for audit)."""
    link = db.query(ShareLink).filter(ShareLink.id == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")
    setattr(link, "revoked", 1)
    db.commit()
    return RevokedShareResponse(status="revoked", token=token).model_dump()


@router.get("/share/{token}", response_model=SharedPageResponse)
async def read_shared_page(token: str, db: Session = Depends(get_mgmt_db)) -> dict[str, Any]:
    """Anonymous read of a shared page. The ONLY unauthenticated endpoint.

    Resolves the token, enforces revoked/expiry, then returns the page's title,
    content and metadata bounded by the link's permission. Returns 404 (not 403)
    for invalid/expired tokens so we don't leak which tokens ever existed.
    """
    link = db.query(ShareLink).filter(ShareLink.id == token).first()
    if not link or not _is_active(link):
        raise HTTPException(status_code=404, detail="not found")

    # Resolves this share's vault: the link's own vault (captured when
    # it was created, multi-vault) if present and resolvable; otherwise, the Principal vault
    # (backward compat / single-vault / old links without vault_id). The visitor
    # anonymous doesn't provide any vault signal, so we remove it from the link.
    vault: Path | None = None
    link_vault_id = getattr(link, "vault_id", None)
    if link_vault_id:
        try:
            from backend.services.active_vault_middleware import _resolve_vault_path

            resolved_vault = _resolve_vault_path(link_vault_id)
            vault = Path(resolved_vault) if resolved_vault else None
        except Exception:
            vault = None
    if not vault:
        from backend.config.app_config import load_params

        configured_vault = load_params(strict_env=False).paths.get("VAULT")
        vault = Path(configured_vault) if configured_vault else None
    # Fallback to the active vault if the main one doesn't exist (incomplete config).
    # Without this, `Path(None)` raised a TypeError in the public endpoint.
    if not vault:
        vault = get_active_vault_path()
    if not vault:
        raise HTTPException(status_code=503, detail="No vault available to serve shared page")
    tok = active_vault_path.set(Path(vault))
    try:
        await assert_plugins_enabled("share-links")
        # Reuse the canonical page reader (it uses the active vault context).
        from backend.api.vault_routes import get_page

        page = await get_page(link.page_id)
    except HTTPException:
        raise
    except Exception as e:
        log.warning(f"Shared page read failed for {link.page_id}: {e}")
        raise HTTPException(status_code=404, detail="not found")
    finally:
        active_vault_path.reset(tok)

    return SharedPageResponse(
        token=token,
        permission=cast(str, link.permission),
        page=SharedPageContentResponse(
            id=page.get("id"),
            title=page.get("title"),
            content=page.get("content"),
            metadata=page.get("metadata", {}),
            # The frontend uses it to resolve assets (`?vault=`) without a cookie.
            vault_id=link_vault_id,
        ),
    ).model_dump()
