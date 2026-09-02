"""Synthetic security and transport tests for remote mail image recovery."""

from __future__ import annotations

import asyncio
import socket
import ssl
import zlib
from io import BytesIO
from typing import AsyncIterator, Iterable

import httpcore
import httpx
import pytest
from fastapi import HTTPException
from PIL import Image

from backend.domains.mail.routes import remote_images as remote_image_routes
from backend.domains.mail.services import remote_images


@pytest.fixture(autouse=True)
def _isolated_remote_image_cache() -> Iterable[None]:
    remote_images._clear_remote_image_cache()
    yield
    remote_images._clear_remote_image_cache()


class _BytesStream(httpx.AsyncByteStream):
    def __init__(self, body: bytes) -> None:
        self._body = body

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self._body


class _RecordingStream(httpcore.AsyncNetworkStream):
    def __init__(self, body: bytes) -> None:
        self._response = (
            b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: "
            + str(len(body)).encode("ascii")
            + b"\r\nConnection: close\r\n\r\n"
            + body
        )
        self.sni_hostname: str | None = None
        self.writes: list[bytes] = []

    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        del timeout
        chunk, self._response = self._response[:max_bytes], self._response[max_bytes:]
        return chunk

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        del timeout
        self.writes.append(buffer)

    async def aclose(self) -> None:
        return None

    async def start_tls(
        self,
        ssl_context: ssl.SSLContext,
        server_hostname: str | None = None,
        timeout: float | None = None,
    ) -> httpcore.AsyncNetworkStream:
        del ssl_context, timeout
        self.sni_hostname = server_hostname
        return self


class _RecordingBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, stream: _RecordingStream) -> None:
        self.stream = stream
        self.connected_hosts: list[str] = []

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        del port, timeout, local_address, socket_options
        self.connected_hosts.append(host)
        return self.stream

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        del path, timeout, socket_options
        raise AssertionError("Unix socket must not be used")

    async def sleep(self, seconds: float) -> None:
        del seconds


def _png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (2, 2), color=(30, 60, 90)).save(buffer, format="PNG")
    return buffer.getvalue()


def _target(url: str) -> remote_images.ValidatedRemoteImageUrl:
    return remote_images.ValidatedRemoteImageUrl(
        url=url,
        hostname="images.example.test",
        addresses=("8.8.8.8",),
    )


def test_url_validation_rejects_credentials_localhost_and_private_literals() -> None:
    blocked = (
        "https://user:secret@example.test/image.png",
        "https://localhost/image.png",
        "https://127.0.0.1/image.png",
        "https://[::1]/image.png",
        "https://10.1.2.3/image.png",
        "https://169.254.169.254/latest/meta-data/",
    )
    for url in blocked:
        with pytest.raises(remote_images.RemoteMailImageError) as error:
            asyncio.run(remote_images._validate_remote_image_url(url))
        assert error.value.code == "blocked_url"


def test_url_validation_rejects_dns_that_resolves_to_private_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.10", 443))
        ],
    )
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images._validate_remote_image_url(
                "https://public-name.example.test/image.png"
            )
        )
    assert error.value.code == "blocked_url"


def test_fetch_accepts_only_verified_raster_and_forwards_no_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        assert "referer" not in request.headers
        return httpx.Response(
            200,
            headers={"Content-Type": "image/png"},
            content=_png_bytes(),
            request=request,
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    result = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/pixel.png?opaque=signed",
            transport=httpx.MockTransport(handler),
        )
    )
    assert result.content_type == "image/png"
    assert result.body == _png_bytes()


def test_fresh_verified_image_uses_memory_cache_without_origin_or_dns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    validations = 0
    requests = 0

    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        nonlocal validations
        validations += 1
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(
            200,
            headers={"Content-Type": "image/png", "ETag": '"fixture-v1"'},
            content=_png_bytes(),
            request=request,
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    transport = httpx.MockTransport(handler)
    first = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/cache.png", transport=transport
        )
    )
    second = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/cache.png", transport=transport
        )
    )

    assert second == first
    assert validations == 1
    assert requests == 1


def test_stale_cache_revalidates_with_etag_and_accepts_304(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0
    requests: list[httpx.Request] = []

    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(
                200,
                headers={"Content-Type": "image/png", "ETag": '"fixture-v1"'},
                content=_png_bytes(),
                request=request,
            )
        assert request.headers["if-none-match"] == '"fixture-v1"'
        return httpx.Response(304, request=request)

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    monkeypatch.setattr(remote_images, "_now", lambda: now)
    transport = httpx.MockTransport(handler)
    first = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/revalidate.png", transport=transport
        )
    )
    now += remote_images.CACHE_TTL_SECONDS + 1
    second = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/revalidate.png", transport=transport
        )
    )

    assert second == first
    assert len(requests) == 2


