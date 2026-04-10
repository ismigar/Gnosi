import logging
import json
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.orm import Session

from backend.models.contact import Contact, ContactType, ContactSource
from backend.services.google_contacts_service import (
    list_google_contacts,
    create_google_contact,
    update_google_contact,
    delete_google_contact,
    parse_google_contact_to_dict,
)

log = logging.getLogger(__name__)


class ContactsService:
    def __init__(self, db: Session, workspace_id: str):
        self.db = db
        self.workspace_id = workspace_id

    def list_contacts(
        self,
        contact_type: Optional[str] = None,
        search: Optional[str] = None,
        source: Optional[str] = None,
    ) -> List[Contact]:
        query = self.db.query(Contact).filter(Contact.workspace_id == self.workspace_id)

        if contact_type:
            query = query.filter(Contact.type == contact_type)

        if source:
            query = query.filter(Contact.source == source)

        if search:
            search_term = f"%{search}%"
            query = query.filter(
                (Contact.name.ilike(search_term))
                | (Contact.email.ilike(search_term))
                | (Contact.company.ilike(search_term))
            )

        return query.order_by(Contact.name).all()

    def get_contact(self, contact_id: str) -> Optional[Contact]:
        return (
            self.db.query(Contact)
            .filter(Contact.id == contact_id, Contact.workspace_id == self.workspace_id)
            .first()
        )

    def get_contact_by_google_resource(self, resource_name: str) -> Optional[Contact]:
        return (
            self.db.query(Contact)
            .filter(
                Contact.google_resource_name == resource_name,
                Contact.workspace_id == self.workspace_id,
            )
            .first()
        )

    def create_contact(self, data: dict) -> Contact:
        contact = Contact(
            id=data.get("id"),
            workspace_id=self.workspace_id,
            name=data["name"],
            email=data["email"],
            type=data.get("type", ContactType.PERSONAL.value),
            phone=data.get("phone"),
            company=data.get("company"),
            job_title=data.get("job_title"),
            address=data.get("address"),
            notes=data.get("notes"),
            tags=json.dumps(data.get("tags", [])),
            source=ContactSource.LOCAL.value,
        )
        self.db.add(contact)
        self.db.commit()
        self.db.refresh(contact)
        return contact

    def update_contact(self, contact_id: str, data: dict) -> Optional[Contact]:
        contact = self.get_contact(contact_id)
        if not contact:
            return None

        for field in [
            "name",
            "email",
            "type",
            "phone",
            "company",
            "job_title",
            "address",
            "notes",
        ]:
            if field in data:
                setattr(contact, field, data[field])

        if "tags" in data:
            contact.tags = json.dumps(data["tags"])

        contact.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(contact)
        return contact

    def delete_contact(self, contact_id: str) -> bool:
        contact = self.get_contact(contact_id)
        if not contact:
            return False

        self.db.delete(contact)
        self.db.commit()
        return True

    def get_sync_status(self) -> dict:
        total = (
            self.db.query(Contact)
            .filter(Contact.workspace_id == self.workspace_id)
            .count()
        )
        synced = (
            self.db.query(Contact)
            .filter(
                Contact.workspace_id == self.workspace_id,
                Contact.google_resource_name.isnot(None),
            )
            .count()
        )

        last_sync = (
            self.db.query(Contact)
            .filter(
                Contact.workspace_id == self.workspace_id,
                Contact.last_synced_at.isnot(None),
            )
            .order_by(Contact.last_synced_at.desc())
            .first()
        )

        return {
            "contacts_count": total,
            "google_synced_count": synced,
            "pending_sync_count": total - synced,
            "last_sync_at": last_sync.last_synced_at if last_sync else None,
        }
