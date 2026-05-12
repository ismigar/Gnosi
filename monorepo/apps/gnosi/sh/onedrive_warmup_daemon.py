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

A més de la materialització, el daemon genera **thumbnails** mitjançant
`qlmanage` (QuickLook nativa de macOS) per a fitxers no-imatge (vídeos,
PDFs, etc.) que `<img>` no pot renderitzar al frontend.

Endpoints:
  GET /warmup?path=<absolute_host_path>
  → 200 {"status":"materialized","blocks":N,"elapsed":s}
  → 408 {"status":"timeout","blocks":N}
  → 404 {"status":"notfound"}
  → 403 {"status":"out_of_scope"}
  → 400 {"status":"bad_request"}

  GET /thumb?path=<absolute_host_path>&size=256
  → 200 {"status":"ok","thumb_path":"/Users/.../thumbs/<hash>.png","cached":true|false}
  → 404 {"status":"notfound"}
  → 403 {"status":"out_of_scope"}
  → 408 {"status":"qlmanage_timeout"}
  → 500 {"status":"qlmanage_failed", ...}

Variables d'entorn:
  ONEDRIVE_WARMUP_PORT (default: 5009)
  ONEDRIVE_WARMUP_BIND (default: 0.0.0.0; el contenidor el veu via
    host.docker.internal, que en macOS resol al host)
  VAULT_HOST_PATH (obligatori): root permès per a la materialització.
  ONEDRIVE_WARMUP_TIMEOUT (default: 90)
  THUMB_CACHE_DIR (default: ~/.cache/gnosi/thumbs)
  THUMB_QLMANAGE_TIMEOUT (default: 30)
