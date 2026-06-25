"""API pública de Gnosi amb autenticació per Personal Access Token (PAT).

Dues superfícies:
  - Gestió de tokens (autenticada per sessió): crear/llistar/revocar PATs.
  - API pública (autenticada per PAT via `Authorization: Bearer gnosi_pat_…`):
    ping, crear pàgines i l'endpoint del web clipper.

Els tokens es desen NOMÉS com a hash SHA-256. El text en clar es mostra una sola
vegada en crear-lo. Pensat per a integracions de tercers i el web clipper.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.models.management import ApiToken
from backend.services.workspace_service import get_workspace_context, WorkspaceContext
from backend.services.context_vars import get_active_vault_path

router = APIRouter()

TOKEN_PREFIX = "gnosi_pat_"


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def require_pat(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_mgmt_db),
) -> ApiToken:
    """Dependència: valida el PAT del header `Authorization: Bearer …`.

    Retorna l'`ApiToken` actiu i n'actualitza `last_used_at`. 401 si falta o és
    invàlid/revocat.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Falta el token (Authorization: Bearer …)")
    raw = authorization.split(" ", 1)[1].strip()
    if not raw.startswith(TOKEN_PREFIX):
        raise HTTPException(status_code=401, detail="Format de token invàlid")
    token = db.query(ApiToken).filter(
        ApiToken.token_hash == _hash_token(raw),
        ApiToken.revoked == 0,
    ).first()
    if not token:
        raise HTTPException(status_code=401, detail="Token invàlid o revocat")
    token.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return token


# ───────────────────────── Gestió de tokens (sessió) ─────────────────────────

class CreateTokenRequest(BaseModel):
    name: str
    scopes: str = "read,write"


@router.post("/tokens")
def create_token(
    body: CreateTokenRequest,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    """Crea un PAT. Retorna el token en clar UNA sola vegada (no es torna a mostrar)."""
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
    return {
        "id": tok.id,
        "name": tok.name,
        "token": raw,  # ⚠️ única vegada
        "prefix": prefix,
        "scopes": tok.scopes,
        "created_at": tok.created_at.isoformat() if tok.created_at else None,
    }


@router.get("/tokens")
def list_tokens(
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    rows = db.query(ApiToken).filter(
        ApiToken.user_id == context.user_id,
        ApiToken.revoked == 0,
    ).order_by(ApiToken.created_at.desc()).all()
    return [{
        "id": r.id,
        "name": r.name,
        "prefix": r.token_prefix,
        "scopes": r.scopes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
    } for r in rows]


@router.delete("/tokens/{token_id}")
def revoke_token(
    token_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    tok = db.query(ApiToken).filter(ApiToken.id == token_id, ApiToken.user_id == context.user_id).first()
    if not tok:
        raise HTTPException(status_code=404, detail="Token no trobat")
    tok.revoked = 1
    db.commit()
    return {"status": "revoked", "id": token_id}


# ───────────────────────── API pública (PAT) ─────────────────────────

def _sanitize_filename(title: str) -> str:
    clean = re.sub(r"[^\w\s\-.,()À-ÿ]", "", title).strip() or "Sense títol"
    return clean[:120]


def _write_vault_page(folder: str, title: str, content: str, extra_meta: dict) -> dict:
    """Escriu una pàgina .md al vault amb frontmatter mínim. Retorna {id, path}."""
    import yaml
    vault = get_active_vault_path()
    if not vault:
        raise HTTPException(status_code=503, detail="No hi ha cap vault actiu")
    page_id = str(uuid.uuid4())
    target_dir = Path(vault) / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    base = _sanitize_filename(title)
    fname = f"{base}.md"
    path = target_dir / fname
    if path.exists():
        path = target_dir / f"{base} {page_id[:8]}.md"
    meta = {"id": page_id, "title": title, **extra_meta}
    fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
    path.write_text(f"---\n{fm}\n---\n\n{content or ''}\n", encoding="utf-8")
    # Registra-la al page-index en memòria perquè aparegui a l'app de seguida
    # i sigui esborrable per id (sense esperar el rebuild de l'índex).
    try:
        from backend.api.vault_routes import register_page_in_index
        register_page_in_index(path)
    except Exception:
        pass
    return {"id": page_id, "path": str(path.relative_to(vault))}


@router.get("/public/ping")
def public_ping(token: ApiToken = Depends(require_pat)):
    """Comprovació d'autenticació per a clients de l'API pública."""
    return {"ok": True, "user_id": token.user_id, "scopes": token.scopes}


class PublicPageRequest(BaseModel):
    title: str
    content: str = ""
    folder: str = "Wiki"
    tags: Optional[list[str]] = None


@router.post("/public/pages")
def public_create_page(body: PublicPageRequest, token: ApiToken = Depends(require_pat)):
    """Crea una pàgina al vault via l'API pública (PAT)."""
    extra = {"created": datetime.now(timezone.utc).isoformat()}
    if body.tags:
        extra["tags"] = body.tags
    res = _write_vault_page(body.folder or "Wiki", body.title, body.content, extra)
    return {"status": "created", **res}


class ClipRequest(BaseModel):
    url: str
    title: Optional[str] = None
    content: str = ""          # markdown o text de la selecció
    tags: Optional[list[str]] = None


@router.post("/public/clip")
def public_clip(body: ClipRequest, token: ApiToken = Depends(require_pat)):
    """Endpoint del web clipper: desa una pàgina web (URL + selecció) al vault.

    Crea una nota a la carpeta `Clips/` amb la font enllaçada i el contingut
    capturat. Pensat per a l'extensió de navegador.
    """
    title = (body.title or body.url or "Clip").strip()[:200]
    tags = list(body.tags or [])
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
    return {"status": "clipped", **res}
