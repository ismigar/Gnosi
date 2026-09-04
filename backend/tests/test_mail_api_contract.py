"""Typed OpenAPI and payload-preservation contract for the Mail domain."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.responses import Response, StreamingResponse
from fastapi.routing import APIRoute

from backend.api import mail_routes
from backend.domains.mail import schemas


SPECIALIZED_RESPONSES = {
    ("GET", "/api/mail/events"),
    ("GET", "/api/mail/messages/{message_id}/attachments/{att_id:path}"),
    ("GET", "/api/mail/messages/{message_id}/cid/{cid:path}"),
    ("POST", "/api/mail/remote-images/fetch"),
}
NO_CONTENT_RESPONSES = {
    ("DELETE", "/api/mail/tags/{tag_id}"),
    ("DELETE", "/api/mail/views/{view_id}"),
}
JSON_REQUEST_MODELS = {
    ("PATCH", "/api/mail/messages/{message_id}"): "MailMessageUpdateRequest",
    ("POST", "/api/mail/messages/{message_id}/star"): "MailStarRequest",
    ("POST", "/api/mail/messages/{message_id}/spam"): "MailSpamRequest",
    ("POST", "/api/mail/drafts"): "MailDraftSaveRequest",
    ("POST", "/api/mail/messages/{message_id}/move"): "MailMoveRequest",
    ("POST", "/api/mail/batch"): "MailBatchRequest",
    ("POST", "/api/mail/messages/{message_id}/snooze"): "MailSnoozeRequest",
    ("POST", "/api/mail/ai/generate_draft"): "MailGenerateDraftRequest",
    ("POST", "/api/mail/ai/extract_entities"): "MailExtractEntitiesRequest",
    ("POST", "/api/mail/remote-images/fetch"): "RemoteMailImageRequest",
    ("POST", "/api/mail/views"): "MailViewCreateSchema",
    ("PUT", "/api/mail/views/{view_id}"): "MailViewUpdateSchema",
    ("PATCH", "/api/mail/accounts/{email:path}/enabled"): ("MailAccountEnabledRequest"),
    ("POST", "/api/mail/tags"): "MailTagCreateSchema",
    ("PUT", "/api/mail/tags/{tag_id}"): "MailTagUpdateSchema",
    ("POST", "/api/mail/messages/{message_id}/tags"): ("MailMessageTagsSetSchema"),
    ("POST", "/api/mail/tags/messages/batch"): "MailTagsBatchRequest",
}
NON_DEFAULT_SUCCESS_CODES = {
    ("POST", "/api/mail/tags"): 201,
    ("POST", "/api/mail/views"): 201,
    ("DELETE", "/api/mail/tags/{tag_id}"): 204,
    ("DELETE", "/api/mail/views/{view_id}"): 204,
}


def _api_routes() -> list[APIRoute]:
    return [route for route in mail_routes.router.routes if isinstance(route, APIRoute)]


def _focused_openapi() -> dict[str, Any]:
    app = FastAPI()
    app.include_router(mail_routes.router)
    return app.openapi()


def _route(method: str, path: str) -> APIRoute:
    return next(
        route
        for route in _api_routes()
        if route.path == path and method in (route.methods or set())
    )


def test_mail_json_routes_all_have_concrete_response_models() -> None:
    routes = _api_routes()

    assert len(routes) == 40
    for route in routes:
        for method in route.methods or set():
            operation = (method, route.path)
            assert (route.status_code or 200) == NON_DEFAULT_SUCCESS_CODES.get(
                operation,
                200,
            )
            if operation in SPECIALIZED_RESPONSES | NO_CONTENT_RESPONSES:
                assert route.response_model is None
            else:
                assert route.response_model is not None, operation

    events = _route("GET", "/api/mail/events")
    attachment = _route(
        "GET",
        "/api/mail/messages/{message_id}/attachments/{att_id:path}",
    )
    cid = _route("GET", "/api/mail/messages/{message_id}/cid/{cid:path}")
    remote_image = _route("POST", "/api/mail/remote-images/fetch")

    assert events.response_class is StreamingResponse
    assert attachment.response_class is Response
    assert cid.response_class is Response
    assert remote_image.response_class is Response


def test_mail_openapi_types_every_json_response_and_request_body() -> None:
    openapi = _focused_openapi()
    paths = openapi["paths"]

    for route in _api_routes():
        for method in route.methods or set():
            operation_key = (method, route.path)
            operation = paths[route.path_format][method.lower()]
            success_code = str(route.status_code or 200)
            response = operation["responses"][success_code]

            if operation_key in SPECIALIZED_RESPONSES:
                assert "application/json" not in response.get("content", {})
                continue
            if operation_key in NO_CONTENT_RESPONSES:
                assert "content" not in response
                continue

            schema = response["content"]["application/json"]["schema"]
            assert schema, operation_key

    for (method, path), model_name in JSON_REQUEST_MODELS.items():
        route = _route(method, path)
        operation = paths[route.path_format][method.lower()]
        request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
        assert request_schema == {"$ref": f"#/components/schemas/{model_name}"}


def test_mail_provider_and_short_variants_serialize_without_contract_drift() -> None:
    message_payload = {
        "id": "imap_42",
        "thread_id": "thread-42",
        "subject": "Contract",
        "sender": "sender@example.test",
        "recipient": "reader@example.test",
        "date": "2026-08-29T12:00:00+00:00",
        "timestamp": 1788004800,
        "is_read": False,
        "is_starred": True,
        "has_attachments": False,
        "source": "imap",
        "provider_extension": {"label": "retained"},
    }
    page_payload = {
        "messages": [message_payload],
        "next_page_token": None,
        "total": 1,
    }

    page = schemas.MailMessagesResponse.model_validate(page_payload)
    empty_entities = schemas.MailExtractEntitiesResponse.model_validate(
        {"events": [], "contacts": []}
    )
    update = schemas.MailMessageUpdateRequest.model_validate(
        {"is_read": True, "provider_flag": "preserved"}
    )

    assert page.model_dump(exclude_unset=True) == page_payload
    assert empty_entities.model_dump(exclude_unset=True) == {
        "events": [],
        "contacts": [],
    }
    assert update.model_dump(exclude_unset=True) == {
        "is_read": True,
        "provider_flag": "preserved",
    }
