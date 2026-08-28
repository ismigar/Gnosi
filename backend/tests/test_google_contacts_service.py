from __future__ import annotations

from typing import Any

import pytest

from backend.services import google_contacts_service


class _Request:
    def __init__(self, payload: Any) -> None:
        self.payload = payload

    def execute(self) -> Any:
        return self.payload


class _People:
    def __init__(self) -> None:
        self.created_body: dict[str, Any] | None = None
        self.deleted_resource = ""

    def connections(self) -> _People:
        return self

    def list(self, **_kwargs: Any) -> _Request:
        return _Request({"connections": [{"resourceName": "people/1"}]})

    def createContact(self, *, body: dict[str, Any]) -> _Request:
        self.created_body = body
        return _Request({"resourceName": "people/2", **body})

    def deleteContact(self, *, resourceName: str) -> _Request:
        self.deleted_resource = resourceName
        return _Request({})


class _Service:
    def __init__(self) -> None:
        self.people_api = _People()

    def people(self) -> _People:
        return self.people_api


def test_list_google_contacts_narrows_connections_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _Service()
    monkeypatch.setattr(
        google_contacts_service,
        "get_google_contacts_service",
        lambda _email: (service, object()),
    )

    assert google_contacts_service.list_google_contacts("user@example.test") == [
        {"resourceName": "people/1"}
    ]


def test_create_google_contact_builds_people_api_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _Service()
    monkeypatch.setattr(
        google_contacts_service,
        "get_google_contacts_service",
        lambda _email: (service, object()),
    )

    created = google_contacts_service.create_google_contact(
        "user@example.test",
        {
            "name": "Ada Lovelace",
            "email": "ada@example.test",
            "company": "Analytical Engines",
            "job_title": "Programmer",
        },
    )

    assert created["resourceName"] == "people/2"
    assert service.people_api.created_body == {
        "names": [{"displayName": "Ada Lovelace"}],
        "emailAddresses": [{"value": "ada@example.test"}],
        "organizations": [
            {"name": "Analytical Engines", "title": "Programmer"}
        ],
    }


def test_parse_google_contact_normalizes_primary_values() -> None:
    parsed = google_contacts_service.parse_google_contact_to_dict(
        {
            "resourceName": "people/1",
            "names": [{"displayName": "Ada Lovelace"}],
            "emailAddresses": [{"value": "ada@example.test"}],
            "phoneNumbers": [{"value": "+34 555"}],
            "organizations": [{"name": "Engines", "title": "Programmer"}],
            "addresses": [{"streetAddress": "First Street"}],
            "biographies": [{"value": "Notes"}],
            "photos": [
                {"url": "secondary"},
                {"url": "primary", "metadata": {"primary": True}},
            ],
            "metadata": {
                "sources": [
                    {"type": "CONTACT", "updateTime": "2026-08-28T10:00:00Z"}
                ]
            },
        }
    )

    assert parsed == {
        "name": "Ada Lovelace",
        "email": "ada@example.test",
        "phone": "+34 555",
        "company": "Engines",
        "job_title": "Programmer",
        "address": "First Street",
        "notes": "Notes",
        "photo_url": "primary",
        "resource_name": "people/1",
        "updated_at": "2026-08-28T10:00:00Z",
    }


def test_delete_google_contact_calls_people_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _Service()
    monkeypatch.setattr(
        google_contacts_service,
        "get_google_contacts_service",
        lambda _email: (service, object()),
    )

    assert google_contacts_service.delete_google_contact(
        "user@example.test", "people/1"
    )
    assert service.people_api.deleted_resource == "people/1"
