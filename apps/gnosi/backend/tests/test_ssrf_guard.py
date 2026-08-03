"""Tests for the SSRF guard in vault_routes._is_safe_external_url.

These cover the scenarios that prompted the fix:
    - Cloud metadata IPs (169.254.169.254)
    - Loopback (127.0.0.1, ::1)
    - RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
    - Docker-internal services by IP
    - Hostnames that resolve to private IPs ('localhost')

Public IPs and HTTPS CDN-style URLs must pass through.
"""
from __future__ import annotations

import socket

import pytest

from backend.api.vault_routes import _is_safe_external_url


# --- Should be REJECTED ----------------------------------------------------

@pytest.mark.parametrize("url", [
    "http://127.0.0.1/icon.png",
    "http://127.1.2.3/icon.png",
    "http://localhost/icon.png",
    "http://10.0.0.5/icon.png",
    "http://192.168.1.1/icon.png",
    "http://172.16.5.5/icon.png",
    "http://169.254.169.254/latest/meta-data/",  # AWS metadata
    "http://0.0.0.0/icon.png",
    "http://[::1]/icon.png",
])
def test_blocks_private_and_loopback(url):
    ok, reason = _is_safe_external_url(url)
    assert ok is False, f"expected to block {url} but got pass ({reason})"


def test_blocks_non_http_scheme():
    for url in ["file:///etc/passwd", "ftp://example.com/", "gopher://x"]:
        ok, _ = _is_safe_external_url(url)
        assert ok is False, f"expected to block {url}"


def test_blocks_unparseable_url():
    ok, _ = _is_safe_external_url("not a url at all")
    assert ok is False


def test_blocks_url_without_host():
    ok, _ = _is_safe_external_url("http:///nohost")
    assert ok is False


# --- Should be ACCEPTED ----------------------------------------------------

def test_allows_public_https_url(monkeypatch):
    """Mock DNS so the test isn't network-dependent: example.com → 93.184.216.34"""
    def fake_getaddrinfo(host, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))]
    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    ok, reason = _is_safe_external_url("https://example.com/icon.png")
    assert ok is True, f"expected pass; got: {reason}"


def test_dns_failure_is_treated_as_block(monkeypatch):
    """If DNS can't resolve the host, refuse the fetch."""
    def fail(host, *args, **kwargs):
        raise socket.gaierror("simulated dns failure")
    monkeypatch.setattr(socket, "getaddrinfo", fail)
    ok, _ = _is_safe_external_url("http://this-will-not-resolve.invalid/")
    assert ok is False


def test_metadata_hostname_resolves_to_private_ip(monkeypatch):
    """A friendly hostname ('metadata.google.internal') still resolves to a
    private IP — the guard must reject it."""
    def fake(host, *args, **kwargs):
        # All map to AWS metadata IP
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("169.254.169.254", 0))]
    monkeypatch.setattr(socket, "getaddrinfo", fake)
    ok, reason = _is_safe_external_url("http://metadata.google.internal/latest/")
    assert ok is False
    assert "non-public" in reason.lower() or "169.254" in reason
