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
    POST /search            → {"query": "foo", "limit": 100, "roots": [...]}
                              Cerca per nom amb Spotlight (`mdfind`), ràpida
                              gràcies a l'índex viu del sistema.
                              Resposta: {"results": [...], "truncated": bool}

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


# Components de ruta no-ocults que mai volem als resultats de cerca. Els
# components ocults (que comencen amb ".") es filtren a part a _is_noise_path.
_SEARCH_SKIP_COMPONENTS = {"node_modules", "__pycache__", "Trash"}


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _is_noise_path(path: Path) -> bool:
    """True si la ruta passa per una carpeta sorollosa o oculta.

    Manté la cerca neta: dependències, caches/VCS, paperera i qualsevol
    component ocult (.history, .git, .cache…). És el mateix criteri que el
    walk de fallback del backend.
    """
    for part in path.parts:
        if part in _SEARCH_SKIP_COMPONENTS:
            return True
        if len(part) > 1 and part.startswith("."):
            return True
    return False


def _collapse_roots(roots: list[Path]) -> list[Path]:
    """Elimina roots que ja són dins d'un altre (evita `mdfind` redundants).

    Ex.: el Vault sol viure dins de HOME → passar tots dos faria dues
    passades de Spotlight quan amb HOME ja n'hi ha prou.
    """
    uniq: list[Path] = []
    for r in sorted(set(roots), key=lambda p: len(p.parts)):
        if any(_is_within(r, kept) for kept in uniq):
            continue
        uniq.append(r)
    return uniq


def _run_spotlight_search(query: str, limit: int, roots: list[Path]) -> dict:
    """Cerca per nom amb Spotlight (`mdfind -name`) dins dels roots donats.

    Spotlight manté un índex viu del disc, així que això torna en
    mil·lisegons — a diferència del `os.walk` recursiu del backend, que
    sobre muntatges lents com OneDrive trigava segons.

    `query` es passa com a argv separat (sense shell): no és injectable.
    """
    seen: set[str] = set()
    results: list[dict] = []
    truncated = False
    had_error = False
    errors: list[str] = []

    for root in roots:
        if len(results) >= limit:
            truncated = True
            break
        try:
            proc = subprocess.run(
                ["mdfind", "-onlyin", str(root), "-name", query],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            had_error = True
            errors.append(f"{root}: {exc}")
            continue
        if proc.returncode != 0:
            had_error = True
            errors.append(
                f"{root}: mdfind exit {proc.returncode}: "
                f"{(proc.stderr or '').strip()[:200]}"
            )
            continue

        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            p = Path(line)
            real = str(p)
            if real in seen or _is_noise_path(p):
                continue
            seen.add(real)
            try:
                is_dir = p.is_dir()
            except OSError:
                is_dir = False
            results.append({"name": p.name, "path": real, "is_dir": is_dir})
            if len(results) >= limit:
                truncated = True
                break

    return {
        "results": results,
        "truncated": truncated,
        "had_error": had_error,
        "errors": errors,
    }


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

    def _read_json_body(self) -> dict | None:
        """Llegeix i parseja el body JSON. Retorna None (i respon 400) si falla."""
        length = int(self.headers.get("Content-Length", "0"))
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"detail": "invalid JSON"})
            return None

    def do_POST(self) -> None:
        if self.path == "/open":
            self._handle_open()
        elif self.path == "/search":
            self._handle_search()
        else:
            self._send(404, {"detail": "not found"})

    def _handle_open(self) -> None:
        payload = self._read_json_body()
        if payload is None:
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

    def _handle_search(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return
        query = str((payload or {}).get("query") or "").strip()
        if len(query) < 2:
            self._send(400, {"detail": "query too short (min 2 chars)"})
            return
        try:
            limit = int((payload or {}).get("limit") or 100)
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(500, limit))

        # Roots: rutes (HOST) on cercar. Validem que existeixin i estiguin
        # dins de les arrels permeses (mateixa allowlist que /open); si no
        # en queda cap de vàlida, fem servir HOME.
        roots: list[Path] = []
        for raw in (payload or {}).get("roots") or []:
            try:
                p = Path(str(raw)).expanduser().resolve()
            except Exception:
                continue
            if p.is_dir() and _is_path_allowed(p):
                roots.append(p)
        if not roots:
            roots = [HOME]
        roots = _collapse_roots(roots)

        try:
            outcome = _run_spotlight_search(query, limit, roots)
        except Exception as exc:
            LOG.exception("search failed")
            self._send(500, {"detail": f"search failed: {exc}"})
            return

        # Cap resultat + mdfind ha fallat → 500, perquè el backend faci
        # fallback al seu os.walk. Si hi ha resultats (encara que parcials),
        # els tornem amb truncated=True.
        if not outcome["results"] and outcome["had_error"]:
            self._send(500, {
                "detail": "spotlight search failed",
                "errors": outcome["errors"],
            })
            return

        self._send(200, {
            "results": outcome["results"],
            "truncated": bool(outcome["truncated"] or outcome["had_error"]),
            "engine": "spotlight",
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
