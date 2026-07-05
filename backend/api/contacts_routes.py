from fastapi import APIRouter, Header, HTTPException, Depends, BackgroundTasks
from backend.config.logger_config import get_logger
from backend.utils.errors import safe_error_detail
from backend.data.management_db import get_mgmt_db
from backend.services.contacts_service import ContactsService
from backend.services.contacts_sync_engine import ContactsSyncEngine
from backend.services.workspace_service import require_role, get_workspace_context, WorkspaceContext
from typing import Optional, List
import json
import asyncio
import functools
import time
from sqlalchemy.orm import Session

router = APIRouter()

# Thread-safe + bounded (see backend.utils.cache for rationale).
from backend.utils.cache import SimpleCache as _SimpleCache
_contacts_cache = _SimpleCache(default_ttl=60, max_size=128)
log = get_logger(__name__)

def background_sync_contact(workspace_id: str, source: str):
    """Executa la sincronització cap a fora per a un compte específic.

    IMPORTANT: aquesta funció **obre i tanca la seva pròpia sessió**.
    La sessió que ve de `Depends(get_mgmt_db)` ja s'ha tancat per quan
    FastAPI executa la background task (el `finally db.close()` del
    dependency es dispara abans d'enviar la resposta). Reusar-la donaria
    `DetachedInstanceError`.
    """
    from backend.data.management_db import get_mgmt_session
    db = get_mgmt_session()
    try:
        if "@" in source:
            integration = {"provider": "google", "email": source}
            sync_engine = ContactsSyncEngine(db, workspace_id, integration)
            sync_engine.sync_gnosi_to_remote()
            log.info(f"Sincronització de fons completada per a {source}")
    except Exception as e:
        log.error(f"Error en la sincronització de fons per a {source}: {e}")
    finally:
        try:
            db.close()
        except Exception:
            pass

def contacts_response(contact) -> dict:
    def parse_json(field_data):
        if not field_data:
            return []
        if isinstance(field_data, (list, dict)):
            return field_data
        try:
            return json.loads(field_data)
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
        "last_synced_at": contact.last_synced_at.isoformat()
        if contact.last_synced_at
        else None,
        "source": contact.source,
        "photo_url": contact.photo_url,
        "tags": parse_json(contact.tags),
        "emails": parse_json(contact.emails),
        "phones": parse_json(contact.phones),
        "addresses": parse_json(contact.addresses),
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
        "updated_at": contact.updated_at.isoformat() if contact.updated_at else None,
    }

@router.get("/contacts")
async def list_contacts(
    type: Optional[str] = None,
    search: Optional[str] = None,
    source: Optional[str] = None,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db)
):
    try:
        x_workspace_id = context.workspace_id
        cache_key = f"{x_workspace_id}:{type}:{search}:{source}"
        cached = _contacts_cache.get(cache_key)
        if cached is not None:
            return cached

        def _fetch():
            service = ContactsService(db, x_workspace_id)
            return service.list_contacts(type, search, source)

        # asyncio.get_event_loop() està deprecat dins funcions async i pot
        # fallar en Python 3.12+. asyncio.to_thread és l'equivalent modern.
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

@router.get("/contacts/{contact_id}")
async def get_contact(
    contact_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db)
):
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

@router.post("/contacts", status_code=201)
async def create_contact(
    data: dict,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db)
):
    try:
        if not data.get("name") or not data.get("email"):
            raise HTTPException(status_code=400, detail="Name and email are required")

        x_workspace_id = context.workspace_id
        service = ContactsService(db, x_workspace_id)
        contact = service.create_contact(data)
        _contacts_cache.clear()

        if contact.source and contact.source != "local":
            background_tasks.add_task(background_sync_contact, x_workspace_id, contact.source)

        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error creating contact: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /contacts"),
        )

@router.put("/contacts/{contact_id}")
async def update_contact(
    contact_id: str,
    data: dict,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db)
):
    try:
        x_workspace_id = context.workspace_id
        service = ContactsService(db, x_workspace_id)
        contact = service.update_contact(contact_id, data)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        _contacts_cache.clear()

        if contact.source and contact.source != "local":
            background_tasks.add_task(background_sync_contact, x_workspace_id, contact.source)

        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating contact: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "PUT /contacts/{contact_id}"),
        )

@router.delete("/contacts/{contact_id}")
async def delete_contact(
    contact_id: str,
    x_user_email: str = Header("", alias="X-User-Email"),
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db)
):
    try:
        x_workspace_id = context.workspace_id
        service = ContactsService(db, x_workspace_id)
        contact = service.get_contact(contact_id)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")

        if contact.google_resource_name and x_user_email:
            sync_engine = ContactsSyncEngine(db, x_workspace_id, {"provider": "google", "email": x_user_email})
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

@router.post("/contacts/sync")
async def sync_contacts(
    data: Optional[dict] = None,
    x_user_email: str = Header("", alias="X-User-Email"),
    context: WorkspaceContext = Depends(require_role("editor")),
    db: Session = Depends(get_mgmt_db)
):
    try:
        x_workspace_id = context.workspace_id
        # 1. Prepare integration data
        integration = data or {}
        
        # If no specific account info in body, try to use X-User-Email to find a Google account
        if not integration.get("provider") and x_user_email:
            integration = {
                "provider": "google",
                "email": x_user_email
            }
        
        if not integration.get("provider"):
            log.warning("Intent de sincronització sense proveïdor ni email d'usuari")
            raise HTTPException(status_code=400, detail="Provider or User email required for sync")

        log.info(f"Iniciant sincronització de contactes per a {integration.get('email')} ({integration.get('provider')})")

        # 2. Initialize engine with integration details
        sync_engine = ContactsSyncEngine(db, x_workspace_id, integration)
        result = sync_engine.sync_full_bidirectional()

        # Check for errors in the individual sync processes
        has_errors = len(result.get("gnosi_to_remote", {}).get("errors", [])) > 0 or \
                     len(result.get("remote_to_gnosi", {}).get("errors", [])) > 0
        
        if has_errors:
            log.warning(f"Sincronització completada amb errors per a {integration.get('email')}")

        return {"status": "ok", "result": result}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error syncing contacts: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /contacts/sync"),
        )

@router.get("/contacts/sync/status")
async def sync_status(
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db)
):
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
