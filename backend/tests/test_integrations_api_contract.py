"""Provider-neutral integration configuration contract."""

from fastapi.routing import APIRoute

from backend.api import integrations_routes
from backend.domains.integrations.contracts import IntegrationsDocument
from backend.domains.integrations.contracts import (
    CalendarSelectionRequest,
    DavConnectionTestRequest,
    EmailConnectionTestRequest,
    IntegrationConnectionTestResponse,
    IntegrationUpdateResponse,
    IntegrationsUpdateRequest,
)


def test_integrations_document_accepts_multiple_provider_shapes() -> None:
    document = IntegrationsDocument(
        root={
            "mail_accounts": [{"provider": "imap", "email": "mail@example.test"}],
            "contacts": [{"provider": "nextcloud", "server_url": "https://cloud.test"}],
            "storage": [{"provider": "google_drive", "enabled": True}],
        }
    )
    assert len(document.root) == 3


def test_integrations_get_route_publishes_the_masked_document_contract() -> None:
    route = next(
        route
        for route in integrations_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == "get_integrations"
    )
    assert route.response_model is IntegrationsDocument


def test_integration_mutations_publish_one_acknowledgement_contract() -> None:
    target_handlers = {
        "update_integration",
        "update_calendar_colors",
        "update_calendar_aliases",
        "update_calendar_selection",
        "update_default_calendar",
        "update_default_mail",
        "update_default_contacts",
        "bulk_update_integrations",
    }
    routes = [
        route
        for route in integrations_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in target_handlers
    ]
    assert len(routes) == len(target_handlers)
    assert all(route.response_model is IntegrationUpdateResponse for route in routes)


def test_open_provider_updates_and_legacy_calendar_selection_remain_valid() -> None:
    update = IntegrationsUpdateRequest(
        root={"contacts": [{"provider": "carddav", "enabled": True}]}
    )
    assert "contacts" in update.root
    assert CalendarSelectionRequest(root={"selection": ["calendar-a"]}).root == {
        "selection": ["calendar-a"]
    }


def test_connection_tests_publish_typed_secret_input_and_safe_output() -> None:
    routes = [
        route
        for route in integrations_routes.router.routes
        if isinstance(route, APIRoute)
        and route.endpoint.__name__
        in {
            "test_email_connection",
            "test_contacts_connection",
            "test_calendar_connection",
        }
    ]
    assert len(routes) == 3
    assert all(
        route.response_model is IntegrationConnectionTestResponse for route in routes
    )

    email = EmailConnectionTestRequest(
        imap_server="imap.example.test",
        smtp_server="smtp.example.test",
        username="mail@example.test",
        password="secret",
    )
    dav = DavConnectionTestRequest(
        url="https://cloud.example.test/dav",
        username="user",
        password="secret",
    )
    assert email.password == "secret"
    assert dav.url == "https://cloud.example.test/dav"
