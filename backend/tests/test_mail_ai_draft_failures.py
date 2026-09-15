import asyncio
import threading

import pytest
from fastapi import HTTPException

from backend.api import mail_routes as _mail_routes  # noqa: F401
from backend.domains.mail import schemas
from backend.domains.mail.routes import compose


def test_draft_provider_runs_off_event_loop(monkeypatch):
    caller = threading.get_ident()

    def provider(prompt):
        assert threading.get_ident() != caller
        return 'Synthetic draft', 'fixture'

    monkeypatch.setattr('pipeline.ai_client.call_ai_with_fallback', provider)
    result = asyncio.run(compose.generate_draft(schemas.MailGenerateDraftRequest(context='fixture')))
    assert result == {'draft': 'Synthetic draft', 'provider': 'fixture'}


def test_draft_failure_is_actionable_and_does_not_leak_provider_error(monkeypatch):
    def provider(prompt):
        raise RuntimeError('private provider details')

    monkeypatch.setattr('pipeline.ai_client.call_ai_with_fallback', provider)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(compose.generate_draft(schemas.MailGenerateDraftRequest(context='fixture')))
    assert caught.value.status_code == 503
    assert 'private' not in caught.value.detail


def test_empty_draft_is_not_success(monkeypatch):
    monkeypatch.setattr('pipeline.ai_client.call_ai_with_fallback', lambda prompt: (' ', 'fixture'))
    with pytest.raises(HTTPException) as caught:
        asyncio.run(compose.generate_draft(schemas.MailGenerateDraftRequest(context='fixture')))
    assert caught.value.status_code == 502
