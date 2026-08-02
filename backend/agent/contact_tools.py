"""Governed adapters for local contact maintenance."""
from __future__ import annotations

import json
from typing import Any, Dict, List

try:
    from langchain_core.tools import tool
except Exception:  # pragma: no cover
    def tool(fn=None, **_kwargs):
        return fn if fn else (lambda function: function)


def _service():
    from backend.agent.gnosi_tools import _workspace_id
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    database = get_mgmt_session()
    return database, ContactsService(database, _workspace_id())


def _row(contact) -> Dict[str, Any]:
    return {
        "id": contact.id,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
        "company": contact.company,
        "job_title": contact.job_title,
        "address": contact.address,
        "notes": str(contact.notes or "")[:2_000],
        "source": contact.source,
    }


@tool
def read_contact(contact_id: str) -> str:
    """Read one exact local Gnosi contact."""
    database, service = _service()
    try:
        contact = service.get_contact(contact_id)
        return json.dumps(
            _row(contact) if contact else {"error": "Contact not found."},
            ensure_ascii=False,
            default=str,
        )
    finally:
        database.close()


@tool
def find_duplicate_contacts(limit: int = 100) -> str:
    """Find bounded duplicate candidates by normalized email, phone, or name."""
    database, service = _service()
    try:
        contacts = service.list_contacts(None, None, None)[:max(2, min(int(limit), 500))]
        groups: Dict[str, List[Any]] = {}
        for contact in contacts:
            keys = []
            if contact.email:
                keys.append(f"email:{contact.email.strip().casefold()}")
            if contact.phone:
                phone = "".join(char for char in contact.phone if char.isdigit())
                if phone:
                    keys.append(f"phone:{phone}")
            if contact.name:
                keys.append(f"name:{' '.join(contact.name.casefold().split())}")
            for key in keys:
                groups.setdefault(key, []).append(contact)
        duplicates = []
        seen = set()
        for match_key, matches in groups.items():
            ids = tuple(sorted(str(item.id) for item in matches))
            if len(ids) < 2 or ids in seen:
                continue
            seen.add(ids)
            duplicates.append({
                "match": match_key,
                "contacts": [_row(item) for item in matches[:20]],
            })
            if len(duplicates) >= 50:
                break
        return json.dumps({"groups": duplicates}, ensure_ascii=False, default=str)
    finally:
        database.close()


@tool
def update_contact(contact_id: str, changes: Dict[str, Any]) -> str:
    """Update supported local fields of one contact after an explicit request."""
    allowed = {
        "name", "email", "phone", "company", "job_title", "address",
        "notes", "tags", "emails", "phones", "addresses",
    }
    patch = {key: value for key, value in changes.items() if key in allowed}
    if not patch:
        raise ValueError("No supported contact changes were provided.")
    database, service = _service()
    try:
        contact = service.update_contact(contact_id, patch)
        if not contact:
            return json.dumps({"error": "Contact not found."})
        return json.dumps(
            {"status": "updated", "contact": _row(contact)},
            ensure_ascii=False,
            default=str,
        )
    finally:
        database.close()


@tool
def merge_contacts(primary_contact_id: str, duplicate_contact_ids: List[str]) -> str:
    """Merge local duplicate contacts into one primary and delete the duplicates."""
    duplicate_ids = [
        str(value) for value in duplicate_contact_ids
        if str(value) and str(value) != str(primary_contact_id)
    ][:20]
    if not duplicate_ids:
        raise ValueError("At least one distinct duplicate contact is required.")
    database, service = _service()
    try:
        primary = service.get_contact(primary_contact_id)
        duplicates = [service.get_contact(value) for value in duplicate_ids]
        if primary is None or any(item is None for item in duplicates):
            return json.dumps({"error": "One or more contacts were not found."})
        fields = ("name", "email", "phone", "company", "job_title", "address", "notes")
        changes = {}
        for field in fields:
            current = getattr(primary, field, None)
            if current:
                continue
            replacement = next(
                (getattr(item, field, None) for item in duplicates if getattr(item, field, None)),
                None,
            )
            if replacement:
                changes[field] = replacement
        if changes:
            primary = service.update_contact(primary_contact_id, changes)
        deleted = []
        for duplicate_id in duplicate_ids:
            if service.delete_contact(duplicate_id):
                deleted.append(duplicate_id)
        return json.dumps({
            "status": "merged",
            "primary": _row(primary),
            "deleted_contact_ids": deleted,
        }, ensure_ascii=False, default=str)
    finally:
        database.close()


CONTACT_READ_TOOLS = [read_contact, find_duplicate_contacts]
CONTACT_LOCAL_WRITE_TOOLS = [update_contact]
CONTACT_DESTRUCTIVE_TOOLS = [merge_contacts]
