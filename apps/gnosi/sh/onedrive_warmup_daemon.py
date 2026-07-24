#!/usr/bin/env python3
"""
OneDrive warmup daemon (run on the **host**, not inside Docker).

Gnosi's backend runs inside Docker with a bind-mount to the macOS
OneDrive directory. For `online-only` files (st_blocks==0), reading
inside the container fails with `OSError [Errno 35] Resource deadlock avoided`
because OneDrive's File Provider doesn't receive the "trigger" through the
grpcfuse bind-mount.

This daemon, run on the host, materializes the file by opening it (which
does trigger the Mac's File Provider) and waits until it's
downloaded. The Docker backend calls it via `host.docker.internal:5009`.

Besides materialization, the daemon generates **thumbnails** via
`qlmanage` (macOS's native QuickLook) for non-image files (videos,
PDFs, etc.) that `<img>` can't render on the frontend.

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

Environment variables:
  ONEDRIVE_WARMUP_PORT (default: 5009)
  ONEDRIVE_WARMUP_BIND (default: 0.0.0.0; the container sees it via
    host.docker.internal, which resolves to the host on macOS)
  ONEDRIVE_WARMUP_ALLOWED_ROOTS (recommended): list of directories
    authorized for materialization, ':'-separated. Any path
    whose `resolve()` falls under any of these roots is accepted.
    Useful when the Vault has links to PDFs/images in other OneDrive
    folders (Documents, Desktop, etc.) — without this, the daemon
    responds `out_of_scope` and the frontend gets a 503.
  VAULT_HOST_PATH (legacy, fallback): a single root. Kept for
    backward compatibility: if ALLOWED_ROOTS isn't defined, only
    VAULT_HOST_PATH is authorized.
  ONEDRIVE_WARMUP_TIMEOUT (default: 90)
  THUMB_CACHE_DIR (default: ~/.cache/gnosi/thumbs)
  THUMB_QLMANAGE_TIMEOUT (default: 30)
"""

import hashlib
import json
import logging
import logging.handlers
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
# host.docker.internal resolves to the host's IP from the container; bind to all
# interfaces so Docker can access it. On macOS, listening on
# 0.0.0.0 does NOT expose the port to the external network if the firewall is on (it is
# on by default); it can equally be restricted to 127.0.0.1 if the container
# accesses it via the gateway, but then `host.docker.internal` wouldn't
# arrives. Defaults to 0.0.0.0 and we rely on the macOS firewall.
BIND = os.environ.get("ONEDRIVE_WARMUP_BIND", "0.0.0.0")
TIMEOUT_S = float(os.environ.get("ONEDRIVE_WARMUP_TIMEOUT", "90"))


def _parse_allowed_roots() -> list[Path]:
    """Builds the list of allowed roots from the env vars.

    Priority:
      1. ONEDRIVE_WARMUP_ALLOWED_ROOTS (':'-separated, like $PATH)
      2. VAULT_HOST_PATH (legacy, a single root)

    Each root is resolved to an absolute path with `.resolve()` (follows
    symlinks). We filter out empty entries and ones that don't point to an
    existing directory.
    
    """
    raw = os.environ.get("ONEDRIVE_WARMUP_ALLOWED_ROOTS", "").strip()
    candidates: list[str] = []
    if raw:
        candidates = [p.strip() for p in raw.split(":") if p.strip()]
    else:
        legacy = os.environ.get("VAULT_HOST_PATH", "").strip()
        if legacy:
            candidates = [legacy]

    resolved: list[Path] = []
    for c in candidates:
        try:
            p = Path(c).expanduser().resolve()
        except (OSError, ValueError):
            log.warning("Allowed root invàlid (ignorat): %r", c)
            continue
        if not p.is_dir():
            log.warning("Allowed root no és un directori (ignorat): %s", p)
            continue
        resolved.append(p)
    return resolved


ALLOWED_ROOTS: list[Path] = []  # poblat a main() — log ja inicialitzat

# Thumbnails (QuickLook). Cache outside OneDrive — project rule.
THUMB_CACHE_DIR = Path(
    os.environ.get("THUMB_CACHE_DIR", str(Path.home() / ".cache" / "gnosi" / "thumbs"))
).resolve()
THUMB_TIMEOUT_S = float(os.environ.get("THUMB_QLMANAGE_TIMEOUT", "30"))
THUMB_LOCK = threading.Lock()
THUMB_INFLIGHT = {}  # hash → Event (coalesce concurrent requests)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("onedrive-warmup")

# Log to its own file, independent of the launch context. Launched as
# Login Item (.app AppleScript), stdout/stderr queden capturats pel `do shell
# an applet's `script` and never reach any file; and we can't add redirection
# to the applet without recompiling it (recompiling invalidates its Full Disk Access
# to TCC). ONEDRIVE_WARMUP_LOG_FILE="" disables it.
_LOG_FILE = os.environ.get(
    "ONEDRIVE_WARMUP_LOG_FILE",
    str(Path.home() / "Library" / "Logs" / "Gnosi" / "onedrive-warmup.err"),
).strip()
if _LOG_FILE:
    try:
        Path(_LOG_FILE).parent.mkdir(parents=True, exist_ok=True)
        _fh = logging.handlers.RotatingFileHandler(
            _LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
        )
        _fh.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
        logging.getLogger().addHandler(_fh)
    except OSError as exc:
        log.warning("No puc obrir el log a fitxer %s: %s", _LOG_FILE, exc)


