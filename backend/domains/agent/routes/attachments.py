import hashlib
import logging
import time
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi import Depends, File, Form, HTTPException, UploadFile

from backend.domains.agent.routes.contracts import (
    ATTACHMENT_EXTRACTION_SECONDS,
    ATTACHMENT_MAX_AGE_SECONDS,
    CHAT_ATTACHMENT_TYPES,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_CONTEXT,
    MAX_ATTACHMENT_TEXT,
    MAX_PDF_PAGES,
    AttachmentDeleteRequest,
    AttachmentRef,
)
from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.shared import _validated_identifier, _vault_scope
from backend.services.workspace_service import WorkspaceContext, require_role

log = logging.getLogger(__name__)


def _attachment_scope_key(
    vault_scope: str,
    workspace_id: str,
    user_id: str,
    agent_id: str,
    session_id: str,
) -> str:
    payload = ":".join(
        (vault_scope, workspace_id, user_id, agent_id, session_id),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _attachment_root(vault: Path, scope_key: Optional[str] = None) -> Path:
    root = (vault / ".gnosi" / "chat-attachments").resolve()
    if scope_key:
        root = (root / scope_key).resolve()
    if root != vault and vault not in root.parents:
        raise HTTPException(status_code=400, detail="Invalid attachment directory")
    return root


def _attachment_target(vault: Path, relative_path: str, scope_key: str) -> Path:
    root = _attachment_root(vault, scope_key)
    relative = Path(relative_path)
    target = (vault / relative).resolve()
    if target == vault or vault not in target.parents or root not in target.parents:
        raise HTTPException(status_code=422, detail="Invalid attachment path")
    return target


def _delete_attachment(vault: Path, relative_path: str, scope_key: str) -> None:
    target = _attachment_target(vault, relative_path, scope_key)
    if target.is_file():
        target.unlink(missing_ok=True)


def _cleanup_expired_attachments(vault: Path, scope_key: str) -> None:
    """Remove expired uploads only within the authenticated request scope."""
    root = _attachment_root(vault, scope_key)
    if not root.exists():
        return
    cutoff = time.time() - ATTACHMENT_MAX_AGE_SECONDS
    deadline = time.monotonic() + 0.05
    for index, item in enumerate(root.iterdir()):
        if index >= 256 or time.monotonic() >= deadline:
            break
        try:
            if item.is_file() and item.stat().st_mtime < cutoff:
                item.unlink(missing_ok=True)
        except OSError:
            continue


def _attachment_context(  # noqa: C901 - bounded text and PDF extraction
    vault: Path,
    refs: List[AttachmentRef],
    scope_key: str,
) -> str:
    sections = []
    remaining_total = MAX_ATTACHMENT_CONTEXT
    deadline = time.monotonic() + ATTACHMENT_EXTRACTION_SECONDS
    for ref in refs:
        if remaining_total <= 0 or time.monotonic() >= deadline:
            break
        target = _attachment_target(vault, ref.path, scope_key)
        if not target.is_file() or target.stat().st_size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=422, detail="Attachment is missing or too large")

        suffix = target.suffix.lower()
        text = ""
        if suffix == ".pdf":
            try:
                from pypdf import PdfReader

                chunks = []
                extracted = 0
                for page_index, page in enumerate(PdfReader(str(target)).pages):
                    if page_index >= MAX_PDF_PAGES:
                        break
                    if extracted >= min(MAX_ATTACHMENT_TEXT, remaining_total):
                        break
                    if time.monotonic() >= deadline:
                        break
                    chunk = page.extract_text() or ""
                    chunks.append(chunk[: min(MAX_ATTACHMENT_TEXT, remaining_total) - extracted])
                    extracted += len(chunks[-1])
                text = "\n".join(chunks)
            except Exception as exc:
                log.warning("Could not extract chat PDF attachment %s: %s", target.name, exc)
        else:
            with target.open("r", encoding="utf-8", errors="replace") as handle:
                text = handle.read(min(MAX_ATTACHMENT_TEXT, remaining_total) + 1)

        if text.strip():
            bounded = text[: min(MAX_ATTACHMENT_TEXT, remaining_total)]
            sections.append(f"Attachment: {ref.name}\n{bounded}")
            remaining_total -= len(bounded)
        else:
            sections.append(f"Attachment: {ref.name}\n(No text could be extracted.)")
    return "\n\n".join(sections)


def _consume_attachment_context(
    vault: Path,
    refs: List[AttachmentRef],
    scope_key: str,
) -> str:
    """Extract request-owned attachment context and always remove its files."""
    try:
        return _attachment_context(vault, refs, scope_key)
    finally:
        for attachment in refs:
            try:
                _delete_attachment(vault, attachment.path, scope_key)
            except Exception as cleanup_error:
                log.warning(
                    "Could not remove chat attachment %s: %s",
                    attachment.path,
                    cleanup_error,
                )


@router.post("/chat/attachments", response_model=None)
async def upload_chat_attachment(
    file: UploadFile = File(...),
    agent_id: str = Form(...),
    session_id: str = Form(...),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Store one bounded chat attachment inside the active Vault."""
    vault, vault_scope = _vault_scope()
    scope_key = _attachment_scope_key(
        vault_scope,
        workspace_context.workspace_id,
        workspace_context.user_id,
        _validated_identifier(agent_id, "agent_id"),
        _validated_identifier(session_id, "session_id"),
    )
    _cleanup_expired_attachments(vault, scope_key)
    original_name = Path(file.filename or "attachment").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in CHAT_ATTACHMENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported chat attachment type")
    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if not content:
        raise HTTPException(status_code=422, detail="Chat attachment is empty")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Chat attachment exceeds 15 MB")

    root = _attachment_root(vault, scope_key)
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{uuid.uuid4().hex}{suffix}"
    target.write_bytes(content)
    return {
        "name": original_name,
        "size": len(content),
        "type": file.content_type or "",
        "path": str(target.relative_to(vault)),
    }


@router.delete("/chat/attachments", response_model=None)
async def delete_chat_attachment(
    delete_req: AttachmentDeleteRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Delete an abandoned chat upload from the active Vault."""
    vault, vault_scope = _vault_scope()
    scope_key = _attachment_scope_key(
        vault_scope,
        workspace_context.workspace_id,
        workspace_context.user_id,
        _validated_identifier(delete_req.agent_id, "agent_id"),
        _validated_identifier(delete_req.session_id, "session_id"),
    )
    _delete_attachment(vault, delete_req.path, scope_key)
    return {"deleted": True}