"""

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
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

# Thumbnails (QuickLook). Cache fora d'OneDrive — regla del projecte.
THUMB_CACHE_DIR = Path(
    os.environ.get("THUMB_CACHE_DIR", str(Path.home() / ".cache" / "gnosi" / "thumbs"))
).resolve()
THUMB_TIMEOUT_S = float(os.environ.get("THUMB_QLMANAGE_TIMEOUT", "30"))
THUMB_LOCK = threading.Lock()
THUMB_INFLIGHT = {}  # hash → Event (coalesce concurrent requests)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("onedrive-warmup")


def _materialize(path: Path) -> dict:
    """Llegeix el fitxer sencer en un thread aïllat amb deadline TIMEOUT_S.

    En macOS, `read()` sobre un dataless file està sincronitzat amb la
    baixada del File Provider: el byte només arriba quan ja és local. Si
    OneDrive no fa progrés (xarxa lenta, sync pausat, fitxer remot
    inaccessible), `read()` pot quedar bloquejant indefinidament al
    kernel i la comprovació `time.time() > TIMEOUT_S` entre chunks mai
    s'avalua.

    Per garantir el deadline executem la lectura en un thread daemon i
    fem join amb timeout. Si el thread no acaba a temps retornem
    `timeout`; el thread queda corrent en background fins que el read()
    finalment retorni o el procés daemon mori. Acceptable: així
    OneDrive té oportunitat d'acabar la baixada i la propera petició
    pel mateix fitxer ja la trobarà materialitzada.
    """
    if not path.exists() or not path.is_file():
        return {"status": "notfound"}

    bytes_read = [0]
    error_box: list = [None]
    cancel_event = threading.Event()

    def _reader() -> None:
        try:
            with open(path, "rb") as f:
                while not cancel_event.is_set():
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_read[0] += len(chunk)
        except OSError as e:
            error_box[0] = e

    t0 = time.time()
    th = threading.Thread(target=_reader, daemon=True, name=f"warmup-{path.name}")
    th.start()
    th.join(TIMEOUT_S)
    elapsed = time.time() - t0

    if th.is_alive():
        # Cooperative cancel: si el read() acaba aviat, el thread
        # surt al següent cicle del while. Si està bloquejat al kernel
        # ho farà només quan retorni dades, però retornem ja ara.
        cancel_event.set()
        log.warning(
            "warmup timeout per %s després de %.1fs (thread continua en bg, bytes_read=%d)",
            path, elapsed, bytes_read[0],
        )
        return {
            "status": "timeout",
            "bytes_read": bytes_read[0],
            "elapsed": elapsed,
        }

    if error_box[0] is not None:
        log.warning("Read fallit per %s: %s", path, error_box[0])
        return {
            "status": "read_error",
            "errno": error_box[0].errno,
            "elapsed": elapsed,
        }

    # Re-stat per confirmar que ja està materialitzat.
    try:
        blocks = os.stat(str(path)).st_blocks
    except OSError:
        blocks = 0

    return {
        "status": "materialized",
        "blocks": blocks,
        "bytes_read": bytes_read[0],
        "elapsed": elapsed,
    }


def _thumb_cache_key(source: Path, size: int) -> str:
    """SHA-256 de path absolut + mtime + size. Si el fitxer canvia, el hash
    canvia i regenerem el thumb."""
    try:
        mtime = source.stat().st_mtime
    except OSError:
        mtime = 0.0
    raw = f"{source}\0{mtime}\0{size}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _generate_thumb(source: Path, size: int) -> dict:
    """Genera un thumbnail amb `qlmanage -t -s <size>`. Cacha a
    THUMB_CACHE_DIR/<hash>.png. Coalesce requests concurrents per al
    mateix hash perquè dos webhooks simultanis no llencin dos qlmanage."""
    if not source.exists() or not source.is_file():
        return {"status": "notfound"}

    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = _thumb_cache_key(source, size)
    target = THUMB_CACHE_DIR / f"{key}.png"

    if target.exists() and target.stat().st_size > 0:
        return {"status": "ok", "thumb_path": str(target), "cached": True}

    # Coalesce: si un altre thread ja està generant aquest mateix hash, espera'l.
    with THUMB_LOCK:
        ev = THUMB_INFLIGHT.get(key)
        if ev is None:
            ev = threading.Event()
            THUMB_INFLIGHT[key] = ev
            owner = True
        else:
            owner = False

    if not owner:
        ev.wait(timeout=THUMB_TIMEOUT_S + 5)
        if target.exists() and target.stat().st_size > 0:
            return {"status": "ok", "thumb_path": str(target), "cached": True}
        return {"status": "qlmanage_failed", "reason": "coalesced_wait_failed"}

    try:
        # qlmanage escriu a <out_dir>/<source_basename>.png. Usem un tmpdir
        # i després movem al cache amb el nom correcte.
        with tempfile.TemporaryDirectory(prefix="gnosi-thumb-") as tmp:
            t0 = time.time()
            try:
                proc = subprocess.run(
                    ["qlmanage", "-t", "-s", str(size), str(source), "-o", tmp],
                    capture_output=True,
                    text=True,
                    timeout=THUMB_TIMEOUT_S,
                )
            except subprocess.TimeoutExpired:
                log.warning("qlmanage timeout per %s (>%.0fs)", source, THUMB_TIMEOUT_S)
                return {"status": "qlmanage_timeout", "elapsed": time.time() - t0}

            elapsed = time.time() - t0
            # qlmanage retorna exit code 0 fins i tot quan falla — cal mirar
            # si ha generat el fitxer.
            produced = list(Path(tmp).glob("*.png"))
            if not produced:
                log.warning(
                    "qlmanage no ha generat thumb per %s (stdout=%r, stderr=%r)",
                    source, proc.stdout[-200:], proc.stderr[-200:],
                )
                return {
                    "status": "qlmanage_failed",
                    "reason": "no_output",
                    "elapsed": elapsed,
                }

            try:
                shutil.move(str(produced[0]), str(target))
            except OSError as e:
                log.warning("No s'ha pogut moure thumb a cache: %s", e)
                return {"status": "qlmanage_failed", "reason": "move_failed"}

            return {
                "status": "ok",
                "thumb_path": str(target),
                "cached": False,
                "elapsed": elapsed,
            }
    finally:
        # Despertar threads que esperaven.
        with THUMB_LOCK:
            THUMB_INFLIGHT.pop(key, None)
        ev.set()


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

    def _parse_and_validate_path(self, parsed):
        """Extrau ?path=, valida i comprova que està dins de VAULT_HOST_PATH.
        Retorna (Path, None) en èxit, (None, error_response) en error."""
        qs = parse_qs(parsed.query)
        raw = (qs.get("path") or [""])[0]
        if not raw:
            return None, {"code": 400, "body": {"status": "bad_request", "reason": "missing path"}}
        try:
            target = Path(raw).resolve()
        except (OSError, ValueError) as e:
            return None, {"code": 400, "body": {"status": "bad_request", "reason": str(e)}}
        if not ROOT:
            return None, {"code": 500, "body": {"status": "config_error", "reason": "VAULT_HOST_PATH no configurat"}}
        try:
            target.relative_to(Path(ROOT).resolve())
        except ValueError:
            return None, {"code": 403, "body": {"status": "out_of_scope", "path": str(target)}}
        return target, None

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler API)
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            return self._send_json(200, {"status": "ok", "root": ROOT})

        if parsed.path == "/thumb":
            target, err = self._parse_and_validate_path(parsed)
            if err:
                return self._send_json(err["code"], err["body"])
            qs = parse_qs(parsed.query)
            try:
                size = int((qs.get("size") or ["256"])[0])
            except ValueError:
                size = 256
            size = max(64, min(size, 1024))  # clampejar a un range raonable
            result = _generate_thumb(target, size)
            code = {
                "ok": 200,
                "notfound": 404,
                "qlmanage_timeout": 408,
                "qlmanage_failed": 500,
            }.get(result["status"], 500)
            return self._send_json(code, result)

        if parsed.path != "/warmup":
            return self._send_json(404, {"status": "unknown_endpoint"})

        target, err = self._parse_and_validate_path(parsed)
        if err:
            return self._send_json(err["code"], err["body"])

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
