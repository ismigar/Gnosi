"""Bounded public HTTP reads with the validated address pinned to the socket."""
from __future__ import annotations

import http.client
import ipaddress
import queue
import socket
import ssl
import threading
import time
import zlib
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote, urljoin, urlsplit, urlunsplit


class PublicFetchError(ValueError):
    """A public URL could not be safely read."""


@dataclass(frozen=True)
class PublicResponse:
    url: str
    body: bytes
    content_type: str


@dataclass
class FetchBudget:
    deadline: float
    remaining: int = 64 * 1024 * 1024
    encoded_remaining: int = 64 * 1024 * 1024

    @classmethod
    def start(cls, seconds: float = 60) -> FetchBudget:
        return cls(time.monotonic() + seconds)

    def timeout(self) -> float:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0 or self.remaining < 0 or self.encoded_remaining < 0:
            raise PublicFetchError("The import reached its time or download limit")
        return min(8.0, remaining)


def _public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def validate_target(url: str, budget: FetchBudget) -> tuple[str, str, int, tuple[str, ...]]:
    try:
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None or parts.password is not None:
            raise ValueError
        if any(ord(char) < 33 or ord(char) == 127 for char in url) or "\\" in url or len(url) > 8000:
            raise ValueError
        host = parts.hostname.encode("idna").decode("ascii")
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except (ValueError, UnicodeError):
        raise PublicFetchError("Use a public HTTP or HTTPS URL without credentials") from None
    # A daemon DNS worker lets the caller enforce the same overall deadline.
    results: queue.Queue[tuple[str, ...] | OSError] = queue.Queue(maxsize=1)

    def resolve() -> None:
        try:
            records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            results.put(tuple(dict.fromkeys(str(item[4][0]) for item in records)))
        except OSError as error:
            results.put(error)

    threading.Thread(target=resolve, daemon=True).start()
    try:
        answer = results.get(timeout=min(3.0, budget.timeout()))
    except queue.Empty:
        raise PublicFetchError("The public host could not be resolved in time") from None
    if isinstance(answer, OSError):
        raise PublicFetchError("The public host could not be resolved") from None
    try:
        addresses = answer
        if not addresses or any(not _public(address) for address in addresses):
            raise ValueError
    except (ValueError, TypeError):
        raise PublicFetchError("Private or reserved network addresses cannot be imported") from None
    authority = ("[" + host + "]" if ":" in host else host) + (":" + str(port) if parts.port else "")
    normalized = urlunsplit((parts.scheme, authority, quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~"), parts.query, ""))
    return normalized, host, port, addresses


class _PinnedConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, address: str, secure: bool, budget: FetchBudget) -> None:
        super().__init__(host, port, timeout=budget.timeout())
        self.address = address
        self.secure = secure
        self.budget = budget
        self.transport_socket: socket.socket | None = None

    def connect(self) -> None:
        raw = socket.create_connection((self.address, self.port), timeout=self.budget.timeout())
        self.transport_socket = raw
        try:
            self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host) if self.secure else raw
            self.transport_socket = self.sock
        except BaseException:
            raw.close()
            raise

    def abort(self) -> None:
        # A peer sending headers/bytes very slowly cannot extend the global deadline.
        if self.transport_socket is not None:
            try:
                self.transport_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.close()


class _Decoder(Protocol):
    @property
    def eof(self) -> bool: ...

    @property
    def unused_data(self) -> bytes: ...

    @property
    def unconsumed_tail(self) -> bytes: ...

    def decompress(self, data: bytes, max_length: int = 0) -> bytes: ...


def _decoder(encoding: str) -> _Decoder | None:
    encodings = {"gzip": zlib.MAX_WBITS + 16, "deflate": zlib.MAX_WBITS}
    if encoding in {"", "identity"}:
        return None
    if encoding not in encodings:
        raise PublicFetchError("The website returned an unsupported compressed response")
    return zlib.decompressobj(encodings[encoding])


def _append_decoded(body: bytearray, data: bytes, budget: FetchBudget, maximum: int) -> None:
    budget.remaining -= len(data)
    if len(body) + len(data) > maximum or budget.remaining < 0:
        raise PublicFetchError("The download exceeded the import size limit")
    body.extend(data)


def _decode_chunk(decoder: _Decoder, data: bytes, body: bytearray, budget: FetchBudget, maximum: int) -> None:
    pending = data
    try:
        while True:
            budget.timeout()
            output_limit = min(65536, maximum - len(body) + 1, budget.remaining + 1)
            decoded = decoder.decompress(pending, output_limit)
            _append_decoded(body, decoded, budget, maximum)
            if decoder.unused_data:
                raise PublicFetchError("The compressed response contains trailing or multiple streams")
            pending = decoder.unconsumed_tail
            if not pending and (len(decoded) < output_limit or decoder.eof):
                break
    except zlib.error:
        raise PublicFetchError("The website returned an invalid compressed response") from None


def _read_body(response: http.client.HTTPResponse, connection: _PinnedConnection,
               budget: FetchBudget, maximum: int) -> bytes:
    decoder = _decoder(response.getheader("Content-Encoding", "identity").strip().lower())
    body = bytearray()
    encoded_count = 0
    while True:
        if connection.sock:
            connection.sock.settimeout(budget.timeout())
        chunk = response.read1(min(65536, maximum - encoded_count + 1, budget.encoded_remaining + 1))
        if not chunk:
            break
        encoded_count += len(chunk)
        budget.encoded_remaining -= len(chunk)
        if encoded_count > maximum or budget.encoded_remaining < 0:
            raise PublicFetchError("The encoded download exceeded the import size limit")
        if decoder is None:
            _append_decoded(body, chunk, budget, maximum)
        else:
            _decode_chunk(decoder, chunk, body, budget, maximum)
        budget.timeout()
    if decoder is not None and not decoder.eof:
        raise PublicFetchError("The website returned a truncated compressed response")
    return bytes(body)


def fetch(url: str, budget: FetchBudget, *, maximum: int = 2 * 1024 * 1024) -> PublicResponse:
    """No proxies, cookies, implicit redirects, or second hostname resolution."""
    current = url
    for hop in range(6):
        normalized, host, port, addresses = validate_target(current, budget)
        parts = urlsplit(normalized)
        connection = _PinnedConnection(host, port, addresses[0], parts.scheme == "https", budget)
        watchdog = threading.Timer(max(0, budget.deadline - time.monotonic()), connection.abort)
        watchdog.daemon = True
        watchdog.start()
        try:
            connection.request("GET", urlunsplit(("", "", parts.path, parts.query, "")), headers={
                "User-Agent": "Gnosi-Website-Import/1.0", "Accept": "text/html, image/*;q=0.8", "Accept-Encoding": "identity",
            })
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location or hop == 5:
                    raise PublicFetchError("The website redirected too many times or without a destination")
                current = urljoin(normalized, location)
                continue
            if response.status != 200:
                raise PublicFetchError("The public website did not return a readable page")
            body = _read_body(response, connection, budget, maximum)
            return PublicResponse(normalized, body, response.getheader("Content-Type", "").lower())
        except (OSError, http.client.HTTPException, ValueError) as error:
            if isinstance(error, PublicFetchError):
                raise
            raise PublicFetchError("The public website could not be read securely") from None
        finally:
            watchdog.cancel()
            connection.close()
    raise PublicFetchError("The website redirected too many times")
