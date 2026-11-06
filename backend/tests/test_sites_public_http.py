"""Public website reads must validate every hop and pin the actual connection."""
import io
import gzip
import socket
import time
import zlib
from types import SimpleNamespace

import pytest

from backend.domains.sites import public_http as http


def dns(address):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "https://user:pass@example.org/", "file:///etc/passwd", "http://example.org\\@127.0.0.1/"])
def test_private_and_credential_targets_are_blocked(monkeypatch, url):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("127.0.0.1"))
    with pytest.raises(http.PublicFetchError):
        http.validate_target(url, http.FetchBudget.start())


def test_mixed_public_private_dns_is_blocked(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8") + dns("169.254.169.254"))
    with pytest.raises(http.PublicFetchError):
        http.validate_target("https://example.org", http.FetchBudget.start())


def test_connection_uses_validated_ip_and_original_tls_hostname(monkeypatch):
    resolutions = iter([dns("8.8.8.8"), dns("127.0.0.1")])
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: next(resolutions))
    normalized, host, port, addresses = http.validate_target("https://example.org/a", http.FetchBudget.start())
    calls = []
    raw = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(socket, "create_connection", lambda target, **kw: calls.append(target) or raw)
    monkeypatch.setattr(http.ssl, "create_default_context", lambda: SimpleNamespace(wrap_socket=lambda stream, server_hostname: calls.append(server_hostname) or stream))
    connection = http._PinnedConnection(host, port, addresses[0], True, http.FetchBudget.start())
    connection.connect()
    assert calls == [("8.8.8.8", 443), "example.org"]
    assert normalized == "https://example.org/a"
    assert socket.getaddrinfo("example.org", 443)[0][4][0] == "127.0.0.1"


class Response:
    def __init__(self, body=b"ok", status=200, **headers):
        self.status = status
        self.headers = headers
        self.stream = io.BytesIO(body)

    def getheader(self, key, default=None):
        return self.headers.get(key, default)

    def read1(self, size):
        return self.stream.read(size)


def install_connections(monkeypatch, responses):
    targets = []
    replies = iter(responses)

    class Connection:
        sock = None

        def __init__(self, host, port, address, secure, budget):
            targets.append((host, address))

        def request(self, *a, **kw):
            pass

        def getresponse(self):
            return next(replies)

        def close(self):
            pass

        def abort(self):
            self.close()

    monkeypatch.setattr(http, "_PinnedConnection", Connection)
    return targets


def test_redirect_to_private_host_never_opens_second_connection(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, *a, **kw: dns("127.0.0.1" if host == "internal.test" else "8.8.8.8"))
    targets = install_connections(monkeypatch, [Response(status=302, Location="http://internal.test/secret")])
    with pytest.raises(http.PublicFetchError):
        http.fetch("https://public.test", http.FetchBudget.start())
    assert targets == [("public.test", "8.8.8.8")]


@pytest.mark.parametrize("body,encoding,remaining,maximum", [(b"x" * 11, "identity", 100, 10), (b"x" * 11, "identity", 10, 100), (b"small", "gzip", 100, 100)])
def test_stream_and_encoding_limits(monkeypatch, body, encoding, remaining, maximum):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8"))
    install_connections(monkeypatch, [Response(body, **{"Content-Encoding": encoding})])
    with pytest.raises(http.PublicFetchError):
        http.fetch("https://public.test", http.FetchBudget(time.monotonic() + 10, remaining), maximum=maximum)


def test_expired_global_budget_stops_before_connecting(monkeypatch):
    targets = install_connections(monkeypatch, [])
    with pytest.raises(http.PublicFetchError):
        http.fetch("https://public.test", http.FetchBudget(time.monotonic() - 1))
    assert not targets


