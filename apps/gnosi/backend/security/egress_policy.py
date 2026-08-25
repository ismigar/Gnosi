"""Conservative URL egress checks for generated/connector tools."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


def is_allowed_url(url: str, *, allow_hosts: set[str] | None = None) -> bool:
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    host = parsed.hostname.casefold().rstrip(".")
    allowed = {str(item).casefold().rstrip(".") for item in (allow_hosts or set())}
    if allowed and host not in allowed:
        return False
    if host in {"localhost", "localhost.localdomain"}:
        return False
    try:
        address = ipaddress.ip_address(host)
        return not (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved)
    except ValueError:
        pass
    try:
        resolved = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    except OSError:
        return False
    return all(
        not (ipaddress.ip_address(item[4][0]).is_private or ipaddress.ip_address(item[4][0]).is_loopback or ipaddress.ip_address(item[4][0]).is_link_local)
        for item in resolved
    )
