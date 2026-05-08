#!/usr/bin/env python3
"""
OneDrive warmup daemon (executar al **host**, no dins de Docker).

El backend de Gnosi corre dins de Docker amb un bind-mount al directori
OneDrive del macOS. Per a fitxers `online-only` (st_blocks==0) la lectura
dins del contenidor falla amb `OSError [Errno 35] Resource deadlock avoided`
perquè el File Provider d'OneDrive no rep el "trigger" a través del
bind-mount grpcfuse.

Aquest daemon, executat al host, materialitza el fitxer obrint-lo (cosa
que sí dispara el File Provider del Mac) i espera fins que estigui
descarregat. El backend Docker el crida via `host.docker.internal:5009`.

Endpoint:
  GET /warmup?path=<absolute_host_path>
  → 200 {"status":"materialized","blocks":N,"elapsed":s}
  → 408 {"status":"timeout","blocks":N}
  → 404 {"status":"notfound"}
  → 403 {"status":"out_of_scope"}
  → 400 {"status":"bad_request"}

Variables d'entorn:
  ONEDRIVE_WARMUP_PORT (default: 5009)
  ONEDRIVE_WARMUP_BIND (default: 127.0.0.1; el contenidor el veu via
    host.docker.internal, que en macOS resol al host)
  VAULT_HOST_PATH (obligatori): root permès per a la materialització.
  ONEDRIVE_WARMUP_TIMEOUT (default: 30)
"""

import json
import logging
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("ONEDRIVE_WARMUP_PORT", "5009"))
# host.docker.internal resol a l'IP del host des del contenidor; bind a totes
# les interfícies perquè Docker hi pugui accedir. En macOS, escoltar a
# 0.0.0.0 NO exposa el port a la xarxa externa si la firewall hi és (per
# defecte ho està); igualment es pot acotar a 127.0.0.1 si el contenidor
# accedeix via passa per gateway, però llavors `host.docker.internal` no
# arriba. Per defecte 0.0.0.0 i confiem en la firewall del macOS.
BIND = os.environ.get("ONEDRIVE_WARMUP_BIND", "0.0.0.0")
ROOT = os.environ.get("VAULT_HOST_PATH")
TIMEOUT_S = float(os.environ.get("ONEDRIVE_WARMUP_TIMEOUT", "90"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("onedrive-warmup")


def _materialize(path: Path) -> dict:
    """Llegeix el fitxer sencer (dispara i bloqueja fins que la baixada del
    File Provider acaba). En macOS, `read()` sobre un dataless file és
    sincronitzat amb la baixada — el byte només arriba quan ja és local.
    """
    if not path.exists() or not path.is_file():
        return {"status": "notfound"}

    t0 = time.time()
    try:
        # Lectura per chunks per no carregar fitxers grans en memòria a un cop.
        # No retornem el contingut: només volem el side-effect de la baixada.
        bytes_read = 0
        with open(path, "rb") as f:
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                bytes_read += len(chunk)
                if time.time() - t0 > TIMEOUT_S:
                    return {"status": "timeout", "bytes_read": bytes_read, "elapsed": time.time() - t0}
    except OSError as e:
        log.warning("Read fallit per %s: %s", path, e)
        return {"status": "read_error", "errno": e.errno, "elapsed": time.time() - t0}

    # Re-stat per confirmar que ja està materialitzat.
    try:
        blocks = os.stat(str(path)).st_blocks
    except OSError:
        blocks = 0

    return {"status": "materialized", "blocks": blocks, "bytes_read": bytes_read, "elapsed": time.time() - t0}


class WarmupHandler(BaseHTTPRequestHandler):
    def _send_json(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # silenciar el log per defecte (sorollós)
        log.info("%s - %s", self.address_string(), fmt % args)

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler API)
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            return self._send_json(200, {"status": "ok", "root": ROOT})

        if parsed.path != "/warmup":
            return self._send_json(404, {"status": "unknown_endpoint"})

        qs = parse_qs(parsed.query)
        raw = (qs.get("path") or [""])[0]
        if not raw:
            return self._send_json(400, {"status": "bad_request", "reason": "missing path"})

        try:
            target = Path(raw).resolve()
        except (OSError, ValueError) as e:
            return self._send_json(400, {"status": "bad_request", "reason": str(e)})

        # Confinem la materialització dins del vault host: evitem que un
        # contenidor compromès pugui materialitzar fitxers arbitraris del Mac.
        if not ROOT:
            return self._send_json(500, {"status": "config_error", "reason": "VAULT_HOST_PATH no configurat"})
        try:
            target.relative_to(Path(ROOT).resolve())
        except ValueError:
            return self._send_json(403, {"status": "out_of_scope", "path": str(target)})

        result = _materialize(target)
        code = {
            "materialized": 200,
            "timeout": 408,
            "notfound": 404,
            "read_error": 500,
        }.get(result["status"], 500)
        return self._send_json(code, result)


def main() -> int:
    if not ROOT:
        log.error("VAULT_HOST_PATH no està definit. Surto.")
        return 2
    if not Path(ROOT).is_dir():
        log.error("VAULT_HOST_PATH no apunta a un directori: %s", ROOT)
        return 2

    server = ThreadingHTTPServer((BIND, PORT), WarmupHandler)
    log.info("OneDrive warmup daemon escoltant a http://%s:%d (root=%s)", BIND, PORT, ROOT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Aturant per Ctrl-C")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