@pytest.mark.parametrize("encoding,compress", [("gzip", gzip.compress), ("deflate", zlib.compress)])
@pytest.mark.parametrize("chunk_size", [1, 7, 65536])
def test_compressed_html_is_streamed_and_both_byte_budgets_are_charged(monkeypatch, encoding, compress, chunk_size):
    body = b"<html><main>Readable public content</main></html>" * 20
    encoded = compress(body)
    reply = Response(encoded, **{"Content-Encoding": encoding, "Content-Type": "text/html"})
    reply.read1 = lambda size: reply.stream.read(min(size, chunk_size))
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8"))
    install_connections(monkeypatch, [reply])
    budget = http.FetchBudget(time.monotonic() + 10, remaining=4096, encoded_remaining=4096)
    result = http.fetch("https://public.test", budget, maximum=2048)
    assert result.body == body
    assert budget.remaining == 4096 - len(body)
    assert budget.encoded_remaining == 4096 - len(encoded)


@pytest.mark.parametrize("encoding,compress", [("gzip", gzip.compress), ("deflate", zlib.compress)])
@pytest.mark.parametrize("maximum,decoded_remaining", [(4096, 100000), (100000, 4096)])
def test_compressed_bombs_hit_decoded_response_and_aggregate_caps(monkeypatch, encoding, compress, maximum, decoded_remaining):
    encoded = compress(b"A" * 2_000_000)
    assert len(encoded) < maximum
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8"))
    install_connections(monkeypatch, [Response(encoded, **{"Content-Encoding": encoding})])
    budget = http.FetchBudget(time.monotonic() + 10, remaining=decoded_remaining)
    with pytest.raises(http.PublicFetchError, match="size limit"):
        http.fetch("https://public.test", budget, maximum=maximum)


@pytest.mark.parametrize("maximum,encoded_remaining", [(10, 1000), (1000, 10)])
def test_encoded_size_is_bounded_even_when_decoded_body_is_empty(monkeypatch, maximum, encoded_remaining):
    encoded = gzip.compress(b"")
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8"))
    install_connections(monkeypatch, [Response(encoded, **{"Content-Encoding": "gzip"})])
    budget = http.FetchBudget(time.monotonic() + 10, remaining=1000, encoded_remaining=encoded_remaining)
    with pytest.raises(http.PublicFetchError, match="encoded download"):
        http.fetch("https://public.test", budget, maximum=maximum)


@pytest.mark.parametrize("encoding,body", [
    ("gzip", gzip.compress(b"public")[:-4]),
    ("deflate", zlib.compress(b"public")[:-2]),
    ("gzip", b"invalid bytes"),
    ("deflate", b"invalid bytes"),
    ("gzip", gzip.compress(b"first") + gzip.compress(b"second")),
    ("gzip", gzip.compress(b"public") + b"trailing"),
    ("gzip, deflate", gzip.compress(b"public")),
    ("br", b"unsupported"),
])
def test_invalid_truncated_multiple_and_unsupported_encodings_are_rejected(monkeypatch, encoding, body):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8"))
    install_connections(monkeypatch, [Response(body, **{"Content-Encoding": encoding})])
    with pytest.raises(http.PublicFetchError):
        http.fetch("https://public.test", http.FetchBudget.start(), maximum=1024)


def test_encoded_aggregate_budget_spans_multiple_downloads(monkeypatch):
    body = bytes(range(256))
    encoded = gzip.compress(body)
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8"))
    install_connections(monkeypatch, [Response(encoded, **{"Content-Encoding": "gzip"}) for _ in range(2)])
    budget = http.FetchBudget(time.monotonic() + 10, remaining=10000, encoded_remaining=len(encoded) * 2 - 1)
    assert http.fetch("https://public.test/a", budget, maximum=1024).body == body
    with pytest.raises(http.PublicFetchError, match="encoded download"):
        http.fetch("https://public.test/b", budget, maximum=1024)


def test_exact_encoded_and_decoded_budgets_allow_a_complete_stream(monkeypatch):
    body = b"A" * 4096
    encoded = gzip.compress(body)
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: dns("8.8.8.8"))
    install_connections(monkeypatch, [Response(encoded, **{"Content-Encoding": "gzip"})])
    budget = http.FetchBudget(time.monotonic() + 10, remaining=len(body), encoded_remaining=len(encoded))
    assert http.fetch("https://public.test", budget, maximum=len(body)).body == body
    assert budget.remaining == budget.encoded_remaining == 0
