import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from backend.models.contact import Contact, ContactType, ContactSource
from backend.services.google_contacts_service import (
    list_google_contacts,
    create_google_contact,
    update_google_contact,
    delete_google_contact,
    parse_google_contact_to_dict,
    get_google_contacts_service,
)
from backend.services.contacts_service import ContactsService

log = logging.getLogger(__name__)


class ContactsSyncEngine:
    def __init__(self, db: Session, workspace_id: str, user_email: str):
        self.db = db
        self.workspace_id = workspace_id
        self.user_email = user_email
        self.contacts_service = ContactsService(db, workspace_id)

    def sync_gnosi_to_google(self) -> dict:
        """Push local contacts to Google. Creates or updates based on google_resource_name."""
        results = {"created": 0, "updated": 0, "deleted": 0, "errors": []}

        try:
            local_contacts = self.contacts_service.list_contacts()
        except Exception as e:
            log.error(f"Error fetching local contacts: {e}")
            results["errors"].append(f"Error fetching local contacts: {e}")
            return results

        for contact in local_contacts:
            try:
                contact_data = {
                    "name": contact.name,
                    "email": contact.email,
                    "phone": contact.phone,
                    "company": contact.company,
                    "job_title": contact.job_title,
                    "address": contact.address,
                    "notes": contact.notes,
                }

                if contact.google_resource_name:
                    updated = update_google_contact(
                        self.user_email, contact.google_resource_name, contact_data
                    )
                    if updated:
                        results["updated"] += 1
                        contact.last_synced_at = datetime.now(timezone.utc)
                        self.db.commit()
                    else:
                        results["errors"].append(f"Failed to update {contact.name}")
                else:
                    created = create_google_contact(self.user_email, contact_data)
                    if created:
                        contact.google_resource_name = created.get("resourceName", "")
                        contact.last_synced_at = datetime.now(timezone.utc)
                        contact.source = ContactSource.GOOGLE.value
                        self.db.commit()
                        results["created"] += 1
                    else:
                        results["errors"].append(f"Failed to create {contact.name}")

            except Exception as e:
                log.error(f"Error syncing contact {contact.name}: {e}")
                results["errors"].append(f"Error syncing {contact.name}: {e}")

        return results

    def sync_google_to_gnosi(self) -> dict:
        """Pull contacts from Google and merge with local."""
        results = {"imported": 0, "updated": 0, "errors": []}

        try:
            google_contacts = list_google_contacts(self.user_email)
        except Exception as e:
            log.error(f"Error fetching Google contacts: {e}")
            results["errors"].append(f"Error fetching Google contacts: {e}")
            return results

        for person in google_contacts:
            try:
                parsed = parse_google_contact_to_dict(person)
                resource_name = parsed.get("resource_name", "")

                if not resource_name:
                    continue

                existing = self.contacts_service.get_contact_by_google_resource(
                    resource_name
                )

                if existing:
                    updated_data = {
                        "name": parsed.get("name", existing.name),
                        "email": parsed.get("email", existing.email),
                        "phone": parsed.get("phone"),
                        "company": parsed.get("company"),
                        "job_title": parsed.get("job_title"),
                        "address": parsed.get("address"),
                        "notes": parsed.get("notes"),
                    }
                    self.contacts_service.update_contact(existing.id, updated_data)
                    existing.last_synced_at = datetime.now(timezone.utc)
                    results["updated"] += 1
                else:
                    new_contact = self.contacts_service.create_contact(
                        {
                            "name": parsed.get("name", "Unknown"),
                            "email": parsed.get("email", "no-email@placeholder.local"),
                            "phone": parsed.get("phone"),
                            "company": parsed.get("company"),
                            "job_title": parsed.get("job_title"),
                            "address": parsed.get("address"),
                            "notes": parsed.get("notes"),
                            "google_resource_name": resource_name,
                            "source": ContactSource.GOOGLE.value,
                        }
                    )
                    new_contact.last_synced_at = datetime.now(timezone.utc)
                    results["imported"] += 1

                self.db.commit()

            except Exception as e:
                log.error(f"Error processing Google contact: {e}")
                results["errors"].append(f"Error processing contact: {e}")

        return results

    def sync_full_bidirectional(self) -> dict:
        """Perform bidirectional sync: Gnosi -> Google first, then Google -> Gnosi."""
        gnosi_to_google = self.sync_gnosi_to_google()
        google_to_gnosi = self.sync_google_to_gnosi()

        return {
            "gnosi_to_google": gnosi_to_google,
            "google_to_gnosi": google_to_gnosi,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def delete_contact_from_google(self, contact_id: str) -> bool:
        """Delete a contact from Google if it has google_resource_name."""
        contact = self.contacts_service.get_contact(contact_id)
        if not contact:
            return False

        if contact.google_resource_name:
            success = delete_google_contact(
                self.user_email, contact.google_resource_name
            )
            if success:
                contact.google_resource_name = None
                contact.source = ContactSource.LOCAL.value
                self.db.commit()
            return success

        return True