def _materialize(path: Path) -> dict:
    """Reads the entire file in an isolated thread with a TIMEOUT_S deadline.

    On macOS, `read()` on a dataless file is synchronized with the
    File Provider's download: the byte only arrives once it's already local. If
    OneDrive makes no progress (slow network, sync paused, remote file
    unreachable), `read()` can block indefinitely in the
    kernel, and the `time.time() > TIMEOUT_S` check between chunks never
    gets evaluated.

    To guarantee the deadline, we run the read in a daemon thread and
    join it with a timeout. If the thread doesn't finish in time we return
    `timeout`; the thread keeps running in the background until the read()
    finally returns or the daemon process dies. Acceptable: this way
    OneDrive gets a chance to finish the download and the next request
    for the same file will already find it materialized.
    
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
        # Cooperative cancel: if the read() finishes early, the thread
        # exits at the next while cycle. If it's blocked in the kernel
        # it will only do so once it returns data, but we return right now.
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

    # Re-stat to confirm it's already materialized.
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
    """SHA-256 of the absolute path + mtime + size. If the file changes, the hash
    changes and we regenerate the thumb."""
    try:
        mtime = source.stat().st_mtime
    except OSError:
        mtime = 0.0
    raw = f"{source}\0{mtime}\0{size}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _generate_thumb(source: Path, size: int) -> dict:
    """Generates a thumbnail with `qlmanage -t -s <size>`. Caches to
    THUMB_CACHE_DIR/<hash>.png. Coalesces concurrent requests for the
    same hash so that two simultaneous webhooks don't spawn two qlmanage processes."""
    if not source.exists() or not source.is_file():
        return {"status": "notfound"}

    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = _thumb_cache_key(source, size)
    target = THUMB_CACHE_DIR / f"{key}.png"

    if target.exists() and target.stat().st_size > 0:
        return {"status": "ok", "thumb_path": str(target), "cached": True}

    # Coalesce: if another thread is already generating this same hash, wait for it.
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
        # qlmanage writes to <out_dir>/<source_basename>.png. We use a tmpdir
        # and then move it to the cache with the correct name.
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
            # qlmanage returns exit code 0 even when it fails — need to check
            # whether it generated the file.
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
        # Wake up threads that were waiting.
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

    def log_message(self, fmt, *args):  # silence the log by default (noisy)
        log.info("%s - %s", self.address_string(), fmt % args)

    def _parse_and_validate_path(self, parsed):
        """Extract ?path=, validate and check that it is inside one of the
        ALLOWED_ROOTS. Return (Path, None) on success, (None, error_response)
        on error."""
        qs = parse_qs(parsed.query)
        raw = (qs.get("path") or [""])[0]
        if not raw:
            return None, {"code": 400, "body": {"status": "bad_request", "reason": "missing path"}}
        try:
            target = Path(raw).resolve()
        except (OSError, ValueError) as e:
            return None, {"code": 400, "body": {"status": "bad_request", "reason": str(e)}}
        if not ALLOWED_ROOTS:
            return None, {
                "code": 500,
                "body": {
                    "status": "config_error",
                    "reason": "Cap arrel permesa configurada (ONEDRIVE_WARMUP_ALLOWED_ROOTS o VAULT_HOST_PATH)",
                },
            }
        for root in ALLOWED_ROOTS:
            try:
                target.relative_to(root)
                return target, None
            except ValueError:
                continue
        return None, {
            "code": 403,
            "body": {
                "status": "out_of_scope",
                "path": str(target),
                "allowed_roots": [str(r) for r in ALLOWED_ROOTS],
            },
        }

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler API)
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            return self._send_json(
                200,
                {"status": "ok", "allowed_roots": [str(r) for r in ALLOWED_ROOTS]},
            )

        if parsed.path == "/thumb":
            target, err = self._parse_and_validate_path(parsed)
            if err:
                return self._send_json(err["code"], err["body"])
            qs = parse_qs(parsed.query)
            try:
                size = int((qs.get("size") or ["256"])[0])
            except ValueError:
                size = 256
            size = max(64, min(size, 1024))  # clamp to a reasonable range
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
    global ALLOWED_ROOTS
    ALLOWED_ROOTS = _parse_allowed_roots()
    if not ALLOWED_ROOTS:
        log.error(
            "Cap arrel permesa: defineix ONEDRIVE_WARMUP_ALLOWED_ROOTS "
            "(':'-separat) o VAULT_HOST_PATH. Surto."
        )
        return 2

    server = ThreadingHTTPServer((BIND, PORT), WarmupHandler)
    log.info(
        "OneDrive warmup daemon escoltant a http://%s:%d (allowed_roots=%s)",
        BIND, PORT, [str(r) for r in ALLOWED_ROOTS],
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Aturant per Ctrl-C")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