def test_recent_stale_cache_survives_revalidation_timeout_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0
    requests = 0

    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        if requests == 1:
            return httpx.Response(
                200,
                headers={"Content-Type": "image/png", "ETag": '"fixture-v1"'},
                content=_png_bytes(),
                request=request,
            )
        raise httpx.ReadTimeout("synthetic timeout", request=request)

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    monkeypatch.setattr(remote_images, "_now", lambda: now)
    transport = httpx.MockTransport(handler)
    first = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/stale.png", transport=transport
        )
    )
    now += remote_images.CACHE_TTL_SECONDS + 1
    second = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/stale.png", transport=transport
        )
    )

    assert second == first
    assert requests == 2


def test_stale_cache_does_not_hide_origin_denial(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0
    requests = 0

    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        if requests == 1:
            return httpx.Response(
                200,
                headers={"Content-Type": "image/png"},
                content=_png_bytes(),
                request=request,
            )
        return httpx.Response(403, request=request)

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    monkeypatch.setattr(remote_images, "_now", lambda: now)
    transport = httpx.MockTransport(handler)
    asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/denied.png", transport=transport
        )
    )
    now += remote_images.CACHE_TTL_SECONDS + 1
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images.fetch_remote_mail_image(
                "https://images.example.test/denied.png", transport=transport
            )
        )

    assert error.value.code == "origin_unavailable"
    assert requests == 2


@pytest.mark.parametrize(
    ("content_type", "content", "expected_code"),
    [
        ("text/html", b"<html></html>", "unsupported_media_type"),
        ("image/png", b"<html></html>", "invalid_image"),
        ("image/png", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "invalid_image"),
        ("image/jpeg", _png_bytes(), "invalid_image"),
    ],
)
def test_fetch_rejects_unsupported_or_forged_image_types(
    monkeypatch: pytest.MonkeyPatch,
    content_type: str,
    content: bytes,
    expected_code: str,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": content_type},
            content=content,
            request=request,
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images.fetch_remote_mail_image(
                "https://images.example.test/image",
                transport=httpx.MockTransport(handler),
            )
        )
    assert error.value.code == expected_code


def test_fetch_rejects_declared_oversized_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "Content-Length": str(remote_images.MAX_IMAGE_BYTES + 1),
                "Content-Type": "image/png",
            },
            content=_png_bytes(),
            request=request,
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images.fetch_remote_mail_image(
                "https://images.example.test/large.png",
                transport=httpx.MockTransport(handler),
            )
        )
    assert error.value.code == "image_too_large"


def test_fetch_enforces_streamed_size_without_content_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "image/png"},
            request=request,
            stream=_BytesStream(b"x" * (remote_images.MAX_IMAGE_BYTES + 1)),
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images.fetch_remote_mail_image(
                "https://images.example.test/stream.png",
                transport=httpx.MockTransport(handler),
            )
        )
    assert error.value.code == "image_too_large"


def test_fetch_revalidates_and_blocks_private_redirect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def validate_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        if "127.0.0.1" in url:
            raise remote_images.RemoteMailImageError("blocked_url", 400)
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302,
            headers={"Location": "https://127.0.0.1/private.png"},
            request=request,
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", validate_fixture)
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images.fetch_remote_mail_image(
                "https://images.example.test/redirect.png",
                transport=httpx.MockTransport(handler),
            )
        )
    assert error.value.code == "blocked_url"


def test_fetch_maps_network_timeout_without_retrying(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("synthetic timeout", request=request)

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images.fetch_remote_mail_image(
                "https://images.example.test/slow.png",
                transport=httpx.MockTransport(handler),
            )
        )
    assert error.value.code == "timeout"
    assert calls == 1


def test_fetch_retries_one_prevalidated_public_address_on_network_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return remote_images.ValidatedRemoteImageUrl(
            url=url,
            hostname="images.example.test",
            addresses=("8.8.8.8", "1.1.1.1", "9.9.9.9"),
        )

    attempted: list[str] = []

    def transport_for(target: remote_images.ValidatedRemoteImageUrl) -> httpx.MockTransport:
        address = target.addresses[0]
        attempted.append(address)

        def handler(request: httpx.Request) -> httpx.Response:
            if address == "8.8.8.8":
                raise httpx.ConnectError("synthetic failure", request=request)
            return httpx.Response(
                200,
                headers={"Content-Type": "application/octet-stream"},
                content=_png_bytes(),
                request=request,
            )

        return httpx.MockTransport(handler)

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    monkeypatch.setattr(remote_images, "_PinnedTransport", transport_for)
    result = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/fallback.png"
        )
    )

    assert result.content_type == "image/png"
    assert attempted == ["8.8.8.8", "1.1.1.1"]


