"""Política de MERGE al pull de contactes (remot → Gnosi).

Regressió del bug de pèrdua silenciosa de dades a
`ContactsSyncEngine.sync_remote_to_gnosi`: quan el contacte remot NO porta un
camp (p. ex. el vCard no té TEL, o la persona de Google no té phoneNumbers), els
dos parsers el retornen com a cadena buida "" (clau PRESENT), no absent. El codi
antic feia `updated_data["phone"] = parsed.get("phone")` → machacava el phone
local a "" a cada sync, perdent dades introduïdes per l'usuari.

El sync és BIDIRECCIONAL (vegeu docs/dev_memory/directives/contacts-sync.md): un
camp remot buit/absent MAI ha de sobreescriure el valor local. El fix usa
`parsed.get(k) or existing.X`, agnòstic al parser (Google i CardDAV).

Test d'integració real: SQLite en memòria + ContactsService real + els providers
REALS (parse_to_internal autèntic); només es mockeja la crida de xarxa list_contacts.
"""
from __future__ import annotations

import os
import tempfile

# El backend fa mkdir del directori de dades a l'import; cal apuntar-lo a scratch
# ABANS d'importar res de `backend.*` (sense això, l'import peta intentant /app).
os.environ.setdefault("GNOSI_LOCAL_DATA", tempfile.mkdtemp(prefix="gnosi-test-contacts-"))

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from backend.data.management_db import Base  # noqa: E402
# Importa els models perquè els mappers (relationship("Workspace")) es configurin.
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
    """Crea un contacte local amb tots els camps omplerts per l'usuari."""
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
    """ContactsSyncEngine real amb la xarxa mockejada (parse_to_internal REAL)."""
    engine = ContactsSyncEngine(db, WS, integration)
    engine.provider.list_contacts = lambda: list(remote_people)
    return engine


# --- Fixtures de dades remotes "pobres" (sense els camps opcionals) -----------

GOOGLE_INTEGRATION = {"provider": "google", "email": "joan@x.example"}
CARDDAV_INTEGRATION = {
    "provider": "carddav",
    "email": "joan@x.example",
    "url": "https://dav.example",
    "token": "tok",
}

# Persona de Google NOMÉS amb nom i email (sense phoneNumbers/organizations/biographies).
GOOGLE_PERSON_BARE = {
    "resourceName": "people/c1",
    "names": [{"displayName": "Joan Prova"}],
    "emailAddresses": [{"value": "joan@x.example"}],
    "metadata": {"sources": [{"type": "CONTACT", "updateTime": "2026-07-05T10:00:00Z"}]},
}

# vCard mínim: FN + EMAIL, sense TEL/ORG/NOTE/ADR (i el parser no inclou photo_url).
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
    """El bug central: remot sense phone/company/notes NO ha de buidar el local."""
    local = _seed_local(db)

    res = _engine_with_fake_remote(db, integration, [remote]).sync_remote_to_gnosi()
    db.refresh(local)

    assert res["errors"] == []
    assert res["updated"] == 1
    # Camps que el remot NO aporta → es preserva el que va introduir l'usuari.
    assert local.phone == LOCAL_PHONE
    assert local.company == LOCAL_COMPANY
    assert local.job_title == "CTO"
    assert local.address == "Carrer Gran 1"
    assert local.notes == LOCAL_NOTES
    assert local.photo_url == LOCAL_PHOTO


def test_carddav_pull_preserves_local_even_with_absent_photo_url_key(db):
    """CardDAV ni tan sols inclou la clau photo_url (None, no ""): també es preserva."""
    local = _seed_local(db)
    parsed = ContactsSyncEngine(db, WS, CARDDAV_INTEGRATION).provider.parse_to_internal(
        CARDDAV_PERSON_BARE
    )
    # Garantim la premissa del test: la clau és realment ABSENT al parser CardDAV.
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
    """No sobre-preservem: si el remot SÍ porta valor, guanya el remot (last-write-wins)."""
    local = _seed_local(db)

    _engine_with_fake_remote(db, integration, [remote]).sync_remote_to_gnosi()
    db.refresh(local)

    assert local.phone == "+34 700 000 000"
    assert local.company == "NouCorp"
    # Els camps que el remot segueix sense portar, es preserven.
    assert local.notes == LOCAL_NOTES


def test_pull_imports_new_contact_when_no_local_match(db):
    """Sanity: el camí de creació (sense contacte local) segueix funcionant."""
    svc = ContactsService(db, WS)
    assert svc.list_contacts() == []

    res = _engine_with_fake_remote(db, GOOGLE_INTEGRATION, [GOOGLE_PERSON_BARE]).sync_remote_to_gnosi()

    assert res["errors"] == []
    assert res["imported"] == 1
    created = svc.get_contact_by_google_resource("people/c1")
    assert created is not None
    assert created.name == "Joan Prova"
    assert created.email == "joan@x.example"
