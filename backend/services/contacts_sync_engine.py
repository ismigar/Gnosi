import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from abc import ABC, abstractmethod
from sqlalchemy.orm import Session
import yaml
from pathlib import Path
from backend.config.paths_config import get_paths
from backend.utils.safe_io import safe_write_text

from backend.models.contact import Contact, ContactType, ContactSource
from backend.services.google_contacts_service import (
    list_google_contacts,
    create_google_contact,
    update_google_contact,
    delete_google_contact,
    parse_google_contact_to_dict,
)
from backend.services.contacts_service import ContactsService

log = logging.getLogger(__name__)

class BaseContactsProvider(ABC):
    @abstractmethod
    def list_contacts(self) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def create_contact(self, contact_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    def update_contact(self, remote_id: str, contact_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    def delete_contact(self, remote_id: str) -> bool:
        pass

    @abstractmethod
    def parse_to_internal(self, remote_contact: Dict[str, Any]) -> Dict[str, Any]:
        pass

class GoogleContactsProvider(BaseContactsProvider):
    def __init__(self, email: str):
        self.email = email

    def list_contacts(self):
        return list_google_contacts(self.email)

    def create_contact(self, contact_data):
        return create_google_contact(self.email, contact_data)

    def update_contact(self, remote_id, contact_data):
        return update_google_contact(self.email, remote_id, contact_data)

    def delete_contact(self, remote_id):
        return delete_google_contact(self.email, remote_id)

    def parse_to_internal(self, remote_contact):
        parsed = parse_google_contact_to_dict(remote_contact)
        parsed["remote_id"] = parsed.get("resource_name")
        return parsed

class CardDAVContactsProvider(BaseContactsProvider):
    """CardDAV provider for Nextcloud, iCloud, and other CardDAV servers."""

    def __init__(self, url: str, token: str, email: str):
        self.email = email
        self.token = token
        # Derive username from email (part before @)
        self.username = email.split("@")[0] if email else ""
        # Build the full CardDAV URL
        self.base_url = self._build_carddav_url(url)
        log.info(f"CardDAV provider initialized: {self.base_url} (user: {self.username})")

    def _build_carddav_url(self, url: str) -> str:
        """Build the full CardDAV addressbook URL from the host."""
        url = url.strip().rstrip("/")
        # If it's already a full path, use it
        if "/remote.php/dav" in url or "/dav/" in url:
            if not url.startswith("http"):
                url = f"https://{url}"
            return url
        # Otherwise, build the Nextcloud standard path
        if not url.startswith("http"):
            url = f"https://{url}"
        return f"{url}/remote.php/dav/addressbooks/users/{self.username}/contacts/"

    def _get_auth(self):
        """Returns the auth tuple for requests."""
        return (self.username, self.token)

    def list_contacts(self) -> List[Dict[str, Any]]:
        """Fetch all contacts from the CardDAV server via REPORT."""
        import requests
        import xml.etree.ElementTree as ET

        body = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">'
            '<d:prop><d:getetag/><card:address-data/></d:prop>'
            '</card:addressbook-query>'
        )

        try:
            resp = requests.request(
                "REPORT",
                self.base_url,
                auth=self._get_auth(),
                headers={"Depth": "1", "Content-Type": "application/xml"},
                data=body,
                timeout=30,
            )

            if resp.status_code != 207:
                log.error(f"CardDAV REPORT failed ({resp.status_code}): {resp.text[:200]}")
                raise Exception(f"CardDAV server returned {resp.status_code}")

            # Parse the XML response
            contacts = []
            ns = {
                "d": "DAV:",
                "card": "urn:ietf:params:xml:ns:carddav",
            }
            root = ET.fromstring(resp.text)

            for response in root.findall("d:response", ns):
                href = response.findtext("d:href", default="", namespaces=ns)
                propstat = response.find("d:propstat", ns)
                if propstat is None:
                    continue

                status = propstat.findtext("d:status", default="", namespaces=ns)
                if "200" not in status:
                    continue

                prop = propstat.find("d:prop", ns)
                if prop is None:
                    continue

                etag = prop.findtext("d:getetag", default="", namespaces=ns)
                vcard_data = prop.findtext("card:address-data", default="", namespaces=ns)

                if vcard_data and "BEGIN:VCARD" in vcard_data:
                    contacts.append({
                        "href": href,
                        "etag": etag.strip('"'),
                        "vcard": vcard_data,
                    })

            log.info(f"CardDAV: fetched {len(contacts)} contacts from {self.base_url}")
            return contacts

        except requests.RequestException as e:
            log.error(f"CardDAV connection error to {self.base_url}: {e}")
            raise Exception(f"Error connecting to CardDAV server: {e}")

    def create_contact(self, contact_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Create a new contact on the CardDAV server via PUT."""
        import requests
        import uuid

        uid = str(uuid.uuid4())
        vcard = self._build_vcard(contact_data, uid)
        href = f"{self.base_url}{uid}.vcf"

        try:
            resp = requests.put(
                href,
                auth=self._get_auth(),
                headers={"Content-Type": "text/vcard; charset=utf-8"},
                data=vcard.encode("utf-8"),
                timeout=15,
            )

            if resp.status_code in (201, 204):
                log.info(f"CardDAV: created contact {contact_data.get('name')} at {href}")
                return {"href": href, "uid": uid, "vcard": vcard}
            else:
                log.error(f"CardDAV PUT failed ({resp.status_code}): {resp.text[:200]}")
                return None
        except requests.RequestException as e:
            log.error(f"CardDAV create error: {e}")
            return None

    def update_contact(self, remote_id: str, contact_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a contact on the CardDAV server via PUT."""
        import requests

        # remote_id is the href
        uid = remote_id.rstrip("/").rsplit("/", 1)[-1].replace(".vcf", "")
        vcard = self._build_vcard(contact_data, uid)

        # Build full URL if remote_id is a relative path
        url = remote_id
        if not url.startswith("http"):
            base = self.base_url.split("/remote.php")[0] if "/remote.php" in self.base_url else self.base_url
            url = f"{base}{remote_id}"

        try:
            resp = requests.put(
                url,
                auth=self._get_auth(),
                headers={"Content-Type": "text/vcard; charset=utf-8"},
                data=vcard.encode("utf-8"),
                timeout=15,
            )

            if resp.status_code in (200, 201, 204):
                log.info(f"CardDAV: updated contact at {url}")
                return {"href": remote_id, "uid": uid, "vcard": vcard}
            else:
                log.error(f"CardDAV PUT (update) failed ({resp.status_code}): {resp.text[:200]}")
                return None
        except requests.RequestException as e:
            log.error(f"CardDAV update error: {e}")
            return None

    def delete_contact(self, remote_id: str) -> bool:
        """Delete a contact from the CardDAV server via DELETE."""
        import requests

        url = remote_id
        if not url.startswith("http"):
            base = self.base_url.split("/remote.php")[0] if "/remote.php" in self.base_url else self.base_url
            url = f"{base}{remote_id}"

        try:
            resp = requests.delete(url, auth=self._get_auth(), timeout=15)
            if resp.status_code in (200, 204):
                log.info(f"CardDAV: deleted contact at {url}")
                return True
            else:
                log.error(f"CardDAV DELETE failed ({resp.status_code}): {resp.text[:200]}")
                return False
        except requests.RequestException as e:
            log.error(f"CardDAV delete error: {e}")
            return False

    def parse_to_internal(self, remote_contact: Dict[str, Any]) -> Dict[str, Any]:
        """Parse a CardDAV response entry (with vcard string) to internal dict."""
        import re

        vcard = remote_contact.get("vcard", "")
        href = remote_contact.get("href", "")

        def _get_vcard_field(field_name: str) -> str:
            """Extract a simple field value from vCard text."""
            pattern = rf"^{field_name}[^:]*:(.+?)$"
            match = re.search(pattern, vcard, re.MULTILINE | re.IGNORECASE)
            return match.group(1).strip().replace("\\r", "") if match else ""

        # Parse FN (Full Name)
        fn = _get_vcard_field("FN")

        # Parse EMAIL
        email = _get_vcard_field("EMAIL")

        # Parse TEL
        phone = _get_vcard_field("TEL")

        # Parse ORG
        org = _get_vcard_field("ORG")

        # Parse TITLE
        title = _get_vcard_field("TITLE")

        # Parse ADR (address)
        adr_raw = _get_vcard_field("ADR")
        address = ";".join([p.strip() for p in adr_raw.split(";") if p.strip()]) if adr_raw else ""

        # Parse NOTE
        note = _get_vcard_field("NOTE")

        # Parse UID
        uid = _get_vcard_field("UID")

        return {
            "name": fn or "Unknown",
            "email": email or "",
            "phone": phone or "",
            "company": org or "",
            "job_title": title or "",
            "address": address or "",
            "notes": note or "",
            "remote_id": href,  # Use the href as the remote ID for CardDAV
            "uid": uid,
        }

    def _build_vcard(self, contact_data: Dict[str, Any], uid: str) -> str:
        """Build a vCard 3.0 string from contact data."""
        lines = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            f"PRODID:-//Gnosi//CardDAV Sync//EN",
            f"UID:{uid}",
        ]

        name = contact_data.get("name", "")
        if name:
            parts = name.split(" ", 1)
            given = parts[0]
            family = parts[1] if len(parts) > 1 else ""
            lines.append(f"N:{family};{given};;;")
            lines.append(f"FN:{name}")

        email = contact_data.get("email")
        if email:
            lines.append(f"EMAIL;type=INTERNET:{email}")

        phone = contact_data.get("phone")
        if phone:
            lines.append(f"TEL;type=CELL:{phone}")

        company = contact_data.get("company")
        if company:
            lines.append(f"ORG:{company}")

        job_title = contact_data.get("job_title")
        if job_title:
            lines.append(f"TITLE:{job_title}")

        address = contact_data.get("address")
        if address:
            lines.append(f"ADR;type=HOME:;;{address};;;;")

        notes = contact_data.get("notes")
        if notes:
            lines.append(f"NOTE:{notes}")

        # datetime/timezone ja importats al top del mòdul.
        lines.append(f"REV:{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")
        lines.append("END:VCARD")

        return "\r\n".join(lines)

class ContactsSyncEngine:
    def __init__(self, db: Session, workspace_id: str, integration: Dict[str, Any]):
        self.db = db
        self.workspace_id = workspace_id
        self.integration = integration
        self.contacts_service = ContactsService(db, workspace_id)
        
        self.provider = self._get_provider()

    def _get_provider(self) -> Optional[BaseContactsProvider]:
        provider_type = self.integration.get("provider", "google")
        email = self.integration.get("email")
        
        if provider_type == "google":
            return GoogleContactsProvider(email)
        elif provider_type in ["icloud", "carddav", "custom"]:
            return CardDAVContactsProvider(
                url=self.integration.get("url"),
                token=self.integration.get("token"),
                email=email
            )
        return None

    def sync_gnosi_to_remote(self) -> dict:
        """Push local contacts to Remote provider.
        
        Only pushes:
        - Contacts that already have a remote_id (updates to previously synced contacts)
        - Contacts with source='local' that were explicitly created by the user
        
        Skips contacts that match this provider's source but have no remote_id,
        as these were likely imported and should not be re-uploaded.
        """
        results = {"created": 0, "updated": 0, "deleted": 0, "errors": [], "skipped": 0}
        if not self.provider:
            results["errors"].append("No provider configured")
            return results

        try:
            local_contacts = self.contacts_service.list_contacts()
        except Exception as e:
            log.error(f"Error fetching local contacts: {e}")
            results["errors"].append(f"Error fetching local contacts: {e}")
            return results

        provider_name = self.integration.get("provider")
        integration_email = self.integration.get("email")

        # Idempotency: track which contact IDs were successfully pushed in this run
        # so we don't double-count or recommit on partial failures.
        synced_ids: set = set()

        for contact in local_contacts:
            remote_id = contact.google_resource_name

            # Case 1: Contact belongs to a DIFFERENT account → skip
            # Check both the provider name (legacy) and the specific account email
            if contact.source and contact.source not in [provider_name, integration_email, "local"]:
                continue

            # Case 2: Contact belongs to THIS provider/account but has no remote_id
            # This means it was imported previously without tracking → skip push
            if (contact.source == provider_name or contact.source == integration_email) and not remote_id:
                results["skipped"] += 1
                continue

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

                if remote_id:
                    # Update existing remote contact
                    updated = self.provider.update_contact(remote_id, contact_data)
                    if updated:
                        contact.last_synced_at = datetime.now(timezone.utc)
                        # Flush ensures the change is staged for the final commit
                        # without persisting yet (allows atomic rollback on error).
                        self.db.flush()
                        synced_ids.add(contact.id)
                        results["updated"] += 1
                elif contact.source == "local" or contact.source == integration_email:
                    # Case contact.source == integration_email and not remote_id should be skipped above,
                    # but if it reached here, it means we WANT to create it in this account.

                    # Push genuinely new local contact to remote
                    created = self.provider.create_contact(contact_data)
                    if created:
                        parsed = self.provider.parse_to_internal(created)
                        contact.google_resource_name = parsed.get("remote_id")
                        contact.last_synced_at = datetime.now(timezone.utc)
                        # Store the specific account email as source
                        contact.source = integration_email or provider_name
                        self.db.flush()
                        synced_ids.add(contact.id)
                        results["created"] += 1

            except Exception as e:
                log.error(f"Error syncing contact {contact.name}: {e}")
                results["errors"].append(f"Error syncing {contact.name}: {e}")
                # Per-contact failure is non-blocking: continue with the next.
                # The contact is NOT added to synced_ids so it won't be counted.

        # Single commit at the end of the loop with robust rollback.
        # If the commit fails, we revert the in-memory state of all synced contacts
        # and report the error. The remote calls have already happened (cannot be undone)
        # but the DB stays consistent with the previous run's state.
        try:
            self.db.commit()
        except Exception as e:
            log.error(f"Error committing sync_gnosi_to_remote: {e}")
            self.db.rollback()
            results["errors"].append(f"DB commit failed: {e}")
            # Reset counters because the DB state was rolled back: from the
            # caller's point of view nothing was persisted, even though the
            # remote provider already received the changes.
            results["created"] = 0
            results["updated"] = 0

        return results

    def sync_remote_to_gnosi(self) -> dict:
        """Pull contacts from Remote and merge with local."""
        results = {"imported": 0, "updated": 0, "errors": []}
        if not self.provider:
            results["errors"].append("No provider configured")
            return results

        try:
            remote_contacts = self.provider.list_contacts()
        except Exception as e:
            log.error(f"Error fetching remote contacts: {e}")
            results["errors"].append(f"Error fetching remote contacts: {e}")
            return results

        # Track per-iteration result so a final commit failure rolls back counters too.
        pending_imported = 0
        pending_updated = 0

        for remote_person in remote_contacts:
            try:
                parsed = self.provider.parse_to_internal(remote_person)
                remote_id = parsed.get("remote_id")

                if not remote_id:
                    continue

                existing = self.contacts_service.get_contact_by_google_resource(remote_id)
                if not existing:
                    email = parsed.get("email")
                    if email:
                        existing = self.contacts_service.get_contact_by_email(email)

                # NEW: If still not found, try by Name
                if not existing:
                    name = parsed.get("name")
                    if name and name != "Unknown":
                        existing = self.contacts_service.get_contact_by_name(name)

                if existing:
                    # Link existing contact to this remote ID if not already linked
                    if not existing.google_resource_name:
                        existing.google_resource_name = remote_id

                if existing:
                    updated_data = {
                        "name": parsed.get("name", existing.name),
                        "email": parsed.get("email", existing.email),
                        # Fallback a l'existent si el remot OMET la clau (paritat amb
                        # name/email de dalt): un pull CardDAV mai inclou `photo_url`, així
                        # que sense això la foto local es perdia a CADA sincronització.
                        "phone": parsed.get("phone", existing.phone),
                        "company": parsed.get("company", existing.company),
                        "job_title": parsed.get("job_title", existing.job_title),
                        "address": parsed.get("address", existing.address),
                        "notes": parsed.get("notes", existing.notes),
                        "photo_url": parsed.get("photo_url", existing.photo_url),
                    }
                    self.contacts_service.update_contact(existing.id, updated_data)
                    existing.last_synced_at = datetime.now(timezone.utc)
                    pending_updated += 1
                else:
                    self.contacts_service.create_contact(
                        {
                            "name": parsed.get("name", "Unknown"),
                            "email": parsed.get("email", "no-email@placeholder.local"),
                            "phone": parsed.get("phone"),
                            "company": parsed.get("company"),
                            "job_title": parsed.get("job_title"),
                            "address": parsed.get("address"),
                            "notes": parsed.get("notes"),
                            "photo_url": parsed.get("photo_url"),
                            "google_resource_name": remote_id,
                            "source": self.integration.get("email") or self.integration.get("provider"),
                        }
                    )
                    pending_imported += 1

                # Flush per item to surface DB constraint errors early without
                # committing yet. Final commit happens once after the loop.
                self.db.flush()

            except Exception as e:
                log.error(f"Error processing remote contact: {e}")
                results["errors"].append(f"Error processing contact: {e}")
                # Non-blocking: continue with the next remote contact.

        # Single commit at the end of the loop. If it fails, rollback and
        # zero the counters so the caller doesn't believe items were persisted.
        try:
            self.db.commit()
            results["imported"] = pending_imported
            results["updated"] = pending_updated
        except Exception as e:
            log.error(f"Error committing sync_remote_to_gnosi: {e}")
            self.db.rollback()
            results["errors"].append(f"DB commit failed: {e}")

        return results

    def sync_full_bidirectional(self) -> dict:
        """Perform bidirectional sync. Pull first, then push."""
        # Pull remote → local FIRST so we don't re-upload freshly imported contacts
        remote_to_gnosi = self.sync_remote_to_gnosi()
        gnosi_to_remote = self.sync_gnosi_to_remote()

        return {
            "gnosi_to_remote": gnosi_to_remote,
            "remote_to_gnosi": remote_to_gnosi,
            "vault_export": self.export_to_vault(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def export_to_vault(self) -> dict:
        """Export all local contacts for this workspace to the Vault as .contact.md files."""
        results = {"exported": 0, "errors": []}
        
        paths = get_paths()
        contacts_folder = paths.get("CONTACTS")
        
        if not contacts_folder:
            results["errors"].append("CONTACTS folder not defined in paths_config")
            return results

        try:
            contacts_folder.mkdir(parents=True, exist_ok=True)
            local_contacts = self.contacts_service.list_contacts()
            
            for contact in local_contacts:
                try:
                    # Filename: Name.contact.md (sanitize name)
                    clean_name = "".join([c for c in contact.name if c.isalnum() or c in (' ', '-', '_')]).strip()
                    if not clean_name:
                        clean_name = f"Unknown_{contact.id}"
                    
                    filename = f"{clean_name}.contact.md"
                    file_path = contacts_folder / filename
                    
                    metadata = {
                        "name": contact.name,
                        "email": contact.email,
                        "phone": contact.phone,
                        "company": contact.company,
                        "job_title": contact.job_title,
                        "address": contact.address,
                        "source": contact.source,
                        "photo_url": contact.photo_url,
                        "id": contact.id,
                        "uid": contact.id,
                        "type": "contact"
                    }
                    
                    content = f"---\n{yaml.dump(metadata, sort_keys=False, allow_unicode=True)}---\n\n{contact.notes or ''}\n"
                    
                    safe_write_text(file_path, content)
                    results["exported"] += 1
                except Exception as e:
                    results["errors"].append(f"Error exporting {contact.name}: {e}")
            
            log.info(f"Exported {results['exported']} contacts to vault.")
            return results
        except Exception as e:
            log.error(f"Failed to export contacts to vault: {e}")
            results["errors"].append(f"Failed to export contacts to vault: {e}")
            return results

    def delete_contact_from_remote(self, contact_id: str) -> bool:
        """Delete a contact from remote provider."""
        contact = self.contacts_service.get_contact(contact_id)
        if not contact or not self.provider:
            return False

        if contact.google_resource_name:
            success = self.provider.delete_contact(contact.google_resource_name)
            if success:
                contact.google_resource_name = None
                contact.source = ContactSource.LOCAL.value
                try:
                    self.db.commit()
                except Exception as e:
                    log.error(f"Error committing delete_contact_from_remote: {e}")
                    self.db.rollback()
                    return False
            return success

        return True
