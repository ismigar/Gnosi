import logging
from collections.abc import Callable
from typing import Any, TypeAlias, cast

import requests

from backend.services.integration_manager import integration_manager

log = logging.getLogger(__name__)

Contact: TypeAlias = dict[str, Any]


def get_google_contacts_service(email: str) -> tuple[Any | None, Any | None]:
    """Helper to get a Google People service for a given email."""
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        log.error("Missing dependencies: google-api-python-client, google-auth-oauthlib")
        return None, None

    from backend.config.env_config import get_env

    # Use integration_manager to get the raw data
    all_contacts = integration_manager.get_raw("contacts")
    contacts_config = None
    source_type = "contacts"
    
    for contact in all_contacts:
        if contact.get("provider") == "google" and contact.get("auth_type") == "oauth2":
            contact_email = contact.get("email", contact.get("username", ""))
            if contact_email == email:
                contacts_config = contact
                break

    if not contacts_config:
        source_type = "calendars"
        all_calendars = integration_manager.get_raw("calendars")
        for cal in all_calendars:
            if cal.get("provider") == "google" and cal.get("auth_type") == "oauth2":
                cal_email = cal.get("email", cal.get("username", ""))
                if cal_email == email:
                    contacts_config = {
                        "id": cal.get("id"),
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
        log.error("Contacts configuration not found for %s", email)
        return None, None

    try:
        client_id = contacts_config.get("client_id") or get_env(
            "GOOGLE_OAUTH_CLIENT_ID"
        )
        client_secret = contacts_config.get("client_secret") or get_env(
            "GOOGLE_OAUTH_CLIENT_SECRET"
        )

        if not client_id or not client_secret:
            log.error("Missing OAuth client credentials for %s", email)
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
        credentials_factory = cast(Callable[..., Any], Credentials)
        creds: Any = credentials_factory(**creds_dict)
        
        # Refresh token if expired
        if creds.expired and creds.refresh_token:
            log.info("Refreshing the Google token for %s", email)
            try:
                request_factory = cast(Callable[[], Any], Request)
                creds.refresh(request_factory())
                # Save updated token back via integration_manager
                integration_manager.update(source_type, [{
                    "id": contacts_config.get("id"),
                    "token": creds.token
                }])
                log.info("Google token updated through integration_manager")
            except Exception as exc:
                log.error("Error refreshing token for %s: %s", email, exc)
                return None, None
        elif creds.expired and not creds.refresh_token:
            log.error("Token expired and no refresh_token is available for %s", email)
            return None, None

        service = build("people", "v1", credentials=creds, static_discovery=False)
        return service, creds
    except Exception as exc:
        log.error("Error building contacts service for %s: %s", email, exc)
        return None, None


def list_google_contacts(email: str, page_size: int = 200) -> list[Contact]:
    """Lists all contacts from Google People API."""
    service, _ = get_google_contacts_service(email)
    if not service:
        raise Exception(f"Could not initialize the Google service for {email}")

    try:
        results = (
            service.people()
            .connections()
            .list(
                resourceName="people/me",
                pageSize=page_size,
                personFields="names,emailAddresses,phoneNumbers,organizations,addresses,biographies,metadata,photos",
            )
            .execute()
        )
        connections = results.get("connections", [])
        return cast(list[Contact], connections) if isinstance(connections, list) else []
    except Exception as exc:
        log.error("Error listing Google contacts for %s: %s", email, exc)
        raise


def get_google_contact_by_resource(email: str, resource_name: str) -> Contact | None:
    """Gets a single contact by Google resource name."""
    service, _ = get_google_contacts_service(email)
    if not service:
        return None

    try:
        person = (
            service.people()
            .get(
                resourceName=resource_name,
                personFields="names,emailAddresses,phoneNumbers,organizations,addresses,biographies,metadata,photos",
            )
            .execute()
        )
        return cast(Contact, person) if isinstance(person, dict) else None
    except Exception as exc:
        log.error("Error getting Google contact %s: %s", resource_name, exc)
        return None


def create_google_contact(email: str, contact_data: Contact) -> Contact:
    """Creates a new contact in Google People API."""
    service, _ = get_google_contacts_service(email)
    if not service:
        raise Exception("Could not initialize the Google service")

    try:
        body: Contact = {
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

        if contact_data.get("notes"):
            body["biographies"] = [
                {"value": contact_data["notes"], "contentType": "TEXT_PLAIN"}
            ]

        if contact_data.get("address"):
            body["addresses"] = [{"streetAddress": contact_data["address"]}]

        if contact_data.get("notes"):
            body["notes"] = {"notes": [{"content": contact_data["notes"]}]}

        created = service.people().createContact(body=body).execute()
        return cast(Contact, created)
    except Exception as exc:
        log.error("Error creating Google contact: %s", exc)
        raise


def update_google_contact(
    email: str,
    resource_name: str,
    contact_data: Contact,
) -> Contact:
    """Updates an existing contact in Google People API."""
    service, creds = get_google_contacts_service(email)
    if not service or not creds:
        raise Exception("Could not initialize the Google service")

    try:
        # Fetch the contact first to get the current ETAG (needed for the update)
        current_person = get_google_contact_by_resource(email, resource_name)
        if not current_person:
            raise Exception(f"Contact {resource_name} was not found in Google while retrieving the ETAG")

        etag = current_person.get("etag")
        
        body: Contact = {
            "etag": etag,
            "names": [{"displayName": contact_data.get("name", "")}]
        }

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
            body["biographies"] = [
                {"value": contact_data["notes"], "contentType": "TEXT_PLAIN"}
            ]

        # Make sure the token is fresh
        from google.auth.transport.requests import Request as AuthRequest
        if creds.expired and creds.refresh_token:
            log.info("Refreshing the Google token for %s before PATCH", email)
            request_factory = cast(Callable[[], Any], AuthRequest)
            creds.refresh(request_factory())
            # Optionally persist the token (the next list call will already do it)
        
        # Use direct requests to avoid library syntax issues with updateMask
        update_mask = "names,emailAddresses,phoneNumbers,organizations,addresses,biographies"
        url = f"https://people.googleapis.com/v1/{resource_name}:updateContact?updateMask={update_mask}"
        
        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json",
        }
        
        response = requests.patch(url, headers=headers, json=body, timeout=30)

        if response.status_code != 200:
            log.error("Error direct patching Google contact: %s", response.text)
            response.raise_for_status()
            
        payload: Any = response.json()
        return cast(Contact, payload) if isinstance(payload, dict) else {}
    except Exception as exc:
        log.error("Error updating Google contact %s: %s", resource_name, exc)
        raise


def delete_google_contact(email: str, resource_name: str) -> bool:
    """Deletes a contact from Google People API."""
    service, _ = get_google_contacts_service(email)
    if not service:
        raise Exception("Could not initialize the Google service")

    try:
        service.people().deleteContact(resourceName=resource_name).execute()
        return True
    except Exception as exc:
        log.error("Error deleting Google contact %s: %s", resource_name, exc)
        raise


def parse_google_contact_to_dict(person: Contact) -> Contact:
    """Parse a Google People person object to a normalized dict."""
    parsed: Contact = {
        "name": "",
        "email": "",
        "phone": "",
        "company": "",
        "job_title": "",
        "address": "",
        "notes": "",
        "photo_url": "",
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

    biographies = person.get("biographies", [])
    if biographies:
        parsed["notes"] = biographies[0].get("value", "")

    addrs = person.get("addresses", [])
    if addrs:
        parsed["address"] = addrs[0].get("streetAddress", "")

    photos = person.get("photos", [])
    if photos:
        # Get the primary photo or the first one available
        primary_photo = next((p for p in photos if p.get("metadata", {}).get("primary")), photos[0])
        parsed["photo_url"] = primary_photo.get("url", "")


    metadata = person.get("metadata", {})
    sources = metadata.get("sources", [])
    if sources:
        for source in sources:
            if source.get("type") == "CONTACT":
                parsed["updated_at"] = source.get("updateTime", "")
                break

    return parsed
