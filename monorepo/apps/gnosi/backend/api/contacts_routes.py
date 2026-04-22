from fastapi import APIRouter, Header, HTTPException, Depends, BackgroundTasks
from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_session
from backend.services.contacts_service import ContactsService
from backend.services.contacts_sync_engine import ContactsSyncEngine
from typing import Optional, List
import json
import asyncio
import functools
import time
from sqlalchemy.orm import Session

router = APIRouter()

_contacts_cache: dict = {}
_CONTACTS_CACHE_TTL = 60
log = get_logger(__name__)

def background_sync_contact(db: Session, workspace_id: str, source: str):
    """Executa la sincronització cap a fora per a un compte específic."""
    try:
        # Busquem si hi ha una integració configurada per a aquest email de font
        # Per simplificar, creem una integració temporal basada en la font si és un email
        if "@" in source:
            integration = {"provider": "google", "email": source}
            # Nota: El SyncEngine ja s'encarrega d'obtenir el token del Vault
            sync_engine = ContactsSyncEngine(db, workspace_id, integration)
            sync_engine.sync_gnosi_to_remote()
            log.info(f"Sincronització de fons completada per a {source}")
    except Exception as e:
        log.error(f"Error en la sincronització de fons per a {source}: {e}")

def contacts_response(contact) -> dict:
    def parse_json(field_data):
        if not field_data:
            return []
        if isinstance(field_data, (list, dict)):
            return field_data
        try:
            return json.loads(field_data)
        except:
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
        "created_at": contact.created_at.isoformat(),
        "updated_at": contact.updated_at.isoformat(),
    }

@router.get("/contacts")
async def list_contacts(
    x_workspace_id: str = Header("default", alias="X-Workspace-ID"),
    type: Optional[str] = None,
    search: Optional[str] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_mgmt_session)
):
    try:
        cache_key = f"{x_workspace_id}:{type}:{search}:{source}"
        cached = _contacts_cache.get(cache_key)
        if cached and time.time() - cached["ts"] < _CONTACTS_CACHE_TTL:
            return cached["data"]

        def _fetch():
            service = ContactsService(db, x_workspace_id)
            return service.list_contacts(type, search, source)

        contacts = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        result = [contacts_response(c) for c in contacts]
        _contacts_cache[cache_key] = {"ts": time.time(), "data": result}
        return result
    except Exception as e:
        log.error(f"Error listing contacts: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/contacts/{contact_id}")
async def get_contact(
    contact_id: str,
    x_workspace_id: str = Header("default", alias="X-Workspace-ID"),
    db: Session = Depends(get_mgmt_session)
):
    try:
        service = ContactsService(db, x_workspace_id)
        contact = service.get_contact(contact_id)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error getting contact: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/contacts", status_code=201)
async def create_contact(
    data: dict,
    background_tasks: BackgroundTasks,
    x_workspace_id: str = Header("default", alias="X-Workspace-ID"),
    db: Session = Depends(get_mgmt_session)
):
    try:
        if not data.get("name") or not data.get("email"):
            raise HTTPException(status_code=400, detail="Name and email are required")

        service = ContactsService(db, x_workspace_id)
        contact = service.create_contact(data)
        _contacts_cache.clear()

        if contact.source and contact.source != "local":
            background_tasks.add_task(background_sync_contact, db, x_workspace_id, contact.source)

        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error creating contact: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/contacts/{contact_id}")
async def update_contact(
    contact_id: str,
    data: dict,
    background_tasks: BackgroundTasks,
    x_workspace_id: str = Header("default", alias="X-Workspace-ID"),
    db: Session = Depends(get_mgmt_session)
):
    try:
        service = ContactsService(db, x_workspace_id)
        contact = service.update_contact(contact_id, data)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        _contacts_cache.clear()

        if contact.source and contact.source != "local":
            background_tasks.add_task(background_sync_contact, db, x_workspace_id, contact.source)

        return contacts_response(contact)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating contact: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/contacts/{contact_id}")
async def delete_contact(
    contact_id: str,
    x_workspace_id: str = Header("default", alias="X-Workspace-ID"),
    x_user_email: str = Header("", alias="X-User-Email"),
    db: Session = Depends(get_mgmt_session)
):
    try:
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
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/contacts/sync")
async def sync_contacts(
    data: Optional[dict] = None,
    x_workspace_id: str = Header("default", alias="X-Workspace-ID"),
    x_user_email: str = Header("", alias="X-User-Email"),
    db: Session = Depends(get_mgmt_session)
):
    try:
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
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/contacts/sync/status")
async def sync_status(
    x_workspace_id: str = Header("default", alias="X-Workspace-ID"),
    db: Session = Depends(get_mgmt_session)
):
    try:
        service = ContactsService(db, x_workspace_id)
        status = service.get_sync_status()
        return status
    except Exception as e:
        log.error(f"Error getting sync status: {e}")
        raise HTTPException(status_code=500, detail=str(e))
