"""Provider-neutral integration configuration contract."""

from fastapi.routing import APIRoute

from backend.api import integrations_routes
from backend.domains.integrations.contracts import IntegrationsDocument


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
