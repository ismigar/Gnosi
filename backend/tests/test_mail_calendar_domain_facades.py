"""Focused contract checks for the PR6 mail/calendar modularization."""

import importlib.util
from pathlib import Path
from types import ModuleType

from fastapi.routing import APIRoute

from backend.domains.mail import cache, routing
from backend.services import hybrid_mail_service, imap_mail_sync_service


def _load_mail_facade() -> ModuleType:
    facade_path = Path(__file__).resolve().parents[1] / "api" / "mail_routes.py"
    spec = importlib.util.spec_from_file_location("mail_routes_compat", facade_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


EXPECTED_MAIL_OPERATIONS = {
    ("DELETE", "/drafts/{draft_id}"),
    ("DELETE", "/tags/{tag_id}"),
    ("DELETE", "/views/{view_id}"),
    ("GET", "/counts"),
    ("GET", "/events"),
    ("GET", "/folders"),
    ("GET", "/messages"),
    ("GET", "/messages/{message_id}"),
    ("GET", "/messages/{message_id}/attachments/{att_id:path}"),
    ("GET", "/messages/{message_id}/cid/{cid:path}"),
    ("GET", "/messages/{message_id}/tags"),
    ("GET", "/recipients/suggest"),
    ("GET", "/tags"),
    ("GET", "/tags/{tag_id}/messages"),
    ("GET", "/threads/{thread_id}"),
    ("GET", "/views"),
    ("PATCH", "/accounts/{email:path}/enabled"),
    ("PATCH", "/messages/{message_id}"),
    ("POST", "/ai/extract_entities"),
    ("POST", "/ai/generate_draft"),
    ("POST", "/batch"),
    ("POST", "/drafts"),
    ("POST", "/empty_folder"),
    ("POST", "/messages/{message_id}/archive"),
    ("POST", "/messages/{message_id}/move"),
    ("POST", "/messages/{message_id}/read"),
    ("POST", "/messages/{message_id}/reply"),
    ("POST", "/messages/{message_id}/snooze"),
    ("POST", "/messages/{message_id}/spam"),
    ("POST", "/messages/{message_id}/star"),
    ("POST", "/messages/{message_id}/tags"),
    ("POST", "/messages/{message_id}/trash"),
    ("POST", "/remote-images/fetch"),
    ("POST", "/send"),
    ("POST", "/sync"),
    ("POST", "/tags"),
    ("POST", "/tags/messages/batch"),
    ("POST", "/views"),
    ("PUT", "/tags/{tag_id}"),
    ("PUT", "/views/{view_id}"),
}


def test_mail_facade_preserves_router_and_operation_contract() -> None:
    mail_routes = _load_mail_facade()
    assert mail_routes.router is routing.router
    actual = {
        (method, route.path.removeprefix("/api/mail"))
        for route in routing.router.routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
    }
    assert actual == EXPECTED_MAIL_OPERATIONS


def test_mail_facade_preserves_singletons_and_provider_exports() -> None:
    mail_routes = _load_mail_facade()
    assert mail_routes._MAIL_CACHE is cache._MAIL_CACHE
    assert mail_routes._COUNTS_CACHE is cache._COUNTS_CACHE
    assert hybrid_mail_service._IMAP_POOL is not None
    assert (
        imap_mail_sync_service.imap_sync_service.__class__
        is imap_mail_sync_service.ImapMailSyncService
    )


def test_owned_domain_modules_stay_below_800_lines() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    owned_modules = [backend_dir / "api" / "mail_routes.py"]
    owned_modules.extend((backend_dir / "domains" / "mail").rglob("*.py"))
    owned_modules.extend((backend_dir / "domains" / "calendar").rglob("*.py"))
    oversized = {
        str(path.relative_to(backend_dir)): len(path.read_text(encoding="utf-8").splitlines())
        for path in owned_modules
        if len(path.read_text(encoding="utf-8").splitlines()) > 800
    }
    assert oversized == {}
