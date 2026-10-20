"""Owner-scoped form persistence and idempotent canonical page creation."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.domains.forms.fields import build_fields, current_fields, submission_page, table_from_registry
from backend.domains.forms.schemas import (
    FormCreateRequest, FormResponse, FormSubmitRequest, PublicFormField,
    PublicFormResponse, StoredFormField,
)
from backend.domains.vault.registry.runtime import load_registry_for_write
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.models.forms import FormDefinition, FormSubmission
from backend.services.public_workflow_scope import public_vault_scope, resolve_private_vault
from backend.services.workspace_service import WorkspaceContext


PLUGIN_IDS = ("share-links",)


def stored_fields(form: FormDefinition) -> list[StoredFormField]:
    return [StoredFormField.model_validate(field) for field in json.loads(form.fields_json)]


def public_definition(form: FormDefinition) -> PublicFormResponse:
    return PublicFormResponse(
        title=form.title, description=form.description,
        fields=[PublicFormField.model_validate(field.model_dump()) for field in stored_fields(form)],
    )


def owner_definition(form: FormDefinition) -> FormResponse:
    return FormResponse(
        **public_definition(form).model_dump(), id=form.id, table_id=form.table_id,
        url=f"/forms/{form.token}",
        expires_at=form.expires_at.replace(tzinfo=form.expires_at.tzinfo or timezone.utc) if form.expires_at else None,
        revoked=form.revoked, created_at=form.created_at.replace(tzinfo=form.created_at.tzinfo or timezone.utc),
    )


def active_form(db: Session, token: str) -> FormDefinition:
    form = db.query(FormDefinition).filter(FormDefinition.token == token).first() if len(token) <= 100 else None
    if form is None or form.revoked:
        raise HTTPException(404, "This form is unavailable")
    expires = form.expires_at
    if expires is None or expires.replace(tzinfo=expires.tzinfo or timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(404, "This form is unavailable")
    return form


def create_form(db: Session, context: WorkspaceContext, request: FormCreateRequest) -> FormResponse:
    vault = resolve_private_vault(db, context)
    with public_vault_scope(db, context.workspace_id, vault.id, context.user_id, PLUGIN_IDS):
        registry = load_registry_for_write()
        table = table_from_registry(registry, request.table_id)
        fields = build_fields(request.fields, table, registry)
    form = FormDefinition(
        workspace_id=context.workspace_id, vault_id=vault.id, owner_id=context.user_id,
        table_id=request.table_id, title=request.title, description=request.description,
        fields_json=json.dumps([field.model_dump() for field in fields], ensure_ascii=False),
        expires_at=datetime.now(timezone.utc) + timedelta(days=request.expires_in_days),
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return owner_definition(form)


def _fingerprint(request: FormSubmitRequest) -> str:
    try:
        raw = json.dumps(request.values, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid form values") from None
    if len(raw.encode("utf-8")) > 65536 or len(request.values) > 40:
        raise HTTPException(413, "The form response is too large")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _existing_submission(db: Session, form: FormDefinition, request: FormSubmitRequest, fingerprint: str) -> FormSubmission | None:
    submission = db.query(FormSubmission).filter(
        FormSubmission.form_id == form.id, FormSubmission.request_id == request.request_id,
    ).first()
    if submission is not None and submission.fingerprint != fingerprint:
        raise HTTPException(409, "This submission identity already belongs to different answers")
    return submission


def _claim_submission(db: Session, form: FormDefinition, request: FormSubmitRequest, page: PageSaveRequest, fingerprint: str) -> FormSubmission:
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    count = db.query(FormSubmission).filter(FormSubmission.form_id == form.id, FormSubmission.created_at >= cutoff).count()
    if count >= 1000:
        raise HTTPException(429, "This form has reached its daily submission limit")
    submission = FormSubmission(
        form_id=form.id, request_id=request.request_id, fingerprint=fingerprint,
        payload_json=page.model_dump_json(),
    )
    db.add(submission)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _existing_submission(db, form, request, fingerprint)
        if existing is None:
            raise HTTPException(503, "The response could not be saved") from None
        return existing
    db.refresh(submission)
    return submission


async def submit_form(db: Session, token: str, request: FormSubmitRequest, background_tasks: BackgroundTasks) -> None:
    form = active_form(db, token)
    fingerprint = _fingerprint(request)
    with public_vault_scope(db, form.workspace_id, form.vault_id, form.owner_id, PLUGIN_IDS) as context:
        if request.website:
            return
        submission = _existing_submission(db, form, request, fingerprint)
        if submission is not None and submission.completed:
            return
        fields = stored_fields(form)
        registry = load_registry_for_write()
        table = table_from_registry(registry, form.table_id)
        names = current_fields(fields, table, registry)
        page = submission_page(fields, names, request.values, form.table_id)
        if submission is None:
            submission = _claim_submission(db, form, request, page, fingerprint)
        if submission.completed:
            return
        # The canonical receipt fixes the generated page ID and survives crashes.
        # Retrying a lost response can therefore never create a second record.
        await _create_submission_page(form, submission, background_tasks, context)
        submission.completed = True
        db.commit()


async def _create_submission_page(
    form: FormDefinition, submission: FormSubmission, background_tasks: BackgroundTasks, context: WorkspaceContext,
) -> None:
    from backend.domains.vault.api.core_routes import create_page

    key = "form_" + hashlib.sha256(f"{form.id}:{submission.request_id}".encode()).hexdigest()
    try:
        await create_page(
            PageSaveRequest.model_validate_json(submission.payload_json), background_tasks,
            context=context, idempotency_key=key,
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            raise HTTPException(409, "Your response is still being processed; retry the same submission") from None
        raise HTTPException(503, "Your response could not be confirmed; retry the same submission") from None
