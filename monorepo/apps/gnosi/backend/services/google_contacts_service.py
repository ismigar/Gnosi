import logging
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from backend.config.app_config import load_params

log = logging.getLogger(__name__)


def get_google_contacts_service(email: str):
    """Helper to get a Google People service for a given email."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        log.error("Falten dependències: google-api-python-client, google-auth-oauthlib")
        return None, None

    cfg = load_params(strict_env=False)
    integrations_file = cfg.paths["SECRETS"] / "integrations.json"

    if not integrations_file.exists():
        log.error("No es troba integrations.json.")
        return None, None

    try:
        data = json.loads(integrations_file.read_text(encoding="utf-8"))
    except Exception as e:
        log.error(f"Failed to read integrations.json: {e}")
        return None, None

    from backend.config.env_config import get_env

    contacts_config = None
    for contact in data.get("contacts", []):
        if contact.get("provider") == "google" and contact.get("auth_type") == "oauth2":
            contact_email = contact.get("email", contact.get("username", ""))
            if contact_email == email:
                contacts_config = contact
                break

    if not contacts_config:
        for cal in data.get("calendars", []):
            if cal.get("provider") == "google" and cal.get("auth_type") == "oauth2":
                cal_email = cal.get("email", cal.get("username", ""))
                if cal_email == email:
                    contacts_config = {
                        "token": cal.get("token"),
                        "refresh_token": cal.get("refresh_token"),
                        "token_uri": cal.get(
                            "token_uri", "https://oauth2.googleapis.com/token"
                        ),
                        "client_id": cal.get("client_id")
                        or get_env("GOOGLE_OAUTH_CLIENT_ID"),
                        "client_secret": cal.get("client_secret")
                        or get_env("GOOGLE_OAUTH_CLIENT_SECRET"),
                    }
                    break

    if not contacts_config:
        log.error(f"No es troba configuració de contacts per a {email}")
        return None, None

    try:
        client_id = contacts_config.get("client_id") or get_env(
            "GOOGLE_OAUTH_CLIENT_ID"
        )
        client_secret = contacts_config.get("client_secret") or get_env(
            "GOOGLE_OAUTH_CLIENT_SECRET"
        )

        if not client_id or not client_secret:
            log.error(f"Missing OAuth client credentials for {email}")
            return None, None

        creds_dict = {
            "token": contacts_config.get("token"),
            "refresh_token": contacts_config.get("refresh_token"),
            "token_uri": contacts_config.get(
                "token_uri", "https://oauth2.googleapis.com/token"
            ),
            "client_id": client_id,
            "client_secret": client_secret,
        }
        creds = Credentials(**creds_dict)
        service = build("peopleService", "v1", credentials=creds)
        return service, creds
    except Exception as e:
        log.error(f"Error building contacts service for {email}: {e}")
        return None, None


def list_google_contacts(email: str, page_size: int = 200):
    """Lists all contacts from Google People API."""
    service, _ = get_google_contacts_service(email)
    if not service:
        return []

    try:
        results = (
            service.people()
            .connections()
            .list(
                resourceName="people/me",
                pageSize=page_size,
                personFields="names,emailAddresses,phoneNumbers,organizations,addresses,notes,metadata",
            )
            .execute()
        )
        return results.get("connections", [])
    except Exception as e:
        log.error(f"Error listing Google contacts for {email}: {e}")
        return []


def get_google_contact_by_resource(email: str, resource_name: str):
    """Gets a single contact by Google resource name."""
    service, _ = get_google_contacts_service(email)
    if not service:
        return None

    try:
        person = (
            service.people()
            .get(
                resourceName=resource_name,
                personFields="names,emailAddresses,phoneNumbers,organizations,addresses,notes,metadata",
            )
            .execute()
        )
        return person
    except Exception as e:
        log.error(f"Error getting Google contact {resource_name}: {e}")
        return None


def create_google_contact(email: str, contact_data: dict):
    """Creates a new contact in Google People API."""
    service, _ = get_google_contacts_service(email)
    if not service:
        return None

    try:
        body = {
            "names": [{"displayName": contact_data.get("name", "")}],
        }

        if contact_data.get("email"):
            body["emailAddresses"] = [{"value": contact_data["email"]}]

        if contact_data.get("phone"):
            body["phoneNumbers"] = [{"value": contact_data["phone"]}]

        if contact_data.get("company") or contact_data.get("job_title"):
            body["organizations"] = [
                {
                    "name": contact_data.get("company", ""),
                    "title": contact_data.get("job_title", ""),
                }
            ]

        if contact_data.get("address"):
            body["addresses"] = [{"streetAddress": contact_data["address"]}]

        if contact_data.get("notes"):
            body["notes"] = {"notes": [{"content": contact_data["notes"]}]}

        created = service.people().createContact(body=body).execute()
        return created
    except Exception as e:
        log.error(f"Error creating Google contact: {e}")
        return None


def update_google_contact(email: str, resource_name: str, contact_data: dict):
    """Updates an existing contact in Google People API."""
    service, _ = get_google_contacts_service(email)
    if not service:
        return None

    try:
        body = {"names": [{"displayName": contact_data.get("name", "")}]}

        if "email" in contact_data:
            body["emailAddresses"] = [{"value": contact_data["email"]}]

        if "phone" in contact_data:
            body["phoneNumbers"] = [{"value": contact_data["phone"]}]

        if "company" in contact_data or "job_title" in contact_data:
            body["organizations"] = [
                {
                    "name": contact_data.get("company", ""),
                    "title": contact_data.get("job_title", ""),
                }
            ]

        if "address" in contact_data:
            body["addresses"] = [{"streetAddress": contact_data["address"]}]

        if "notes" in contact_data:
            body["notes"] = {"notes": [{"content": contact_data["notes"]}]}

        updated = (
            service.people()
            .updateContact(resourceName=resource_name, body=body)
            .execute()
        )
        return updated
    except Exception as e:
        log.error(f"Error updating Google contact {resource_name}: {e}")
        return None


def delete_google_contact(email: str, resource_name: str) -> bool:
    """Deletes a contact from Google People API."""
    service, _ = get_google_contacts_service(email)
    if not service:
        return False

    try:
        service.people().deleteContact(resourceName=resource_name).execute()
        return True
    except Exception as e:
        log.error(f"Error deleting Google contact {resource_name}: {e}")
        return False


def parse_google_contact_to_dict(person: dict) -> dict:
    """Parse a Google People person object to a normalized dict."""
    parsed = {
        "name": "",
        "email": "",
        "phone": "",
        "company": "",
        "job_title": "",
        "address": "",
        "notes": "",
        "resource_name": person.get("resourceName", ""),
    }

    names = person.get("names", [])
    if names:
        parsed["name"] = names[0].get("displayName", names[0].get("givenName", ""))

    emails = person.get("emailAddresses", [])
    if emails:
        parsed["email"] = emails[0].get("value", "")

    phones = person.get("phoneNumbers", [])
    if phones:
        parsed["phone"] = phones[0].get("value", "")

    orgs = person.get("organizations", [])
    if orgs:
        parsed["company"] = orgs[0].get("name", "")
        parsed["job_title"] = orgs[0].get("title", "")

    addrs = person.get("addresses", [])
    if addrs:
        parsed["address"] = addrs[0].get("streetAddress", "")

    notes_list = person.get("notes", {}).get("notes", [])
    if notes_list:
        parsed["notes"] = notes_list[0].get("content", "")

    metadata = person.get("metadata", {})
    sources = metadata.get("sources", [])
    if sources:
        for source in sources:
            if source.get("type") == "CONTACT":
                parsed["updated_at"] = source.get("updateTime", "")
                break

    return parsed