def test_fetch_does_not_retry_other_addresses_after_origin_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return remote_images.ValidatedRemoteImageUrl(
            url=url,
            hostname="images.example.test",
            addresses=("8.8.8.8", "1.1.1.1"),
        )

    attempted: list[str] = []

    def transport_for(target: remote_images.ValidatedRemoteImageUrl) -> httpx.MockTransport:
        attempted.append(target.addresses[0])
        return httpx.MockTransport(
            lambda request: httpx.Response(403, request=request)
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    monkeypatch.setattr(remote_images, "_PinnedTransport", transport_for)
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        asyncio.run(
            remote_images.fetch_remote_mail_image(
                "https://images.example.test/forbidden.png"
            )
        )

    assert error.value.code == "origin_unavailable"
    assert attempted == ["8.8.8.8"]


def test_fetch_accepts_valid_image_without_content_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "image/png"},
            request=request,
            stream=_BytesStream(_png_bytes()),
        )

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    result = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/no-length.png",
            transport=httpx.MockTransport(handler),
        )
    )
    assert result.body == _png_bytes()
    assert result.content_type == "image/png"


@pytest.mark.parametrize("declared_type", ["", "application/octet-stream", "image/x-png"])
def test_fetch_accepts_verified_raster_with_compatible_declarations(
    monkeypatch: pytest.MonkeyPatch,
    declared_type: str,
) -> None:
    async def accept_fixture(url: str) -> remote_images.ValidatedRemoteImageUrl:
        return _target(url)

    def handler(request: httpx.Request) -> httpx.Response:
        headers = {"Content-Type": declared_type} if declared_type else {}
        return httpx.Response(200, headers=headers, content=_png_bytes(), request=request)

    monkeypatch.setattr(remote_images, "_validate_remote_image_url", accept_fixture)
    result = asyncio.run(
        remote_images.fetch_remote_mail_image(
            "https://images.example.test/compatible",
            transport=httpx.MockTransport(handler),
        )
    )
    assert result.content_type == "image/png"


def test_pixel_bomb_dimensions_are_rejected_before_decode() -> None:
    body = bytearray(_png_bytes())
    body[16:20] = (10_000).to_bytes(4, "big")
    body[20:24] = (10_000).to_bytes(4, "big")
    body[29:33] = zlib.crc32(body[12:29]).to_bytes(4, "big")
    with pytest.raises(remote_images.RemoteMailImageError) as error:
        remote_images._validate_raster_image(bytes(body))
    assert error.value.code == "invalid_image"


def test_pinned_transport_ignores_dns_change_and_preserves_host_and_sni(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolutions = iter([
        [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))],
        [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
    ])
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args, **_kwargs: next(resolutions))
    target = asyncio.run(
        remote_images._validate_remote_image_url(
            "https://images.example.test/pinned.png"
        )
    )
    stream = _RecordingStream(_png_bytes())
    delegate = _RecordingBackend(stream)

    async def make_request() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=remote_images._PinnedTransport(target, delegate),
        ) as client:
            return await client.get(target.url)

    response = asyncio.run(make_request())
    assert response.status_code == 200
    assert delegate.connected_hosts == ["8.8.8.8"]
    assert stream.sni_hostname == "images.example.test"
    assert b"Host: images.example.test" in b"".join(stream.writes)
    assert socket.getaddrinfo("images.example.test", 443)[0][4][0] == "127.0.0.1"


def test_route_returns_non_persistent_nosniff_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fixture_fetch(_url: str) -> remote_images.RemoteMailImage:
        return remote_images.RemoteMailImage(_png_bytes(), "image/png")

    monkeypatch.setattr(remote_image_routes, "fetch_remote_mail_image", fixture_fetch)
    response = asyncio.run(
        remote_image_routes.fetch_remote_image(
            remote_image_routes.RemoteMailImageRequest(
                url="https://images.example.test/image.png"
            )
        )
    )
    assert response.media_type == "image/png"
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_route_exposes_only_stable_failure_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fixture_fetch(_url: str) -> remote_images.RemoteMailImage:
        raise remote_images.RemoteMailImageError("blocked_url", 400)

    monkeypatch.setattr(remote_image_routes, "fetch_remote_mail_image", fixture_fetch)
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            remote_image_routes.fetch_remote_image(
                remote_image_routes.RemoteMailImageRequest(
                    url="https://images.example.test/image.png"
                )
            )
        )
    assert error.value.status_code == 400
    assert error.value.detail == "blocked_url"
