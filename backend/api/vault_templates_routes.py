"""Vault template catalog, creation, export, and moderated submission routes."""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_db
from backend.models.management import Vault
from backend.services import marketplace_submission, vault_templates
from backend.services.workspace_service import (
    WorkspaceContext,
    get_workspace_context,
    require_role,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/vaults", tags=["Vault templates"])


class CreateFromTemplatePayload(BaseModel):
    """Select an immutable template catalog entry for a new Vault."""

    name: str
    template_id: str
    version: Optional[str] = None


class TemplateExportPayload(BaseModel):
    """Public metadata and privacy acknowledgement for a template export."""

    id: str
    version: str = "1.0.0"
    name: str
    description: str = ""
    author: str = ""
    license: str = "CC-BY-4.0"
    minGnosiVersion: str = ""
    categories: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    recommendedPlugins: list[str] = Field(default_factory=list)
    preview: str = ""
    acknowledgeFindings: bool = False


def _vault_row(db: Session, ctx: WorkspaceContext, vault_id: str) -> Vault:
    row = db.query(Vault).filter(
        Vault.id == vault_id,
        Vault.workspace_id == ctx.workspace_id,
    ).first()
    if not row or not row.path_override:
        raise HTTPException(status_code=404, detail="Vault not found")
    return row


def _manifest_payload(payload: TemplateExportPayload) -> dict[str, object]:
    return {
        "id": payload.id,
        "version": payload.version,
        "name": payload.name,
        "description": payload.description,
        "author": payload.author,
        "license": payload.license,
        "minGnosiVersion": payload.minGnosiVersion,
        "categories": payload.categories,
        "languages": payload.languages,
        "recommendedPlugins": payload.recommendedPlugins,
        "preview": payload.preview,
    }


def _config_dir(ctx: WorkspaceContext) -> Path:
    return Path(ctx.vault_path) / ".gnosi"


@router.get("/templates/catalog")
def list_template_catalog(  # type: ignore[no-untyped-def]
    ctx: WorkspaceContext = Depends(get_workspace_context),
):
    """Return the verified official template catalog without breaking offline use."""

    try:
        result = vault_templates.load_catalog(_config_dir(ctx))
        return {**result, "submissionConfigured": marketplace_submission.configured()}
    except vault_templates.VaultTemplateError as exc:
        logger.warning("Vault template catalog is unavailable: %s", exc)
        return {
            "templates": [],
            "unavailable": str(exc),
            "url": vault_templates.default_index_url(),
            "submissionConfigured": marketplace_submission.configured(),
        }


@router.post("/from-template", dependencies=[Depends(require_role("editor"))])
def create_vault_from_template(  # type: ignore[no-untyped-def]
    payload: CreateFromTemplatePayload,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    """Download, verify, stage, and register a Vault from the official catalog."""

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Vault name is required")
    try:
        catalog = vault_templates.load_catalog(_config_dir(ctx))
        matches = [
            item for item in catalog["templates"]
            if item["id"] == payload.template_id
            and (not payload.version or item["version"] == payload.version)
        ]
        if not matches:
            raise vault_templates.VaultTemplateError("Template is not in the verified catalog")
        entry = matches[0]
        package, signed_by = vault_templates.download_template(entry, _config_dir(ctx))
        from backend.api.vaults_routes import _vaults_root

        manifest, path = vault_templates.install_package(
            package,
            vaults_root=_vaults_root(),
            vault_name=name,
            source_url=entry["url"],
            checksum=entry["sha256"],
            signed_by=signed_by,
        )
    except vault_templates.VaultTemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row = Vault(
        workspace_id=ctx.workspace_id,
        name=name,
        path_override=str(path),
    )
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        shutil.rmtree(path, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Could not register the new Vault") from exc
    try:
        from backend.services.active_vault_middleware import reset_vault_path_cache
        reset_vault_path_cache()
    except Exception:  # noqa: BLE001
        pass
    return {
        "id": row.id,
        "name": row.name,
        "path": str(path),
        "template": {"id": manifest["id"], "version": manifest["version"]},
        "signedBy": signed_by,
    }


@router.get(
    "/{vault_id}/template-export/preview",
    dependencies=[Depends(require_role("editor"))],
)
def preview_template_export(  # type: ignore[no-untyped-def]
    vault_id: str,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    """Show the exact export allowlist, exclusions, and privacy findings."""

    row = _vault_row(db, ctx, vault_id)
    try:
        return vault_templates.export_preview(Path(row.path_override))
    except vault_templates.VaultTemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _template_response(row: Vault, payload: TemplateExportPayload) -> Response:
    package, _preview = vault_templates.build_package(
        Path(row.path_override),
        _manifest_payload(payload),
        acknowledge_findings=payload.acknowledgeFindings,
    )
    filename = f"{payload.id}-{payload.version}.gnosi-vault.zip"
    return Response(
        content=package,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-SHA256": hashlib.sha256(package).hexdigest(),
        },
    )


@router.post(
    "/{vault_id}/template-export",
    dependencies=[Depends(require_role("editor"))],
)
def export_vault_template(  # type: ignore[no-untyped-def]
    vault_id: str,
    payload: TemplateExportPayload,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    """Download a deterministic privacy-filtered Vault template package."""

    row = _vault_row(db, ctx, vault_id)
    try:
        return _template_response(row, payload)
    except vault_templates.VaultTemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/{vault_id}/template-submissions",
    dependencies=[Depends(require_role("admin"))],
)
def submit_vault_template(  # type: ignore[no-untyped-def]
    vault_id: str,
    payload: TemplateExportPayload,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    """Upload a template package to the configured moderation broker."""

    row = _vault_row(db, ctx, vault_id)
    try:
        package, preview = vault_templates.build_package(
            Path(row.path_override),
            _manifest_payload(payload),
            acknowledge_findings=payload.acknowledgeFindings,
        )
        return marketplace_submission.submit_package(
            kind="vault-template",
            filename=f"{payload.id}-{payload.version}.gnosi-vault.zip",
            package=package,
            metadata={**_manifest_payload(payload), "previewSummary": {
                "files": len(preview["included"]),
                "excluded": len(preview["excluded"]),
                "findings": len(preview["findings"]),
            }},
        )
    except (vault_templates.VaultTemplateError, marketplace_submission.MarketplaceSubmissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
