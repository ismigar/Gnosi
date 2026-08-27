"""MERGE policy on contacts pull (remote → Gnosi).

Regression of the silent data-loss bug in
`ContactsSyncEngine.sync_remote_to_gnosi`: when the remote contact does NOT carry a
field (e.g. the vCard has no TEL, or the Google person has no phoneNumbers), both
parsers return it as an empty string "" (key PRESENT), not absent. The old
code did `updated_data["phone"] = parsed.get("phone")` → it clobbered the local
phone to "" on every sync, losing data entered by the user.

The sync is BIDIRECTIONAL (see docs/dev_memory/directives/contacts-sync.md): an
empty/absent remote field must NEVER overwrite the local value. The fix uses
`parsed.get(k) or existing.X`, parser-agnostic (Google and CardDAV).

Real integration test: in-memory SQLite + real ContactsService + the REAL
providers (authentic parse_to_internal); only the list_contacts network call is mocked.
"""
from __future__ import annotations

import os
import tempfile

# The backend does mkdir on the data directory at import time; it must be pointed at scratch
# BEFORE importing anything from `backend.*` (without this, the import crashes trying /app).
os.environ.setdefault("GNOSI_DATA_DIR", tempfile.mkdtemp(prefix="gnosi-test-contacts-"))

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from backend.data.management_db import Base  # noqa: E402
# Import the models so the mappers (relationship("Workspace")) get configured.
import backend.models.contact  # noqa: E402,F401
import backend.models.management  # noqa: E402,F401  (Workspace)
from backend.services.contacts_service import ContactsService  # noqa: E402
from backend.services.contacts_sync_engine import ContactsSyncEngine  # noqa: E402

WS = "ws-test"
LOCAL_PHONE = "+34 600 111 222"
LOCAL_COMPANY = "ACME"
LOCAL_NOTES = "nota local de l'usuari"
LOCAL_PHOTO = "/vault/Assets/joan.png"


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _seed_local(db, **overrides):
    """Create a local contact with all fields filled in by the user."""
    svc = ContactsService(db, WS)
    data = {
        "name": "Joan Prova",
        "email": "joan@x.example",
        "phone": LOCAL_PHONE,
        "company": LOCAL_COMPANY,
        "job_title": "CTO",
        "address": "Carrer Gran 1",
        "notes": LOCAL_NOTES,
        "photo_url": LOCAL_PHOTO,
        "source": "local",
    }
    data.update(overrides)
    return svc.create_contact(data)


def _engine_with_fake_remote(db, integration, remote_people):
    """Real ContactsSyncEngine with the network mocked (REAL parse_to_internal)."""
    engine = ContactsSyncEngine(db, WS, integration)
    engine.provider.list_contacts = lambda: list(remote_people)
    return engine


# --- Fixtures for "poor" remote data (without the optional fields) -----------

GOOGLE_INTEGRATION = {"provider": "google", "email": "joan@x.example"}
CARDDAV_INTEGRATION = {
    "provider": "carddav",
    "email": "joan@x.example",
    "url": "https://dav.example",
    "token": "tok",
}

# Google person with ONLY name and email (no phoneNumbers/organizations/biographies).
GOOGLE_PERSON_BARE = {
    "resourceName": "people/c1",
    "names": [{"displayName": "Joan Prova"}],
    "emailAddresses": [{"value": "joan@x.example"}],
    "metadata": {"sources": [{"type": "CONTACT", "updateTime": "2026-07-05T10:00:00Z"}]},
}

# Minimal vCard: FN + EMAIL, no TEL/ORG/NOTE/ADR (and the parser doesn't include photo_url).
CARDDAV_PERSON_BARE = {
    "href": "/c/1.vcf",
    "etag": "e1",
    "vcard": "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c1\r\nFN:Joan Prova\r\nEMAIL:joan@x.example\r\nEND:VCARD",
}


@pytest.mark.parametrize(
    "integration,remote",
    [
        pytest.param(GOOGLE_INTEGRATION, GOOGLE_PERSON_BARE, id="google"),
        pytest.param(CARDDAV_INTEGRATION, CARDDAV_PERSON_BARE, id="carddav"),
    ],
)
def test_pull_preserves_local_when_remote_field_empty(db, integration, remote):
    """The core bug: remote without phone/company/notes must NOT wipe out the local data."""
    local = _seed_local(db)

    res = _engine_with_fake_remote(db, integration, [remote]).sync_remote_to_gnosi()
    db.refresh(local)

    assert res["errors"] == []
    assert res["updated"] == 1
    # Fields that the remote does NOT provide → what the user entered is preserved.
    assert local.phone == LOCAL_PHONE
    assert local.company == LOCAL_COMPANY
    assert local.job_title == "CTO"
    assert local.address == "Carrer Gran 1"
    assert local.notes == LOCAL_NOTES
    assert local.photo_url == LOCAL_PHOTO


def test_carddav_pull_preserves_local_even_with_absent_photo_url_key(db):
    """CardDAV doesn't even include the photo_url key (None, not ""): it's preserved too."""
    local = _seed_local(db)
    parsed = ContactsSyncEngine(db, WS, CARDDAV_INTEGRATION).provider.parse_to_internal(
        CARDDAV_PERSON_BARE
    )
    # We guarantee the test's premise: the key is truly ABSENT in the CardDAV parser.
    assert "photo_url" not in parsed

    _engine_with_fake_remote(db, CARDDAV_INTEGRATION, [CARDDAV_PERSON_BARE]).sync_remote_to_gnosi()
    db.refresh(local)
    assert local.photo_url == LOCAL_PHOTO


@pytest.mark.parametrize(
    "integration,remote",
    [
        pytest.param(
            GOOGLE_INTEGRATION,
            {
                **GOOGLE_PERSON_BARE,
                "phoneNumbers": [{"value": "+34 700 000 000"}],
                "organizations": [{"name": "NouCorp", "title": "CEO"}],
            },
            id="google",
        ),
        pytest.param(
            CARDDAV_INTEGRATION,
            {
                "href": "/c/1.vcf",
                "etag": "e2",
                "vcard": (
                    "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c1\r\nFN:Joan Prova\r\n"
                    "EMAIL:joan@x.example\r\nTEL;type=CELL:+34 700 000 000\r\n"
                    "ORG:NouCorp\r\nEND:VCARD"
                ),
            },
            id="carddav",
        ),
    ],
)
def test_pull_applies_remote_value_when_present(db, integration, remote):
    """We don't over-preserve: if the remote DOES carry a value, the remote wins (last-write-wins)."""
    local = _seed_local(db)

    _engine_with_fake_remote(db, integration, [remote]).sync_remote_to_gnosi()
    db.refresh(local)

    assert local.phone == "+34 700 000 000"
    assert local.company == "NouCorp"
    # Fields that the remote still doesn't carry are preserved.
    assert local.notes == LOCAL_NOTES


def test_pull_imports_new_contact_when_no_local_match(db):
    """Sanity: the creation path (no local contact) still works."""
    svc = ContactsService(db, WS)
    assert svc.list_contacts() == []

    res = _engine_with_fake_remote(db, GOOGLE_INTEGRATION, [GOOGLE_PERSON_BARE]).sync_remote_to_gnosi()

    assert res["errors"] == []
    assert res["imported"] == 1
    created = svc.get_contact_by_google_resource("people/c1")
    assert created is not None
    assert created.name == "Joan Prova"
    assert created.email == "joan@x.example"
