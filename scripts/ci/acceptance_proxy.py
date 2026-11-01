"""Deny browser transport except tunnels to the two owned acceptance services."""

from __future__ import annotations

import select
import socket
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Iterator


class _OwnedProxy(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, ports: tuple[int, int]) -> None:
        self.targets = {f"127.0.0.1:{port}": port for port in ports}
        super().__init__(("127.0.0.1", 0), _Tunnel)


class _Tunnel(BaseHTTPRequestHandler):
    server: _OwnedProxy

    def log_message(self, format: str, *args: object) -> None:
        pass

    def do_CONNECT(self) -> None:
        port = self.server.targets.get(self.path)
        if port is None:
            self.send_error(403, "Only owned acceptance services are reachable")
            return
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=5) as upstream:
                self.send_response(200, "Connection established")
                self.end_headers()
                self.connection.settimeout(5)
                peers = (self.connection, upstream)
                while True:
                    ready, _, _ = select.select(peers, (), (), 30)
                    if not ready:
                        return
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        destination = upstream if source is self.connection else self.connection
                        destination.sendall(data)
        except (OSError, ValueError):
            # Closing either owned service terminates its tunnel normally.
            return

    def do_GET(self) -> None:
        self.send_error(403, "Use an owned acceptance service tunnel")

    do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = do_GET


@contextmanager
def owned_proxy(frontend_port: int, backend_port: int) -> Iterator[str]:
    with _OwnedProxy((frontend_port, backend_port)) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            worker.join(timeout=5)
