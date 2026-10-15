"""Public forms expose only explicitly selected questions, never table records."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Query as DatabaseQuery, Session

from backend.data.management_db import get_mgmt_db
from backend.domains.forms.fields import current_fields, field_candidates, table_from_registry
from backend.domains.forms.schemas import (
    FormCandidatesResponse, FormCreateRequest, FormListResponse, FormResponse,
    FormRevokedResponse, FormSubmissionResponse, FormSubmitRequest, PublicFormResponse,
)
from backend.domains.forms.service import (
    PLUGIN_IDS, active_form, create_form, owner_definition, public_definition, stored_fields, submit_form,
)
from backend.domains.vault.registry.runtime import load_registry_for_write
from backend.models.forms import FormDefinition
from backend.services.plugin_access import require_plugins
from backend.services.public_workflow_scope import public_vault_scope, resolve_private_vault
from backend.services.workspace_service import WorkspaceContext, get_workspace_context, require_role

router = APIRouter()
_PRIVATE = [Depends(require_role("editor")), Depends(require_plugins("share-links"))]


def _private_forms(db: Session, context: WorkspaceContext) -> DatabaseQuery[FormDefinition]:
    vault = resolve_private_vault(db, context)
    return db.query(FormDefinition).filter(
        FormDefinition.workspace_id == context.workspace_id,
        FormDefinition.vault_id == vault.id,
        FormDefinition.owner_id == context.user_id,
    )


@router.get("/forms", response_model=FormListResponse, dependencies=_PRIVATE)
def list_forms(
    table_id: str | None = Query(default=None, max_length=200),
    context: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_mgmt_db),
) -> FormListResponse:
    query = _private_forms(db, context)
    if table_id:
        query = query.filter(FormDefinition.table_id == table_id)
    return FormListResponse(forms=[owner_definition(form) for form in query.order_by(FormDefinition.created_at.desc()).all()])


@router.get("/forms/tables/{table_id}/fields", response_model=FormCandidatesResponse, dependencies=_PRIVATE)
def get_form_candidates(
    table_id: str, context: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_mgmt_db),
) -> FormCandidatesResponse:
    vault = resolve_private_vault(db, context)
    with public_vault_scope(db, context.workspace_id, vault.id, context.user_id, PLUGIN_IDS):
        registry = load_registry_for_write()
        return FormCandidatesResponse(fields=field_candidates(table_from_registry(registry, table_id), registry))


@router.post("/forms", response_model=FormResponse, dependencies=_PRIVATE)
def publish_form(
    request: FormCreateRequest, context: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_mgmt_db),
) -> FormResponse:
    return create_form(db, context, request)


@router.delete("/forms/{form_id}", response_model=FormRevokedResponse, dependencies=_PRIVATE)
def revoke_form(
    form_id: str, context: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_mgmt_db),
) -> FormRevokedResponse:
    form = _private_forms(db, context).filter(FormDefinition.id == form_id).first()
    if form is None:
        raise HTTPException(404, "Form not found")
    form.revoked = True
    db.commit()
    return FormRevokedResponse()


@router.get("/forms/public/{token}", response_model=PublicFormResponse)
def read_public_form(token: str, response: Response, db: Session = Depends(get_mgmt_db)) -> PublicFormResponse:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    form = active_form(db, token)
    with public_vault_scope(db, form.workspace_id, form.vault_id, form.owner_id, PLUGIN_IDS):
        registry = load_registry_for_write()
        current_fields(stored_fields(form), table_from_registry(registry, form.table_id), registry)
        return public_definition(form)


@router.post("/forms/public/{token}/submissions", response_model=FormSubmissionResponse)
async def submit_public_form(
    token: str, request: FormSubmitRequest, background_tasks: BackgroundTasks,
    response: Response, db: Session = Depends(get_mgmt_db),
) -> FormSubmissionResponse:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    await submit_form(db, token, request, background_tasks)
    return FormSubmissionResponse()
