#!/usr/bin/env python3
"""Petit servei HTTP que escolta a 127.0.0.1:5099 i obre fitxers/carpetes amb
l'app per defecte del sistema host.

Per què cal:
    El backend de Gnosi corre dins d'un contenidor Docker Linux i no té
    accés al Finder/Explorer del Mac. Aquest helper s'executa al host i el
    backend del contenidor el contacta via host.docker.internal:5099.

Endpoints:
    GET  /healthz           → {"status": "ok"}
    POST /open              → {"path": "/Users/..."} o {"path": "file:///..."}
                              Resposta: {"status": "ok", "target": "..."}

Seguretat:
    - Bind a 127.0.0.1 + port host.docker.internal: només localhost+contenidors.
    - Comprova que la ruta existeix abans d'obrir.
    - Usa subprocess sense shell.
    - Escolta una llista d'arrels permeses (env GNOSI_OPEN_ROOTS, separats per ':').
      Si està buida, accepta qualsevol ruta dins del HOME de l'usuari.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LOG = logging.getLogger("host_open_helper")
PORT = int(os.environ.get("GNOSI_HOST_OPEN_PORT", "5099"))
HOME = Path.home().resolve()


def _allowed_roots() -> list[Path]:
    """Llista de roots permesos.

    - Si `GNOSI_OPEN_ROOTS` està definit (separats per `:`), s'usa exactament.
    - Si és buit o no existeix, retornem `[]` que vol dir "qualsevol ruta del
      sistema". El helper només escolta a 127.0.0.1 i és per a ús personal,
      així que aquesta restricció relaxada és acceptable. Per limitar-la,
      defineix `GNOSI_OPEN_ROOTS=/Users/<usuari>:/Volumes` al plist.
    """
    raw = os.environ.get("GNOSI_OPEN_ROOTS", "").strip()
    if not raw:
        return []
    return [Path(p).expanduser().resolve() for p in raw.split(":") if p.strip()]


def _normalize_path(raw: str) -> Path:
    raw = raw.strip()
    if raw.lower().startswith("file://"):
        without_scheme = raw[7:]
        if without_scheme.startswith("/"):
            decoded = urllib.parse.unquote(without_scheme)
        else:
            decoded = "//" + urllib.parse.unquote(without_scheme)
        return Path(decoded).expanduser()
    return Path(raw).expanduser()


def _is_path_allowed(path: Path) -> bool:
    roots = _allowed_roots()
    if not roots:
        return True  # cap restricció (vegeu _allowed_roots)
    try:
        resolved = path.resolve()
    except Exception:
        return False
    for root in roots:
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def _open_with_system(path: Path) -> None:
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
        return
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
        return
    subprocess.Popen(["xdg-open", str(path)])


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send(200, {"status": "ok", "roots": [str(p) for p in _allowed_roots()]})
            return
        self._send(404, {"detail": "not found"})

    def do_POST(self) -> None:
        if self.path != "/open":
            self._send(404, {"detail": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"detail": "invalid JSON"})
            return
        raw = (payload or {}).get("path") or (payload or {}).get("url") or ""
        raw = str(raw).strip()
        if not raw:
            self._send(400, {"detail": "missing 'path'"})
            return
        try:
            path = _normalize_path(raw)
        except Exception:
            self._send(400, {"detail": "invalid path"})
            return
        if not path.exists():
            self._send(404, {"detail": f"path not found: {path}"})
            return
        if not _is_path_allowed(path):
            self._send(403, {"detail": f"path outside allowed roots: {path}"})
            return
        try:
            _open_with_system(path)
        except Exception as exc:
            LOG.exception("open failed")
            self._send(500, {"detail": f"could not open: {exc}"})
            return
        self._send(200, {
            "status": "ok",
            "target": str(path),
            "kind": "dir" if path.is_dir() else "file",
        })


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )
    LOG.info(
        "host_open_helper escoltant a 127.0.0.1:%d (roots=%s)",
        PORT,
        [str(p) for p in _allowed_roots()],
    )
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOG.info("aturat per KeyboardInterrupt")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
