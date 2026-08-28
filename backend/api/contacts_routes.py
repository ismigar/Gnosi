from fastapi import APIRouter, Header, HTTPException, Depends, BackgroundTasks
from backend.config.logger_config import get_logger
from backend.utils.errors import safe_error_detail
from backend.data.management_db import get_mgmt_db
from backend.services.contacts_service import ContactsService
from backend.services.contacts_sync_engine import ContactsSyncEngine
from backend.services.workspace_service import require_role, get_workspace_context, WorkspaceContext
from typing import Any, cast
import json
import asyncio
import functools
import time
from sqlalchemy.orm import Session
from backend.models.contact import Contact

router = APIRouter()

# Thread-safe + bounded (see backend.utils.cache for rationale).
from backend.utils.cache import SimpleCache as _SimpleCache

_contacts_cache = _SimpleCache(default_ttl=60, max_size=128)
log = get_logger(__name__)


def background_sync_contact(workspace_id: str, source: str) -> None:
    """Runs the outbound sync for a specific account.

    IMPORTANT: this function **opens and closes its own session**.
    The session coming from `Depends(get_mgmt_db)` has already closed by the time
    FastAPI runs the background task (the dependency's `finally db.close()`
    fires before the response is sent). Reusing it would raise
    `DetachedInstanceError`.

    """
    from backend.data.management_db import get_mgmt_session

    db = get_mgmt_session()
    try:
        if "@" in source:
            integration = {"provider": "google", "email": source}
            sync_engine = ContactsSyncEngine(db, workspace_id, integration)
            sync_engine.sync_gnosi_to_remote()
            log.info(f"Background synchronization completed for {source}")
    except Exception as e:
        log.error(f"Background synchronization failed for {source}: {e}")
    finally:
        try:
            db.close()
        except Exception:
            pass


def contacts_response(contact: Contact) -> dict[str, Any]:
    def parse_json(field_data: object) -> Any:
        if not field_data:
            return []
        if isinstance(field_data, (list, dict)):
            return field_data
        try:
            return cast(Any, json.loads(cast(str, field_data)))
        except (ValueError, TypeError):
            return []

    return {
        "id": contact.id,
        "workspace_id": contact.workspace_id,
        "type": contact.type,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
        "company": contact.company,
        "job_title": contact.job_title,
        "address": contact.address,
        "notes": contact.notes,
        "google_resource_name": contact.google_resource_name,
        "apple_resource_id": contact.apple_resource_id,
        "last_synced_at": contact.last_synced_at.isoformat() if contact.last_synced_at else None,
        "source": contact.source,
        "photo_url": contact.photo_url,
        "tags": parse_json(contact.tags),
        "emails": parse_json(contact.emails),
        "phones": parse_json(contact.phones),
        "addresses": parse_json(contact.addresses),
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
        "updated_at": contact.updated_at.isoformat() if contact.updated_at else None,
    }


@router.get("/contacts", response_model=None)
async def list_contacts(
    type: str | None = None,
    search: str | None = None,
    source: str | None = None,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    try:
        x_workspace_id = context.workspace_id
        cache_key = f"{x_workspace_id}:{type}:{search}:{source}"
        cached = _contacts_cache.get(cache_key)
        if cached is not None:
            return cached

        def _fetch() -> list[Contact]:
            service = ContactsService(db, x_workspace_id)
            return service.list_contacts(type, search, source)

        # asyncio.get_event_loop() is deprecated inside async functions and can
        # fail in Python 3.12+. asyncio.to_thread is the modern equivalent.
        contacts = await asyncio.to_thread(_fetch)
        result = [contacts_response(c) for c in contacts]
        _contacts_cache.set(cache_key, result)
        return result
    except Exception as e:
        log.error(f"Error listing contacts: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /contacts list"),
        )


@router.get("/contacts/{contact_id}", response_model=None)
async def get_contact(
    contact_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    try:
        service = ContactsService(db, context.workspace_id)
        contact = service.get_contact(contact_id)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error getting contact: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /contacts/{contact_id}"),
        )


@router.post("/contacts", status_code=201, response_model=None)
async def create_contact(
    data: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    try:
        if not data.get("name") or not data.get("email"):
            raise HTTPException(status_code=400, detail="Name and email are required")

        x_workspace_id = context.workspace_id
        service = ContactsService(db, x_workspace_id)
        contact = service.create_contact(data)
        _contacts_cache.clear()

        if contact.source and contact.source != "local":
            background_tasks.add_task(
                background_sync_contact, x_workspace_id, cast(str, contact.source)
            )

        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error creating contact: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /contacts"),
        )


@router.put("/contacts/{contact_id}", response_model=None)
async def update_contact(
    contact_id: str,
    data: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    try:
        x_workspace_id = context.workspace_id
        service = ContactsService(db, x_workspace_id)
        contact = service.update_contact(contact_id, data)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        _contacts_cache.clear()

        if contact.source and contact.source != "local":
            background_tasks.add_task(
                background_sync_contact, x_workspace_id, cast(str, contact.source)
            )

        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating contact: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "PUT /contacts/{contact_id}"),
        )


@router.delete("/contacts/{contact_id}", response_model=None)
async def delete_contact(
    contact_id: str,
    x_user_email: str = Header("", alias="X-User-Email"),
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    try:
        x_workspace_id = context.workspace_id
        service = ContactsService(db, x_workspace_id)
        contact = service.get_contact(contact_id)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")

        if contact.google_resource_name and x_user_email:
            sync_engine = ContactsSyncEngine(
                db, x_workspace_id, {"provider": "google", "email": x_user_email}
            )
            sync_engine.delete_contact_from_remote(contact_id)

        success = service.delete_contact(contact_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete contact")
        _contacts_cache.clear()

        return {"status": "ok", "message": "Contact deleted"}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error deleting contact: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "DELETE /contacts/{contact_id}"),
        )


@router.post("/contacts/sync", response_model=None)
async def sync_contacts(
    data: dict[str, Any] | None = None,
    x_user_email: str = Header("", alias="X-User-Email"),
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    try:
        x_workspace_id = context.workspace_id
        # 1. Prepare integration data
        integration = data or {}

        # If no specific account info in body, try to use X-User-Email to find a Google account
        if not integration.get("provider") and x_user_email:
            integration = {"provider": "google", "email": x_user_email}

        if not integration.get("provider"):
            log.warning("Synchronization attempted without a provider or user email")
            raise HTTPException(status_code=400, detail="Provider or User email required for sync")

        log.info(
            f"Starting contact synchronization for {integration.get('email')} ({integration.get('provider')})"
        )

        # 2. Initialize engine with integration details
        sync_engine = ContactsSyncEngine(db, x_workspace_id, integration)
        result = sync_engine.sync_full_bidirectional()

        # Check for errors in the individual sync processes
        has_errors = (
            len(result.get("gnosi_to_remote", {}).get("errors", [])) > 0
            or len(result.get("remote_to_gnosi", {}).get("errors", [])) > 0
        )

        if has_errors:
            log.warning(f"Synchronization completed with errors for {integration.get('email')}")

        return {"status": "ok", "result": result}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error syncing contacts: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /contacts/sync"),
        )


@router.get("/contacts/sync/status", response_model=None)
async def sync_status(
    context: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_mgmt_db)
) -> Any:
    try:
        service = ContactsService(db, context.workspace_id)
        status = service.get_sync_status()
        return status
    except Exception as e:
        log.error(f"Error getting sync status: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /contacts/sync/status"),
        )
