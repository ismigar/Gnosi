"""Gnosi's public API with Personal Access Token (PAT) authentication.

Two surfaces:
  - Token management (session-authenticated): create/list/revoke PATs.
  - Public API (PAT-authenticated via `Authorization: Bearer gnosi_pat_…`):
    ping, create pages, and the web clipper endpoint.

Tokens are stored ONLY as a SHA-256 hash. The plaintext is shown only once
when created. Designed for third-party integrations and the web clipper.
"""

from __future__ import annotations

import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, cast

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_db
from backend.models.management import ApiToken
from backend.services import web_clipper
from backend.services.workspace_service import get_workspace_context, WorkspaceContext
from backend.services.context_vars import get_active_vault_path
from backend.utils.safe_io import sanitize_vault_title, sanitize_rel_folder

logger = get_logger(__name__)

router = APIRouter()

# Re-exported for the token-management endpoints below; the canonical
# definitions live in auth_service so that this router and the identity
# resolution in `get_current_user_id` cannot disagree about what a PAT is or how
# it is hashed.
from backend.services.auth_service import TOKEN_PREFIX, hash_token as _hash_token  # noqa: E402


def require_pat(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_mgmt_db),
) -> ApiToken:
    """Dependency: validates the PAT from the `Authorization: Bearer …` header.

    Returns the active `ApiToken` and updates its `last_used_at`. 401 if it's missing or
    invalid/revoked.

    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing token (Authorization: Bearer …)")
    raw = authorization.split(" ", 1)[1].strip()
    if not raw.startswith(TOKEN_PREFIX):
        raise HTTPException(status_code=401, detail="Invalid token format")
    token = (
        db.query(ApiToken)
        .filter(
            ApiToken.token_hash == _hash_token(raw),
            ApiToken.revoked == 0,
        )
        .first()
    )
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or revoked token")
    setattr(token, "last_used_at", datetime.now(timezone.utc))
    db.commit()
    return token


def _token_scopes(token: ApiToken) -> set[str]:
    return {s.strip() for s in (token.scopes or "").split(",") if s.strip()}


def require_pat_write(token: ApiToken = Depends(require_pat)) -> ApiToken:
    """PAT dependency that additionally enforces the `write` scope.

    Scopes were stored and displayed but never checked, so a "read"-only token
    could still create/modify vault pages. Enforce least privilege on writes.
    """
    if "write" not in _token_scopes(token):
        raise HTTPException(status_code=403, detail="Token lacks the 'write' scope")
    return token


# ───────────────────────── Token management (session) ─────────────────────────


class CreateTokenRequest(BaseModel):
    name: str
    scopes: str = "read,write"


class CreatedTokenResponse(BaseModel):
    id: str
    name: str
    token: str
    prefix: str
    scopes: str
    created_at: str | None


class TokenSummaryResponse(BaseModel):
    id: str
    name: str
    prefix: str
    scopes: str
    created_at: str | None
    last_used_at: str | None


class RevokedTokenResponse(BaseModel):
    status: str
    id: str


class PublicPingResponse(BaseModel):
    ok: bool
    user_id: str
    scopes: str


class CreatedPublicPageResponse(BaseModel):
    status: str
    id: str
    path: str


class ClipTableResponse(BaseModel):
    id: str
    name: str


class ClipFieldResponse(BaseModel):
    id: str
    name: str
    type: str
    options: list[str] | None = None


class ClipConfigResponse(BaseModel):
    enabled: bool
    table: ClipTableResponse | None
    fields: list[ClipFieldResponse]


class PublicClipResponse(BaseModel):
    status: str
    id: str | None
    path: str
    table: str | None = None


@router.post("/tokens", response_model=CreatedTokenResponse)
def create_token(
    body: CreateTokenRequest,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
) -> dict[str, Any]:
    """Creates a PAT. Returns the plaintext token ONCE (it won't be shown again)."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    prefix = raw[: len(TOKEN_PREFIX) + 4]
    tok = ApiToken(
        id=str(uuid.uuid4()),
        user_id=context.user_id,
        workspace_id=context.workspace_id,
        name=(body.name or "Token").strip()[:120],
        token_hash=_hash_token(raw),
        token_prefix=prefix,
        scopes=body.scopes or "read,write",
    )
    db.add(tok)
    db.commit()
    return CreatedTokenResponse(
        id=cast(str, tok.id),
        name=cast(str, tok.name),
        token=raw,  # ⚠️ only once
        prefix=prefix,
        scopes=cast(str, tok.scopes),
        created_at=tok.created_at.isoformat() if tok.created_at else None,
    ).model_dump()


@router.get("/tokens", response_model=list[TokenSummaryResponse])
def list_tokens(
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
) -> list[dict[str, Any]]:
    rows = (
        db.query(ApiToken)
        .filter(
            ApiToken.user_id == context.user_id,
            ApiToken.revoked == 0,
        )
        .order_by(ApiToken.created_at.desc())
        .all()
    )
    return [
        TokenSummaryResponse(
            id=cast(str, row.id),
            name=cast(str, row.name),
            prefix=cast(str, row.token_prefix),
            scopes=cast(str, row.scopes),
            created_at=row.created_at.isoformat() if row.created_at else None,
            last_used_at=row.last_used_at.isoformat() if row.last_used_at else None,
        ).model_dump()
        for row in rows
    ]


@router.delete("/tokens/{token_id}", response_model=RevokedTokenResponse)
def revoke_token(
    token_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
) -> dict[str, Any]:
    tok = (
        db.query(ApiToken)
        .filter(ApiToken.id == token_id, ApiToken.user_id == context.user_id)
        .first()
    )
    if not tok:
        raise HTTPException(status_code=404, detail="Token no trobat")
    setattr(tok, "revoked", 1)
    db.commit()
    return RevokedTokenResponse(status="revoked", id=token_id).model_dump()


# ───────────────────────── Public API (PAT) ─────────────────────────


def _sanitize_filename(title: str) -> str:
    return sanitize_vault_title(title)


def _write_vault_page(
    folder: str,
    title: str,
    content: str,
    extra_meta: dict[str, Any],
) -> dict[str, str]:
    """Writes a .md page to the vault with minimal frontmatter. Returns {id, path}."""
    import yaml

    vault = get_active_vault_path()
    if not vault:
        raise HTTPException(status_code=503, detail="No active vault")
    # Contain `folder` to the vault: sanitize the relative path and verify the
    # resolved target stays inside the vault root (a PAT holder must not write
    # `.md` files anywhere on disk via `folder="../../.."`).
    vault = Path(vault).resolve()
    target_dir = (vault / sanitize_rel_folder(folder)).resolve()
    if target_dir != vault and not target_dir.is_relative_to(vault):
        raise HTTPException(status_code=400, detail="Invalid folder")
    page_id = str(uuid.uuid4())
    target_dir.mkdir(parents=True, exist_ok=True)
    base = _sanitize_filename(title)
    fname = f"{base}.md"
    path = target_dir / fname
    if path.exists():
        path = target_dir / f"{base} {page_id[:8]}.md"
    meta = {"id": page_id, "title": title, **extra_meta}
    fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
    path.write_text(f"---\n{fm}\n---\n\n{content or ''}\n", encoding="utf-8")
    # Register it in the in-memory page-index so it shows up in the app right away
    # and can be deleted by id (without waiting for the index rebuild).
    try:
        from backend.api.vault_routes import register_page_in_index

        register_page_in_index(path)
    except Exception:
        pass
    return {"id": page_id, "path": str(path.relative_to(vault))}


@router.get("/public/ping", response_model=None)
def public_ping(token: ApiToken = Depends(require_pat)) -> dict[str, Any]:
    """Authentication check for public API clients."""
    return PublicPingResponse(
        ok=True,
        user_id=cast(str, token.user_id),
        scopes=cast(str, token.scopes),
    ).model_dump()


class PublicPageRequest(BaseModel):
    title: str
    content: str = ""
    folder: str = "Wiki"
    tags: Optional[list[str]] = None


@router.post("/public/pages", response_model=None)
def public_create_page(
    body: PublicPageRequest,
    token: ApiToken = Depends(require_pat_write),
) -> dict[str, Any]:
    """Creates a page in the vault via the public API (PAT)."""
    extra: dict[str, Any] = {"created": datetime.now(timezone.utc).isoformat()}
    if body.tags:
        extra["tags"] = body.tags
    res = _write_vault_page(body.folder or "Wiki", body.title, body.content, extra)
    return CreatedPublicPageResponse(status="created", **res).model_dump()


class ClipRequest(BaseModel):
    url: str
    title: Optional[str] = None
    content: str = ""  # markdown or text of the selection
    tags: Optional[list[str]] = None
    # Values for the destination table's columns, keyed by property id (or
    # name). Ignored when the clipper is not pointed at a table.
    fields: Optional[dict[str, Any]] = None


def _clipper_state() -> tuple[bool, dict[str, Any]]:
    """(enabled, settings) of the `web-clipper` plugin from `.gnosi/plugins.json`.

    An unreadable state uses the core-only fallback so external writes never
    resume without explicit activation.
    """
    try:
        from backend.api.vault_routes import _load_plugins_state

        state = _load_plugins_state()
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not read the plugin state for the clipper: %s", e)
        return False, {}
    from backend.services import builtin_plugins

    cfg = (state.get("settings") or {}).get(web_clipper.PLUGIN_ID)
    return builtin_plugins.is_enabled(state, web_clipper.PLUGIN_ID), (
        cfg if isinstance(cfg, dict) else {}
    )


def _clipper_target(
    cfg: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """(table, registry) configured as the clip destination, or (None, None)."""
    table_id = str((cfg or {}).get("table_id") or "").strip()
    if not table_id:
        return None, None
    from backend.api.vault_routes import load_registry

    registry = cast(dict[str, Any], load_registry() or {})
    table = next(
        (t for t in (registry.get("tables") or []) if str(t.get("id")) == table_id),
        None,
    )
    return table, (registry if table else None)


@router.get("/public/clip/config", response_model=None)
def public_clip_config(
    token: ApiToken = Depends(require_pat),
    context: WorkspaceContext = Depends(get_workspace_context),
) -> dict[str, Any]:
    """Destination and form schema for the browser extension.

    The extension calls this on open so its form mirrors whatever the user
    configured in Gnosi (Settings → Connections → Web Clipper) without shipping a
    hardcoded copy of the vault's schema.
    """
    enabled, cfg = _clipper_state()
    if not enabled:
        return ClipConfigResponse(enabled=False, table=None, fields=[]).model_dump()
    table, registry = _clipper_target(cfg)
    if not table:
        return ClipConfigResponse(enabled=True, table=None, fields=[]).model_dump()
    return ClipConfigResponse(
        enabled=True,
        table=ClipTableResponse(
            id=str(table.get("id") or ""),
            name=str(table.get("name") or table.get("id") or ""),
        ),
        fields=[
            ClipFieldResponse.model_validate(field)
            for field in web_clipper.form_fields(
                table, cfg, (registry or {}).get("option_catalogs")
            )
        ],
    ).model_dump(exclude_unset=True)


@router.post("/public/clip", response_model=None)
async def public_clip(
    body: ClipRequest,
    background_tasks: BackgroundTasks,
    token: ApiToken = Depends(require_pat_write),
    context: WorkspaceContext = Depends(get_workspace_context),
) -> dict[str, Any]:
    """Web clipper endpoint: saves a web page (URL + selection) to the vault.

    Destination depends on the `web-clipper` plugin settings: a record in the
    configured table (with its columns filled from `fields`), or — when no table
    is designated — the classic note in the `Clips/` folder.

    """
    enabled, cfg = _clipper_state()
    if not enabled:
        raise HTTPException(
            status_code=403,
            detail="The Web Clipper plugin is disabled in Gnosi",
        )
    title = (body.title or body.url or "Clip").strip()[:200]
    tags = list(body.tags or [])

    table, _registry = _clipper_target(cfg)
    if table:
        metadata, page_body = web_clipper.build_record(
            table,
            cfg,
            url=body.url,
            content=body.content or "",
            tags=tags,
            fields=body.fields or {},
        )
        # Reuse the app's own creation pipeline (automations, formulas, option
        # defaults, folder resolution, page index) instead of writing the file
        # here: a clipped record must be indistinguishable from one created in
        # the UI.
        from backend.api.vault_routes import PageSaveRequest, create_page

        res = await create_page(
            PageSaveRequest(title=title, content=page_body, metadata=metadata),
            background_tasks,
            context,
        )
        return PublicClipResponse(
            status="clipped",
            id=res.get("id"),
            path=res.get("folder") or table.get("name") or "",
            table=table.get("name") or table.get("id"),
        ).model_dump(exclude_unset=True)

    if "clipped" not in tags:
        tags.append("clipped")
    body_md = f"[Font]({body.url})\n\n{body.content or ''}"
    extra = {
        "url": body.url,
        "tags": tags,
        "note_type": "clip",
        "created": datetime.now(timezone.utc).isoformat(),
    }
    res = _write_vault_page("Clips", title, body_md, extra)
    return PublicClipResponse(status="clipped", **res).model_dump(exclude_unset=True)
