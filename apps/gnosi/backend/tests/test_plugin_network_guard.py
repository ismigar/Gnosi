"""Tests for the bounded host-only plugin network capability."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.services.plugin_dispatcher import network_fetch


class _Response:
    def __init__(self, chunks):
        self.status_code = 200
        self.headers = {"Content-Type": "text/plain"}
        self.encoding = "utf-8"
        self._chunks = chunks
        self.closed = False

    def iter_content(self, _chunk_size):
        yield from self._chunks

    def close(self):
        self.closed = True


def test_network_fetch_rejects_private_targets(monkeypatch):
    monkeypatch.setattr(
        "backend.agent.web_context.is_public_http_url",
        lambda _url: (False, "Internal address"),
    )

    with pytest.raises(ValueError, match="Internal address"):
        network_fetch({"url": "http://127.0.0.1/admin"}, "sample-plugin")


def test_network_fetch_bounds_request_metadata(monkeypatch):
    monkeypatch.setattr(
        "backend.agent.web_context.is_public_http_url",
        lambda _url: (True, ""),
    )
    monkeypatch.setattr(
        "requests.request",
        lambda *_args, **_kwargs: SimpleNamespace(),
    )

    with pytest.raises(ValueError, match="unsupported network method"):
        network_fetch({"url": "https://example.test", "opts": {"method": "CONNECT"}}, "sample-plugin")
    with pytest.raises(ValueError, match="header is invalid"):
        network_fetch({
            "url": "https://example.test",
            "opts": {"headers": {"X-Test": "unsafe\r\nInjected: yes"}},
        }, "sample-plugin")
    with pytest.raises(ValueError, match="request body exceeds"):
        network_fetch({
            "url": "https://example.test",
            "opts": {"body": "x" * 1_000_001},
        }, "sample-plugin")


def test_network_fetch_closes_oversized_response(monkeypatch):
    response = _Response([b"a" * 600_000, b"b" * 600_000])
    monkeypatch.setattr(
        "backend.agent.web_context.is_public_http_url",
        lambda _url: (True, ""),
    )
    monkeypatch.setattr("requests.request", lambda *_args, **_kwargs: response)

    with pytest.raises(ValueError, match="response exceeds"):
        network_fetch({"url": "https://example.test"}, "sample-plugin")
    assert response.closed is True
