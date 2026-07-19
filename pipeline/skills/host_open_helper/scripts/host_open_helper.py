#!/usr/bin/env python3
"""Small HTTP service that listens on 127.0.0.1:5099 and opens files/folders with
the host system's default app.

Why it's needed:
    Gnosi's backend runs inside a Linux Docker container and has no
    access to the Mac's Finder/Explorer. This helper runs on the host and the
    container's backend contacts it via host.docker.internal:5099.

Endpoints:
    GET  /healthz           → {"status": "ok"}
    POST /open              → {"path": "/Users/..."} or {"path": "file:///..."}
                              Response: {"status": "ok", "target": "..."}
    POST /search            → {"query": "foo", "limit": 100, "roots": [...]}
                              Search by name with Spotlight (`mdfind`), fast
                              thanks to the system's live index.
                              Response: {"results": [...], "truncated": bool}
    POST /pick              → {"mode": "file"|"folder"|"any", "prompt": "...",
                               "multiple": bool}
                              Show the real macOS open panel (NSOpenPanel via
                              JXA) and return the chosen POSIX path(s) — the
                              absolute host paths a browser can never read from
                              an <input type=file>. "any" accepts files AND
                              folders in one dialog; `multiple` allows several.
                              Response: {"status": "ok", "path": "...",
                                         "paths": [...], "is_dir": bool,
                                         "entries": [{"path", "is_dir"}, ...]}
                              or {"status": "cancelled"} if the user cancels.
    POST /trash             → {"path": "/Users/..."} or {"path": "file:///..."}
                              Moves the file to the Mac's Trash (RECOVERABLE).
                              Needed because the Docker backend mounts HOME read-only
                              and can't delete files from OneDrive/Library.
                              Response: {"status": "ok", "target": "..."}

Security:
    - Bind to 127.0.0.1 + host.docker.internal port: only localhost+containers.
    - Checks that the path exists before opening.
    - Uses subprocess without a shell.
    - Listens to a list of allowed roots (env GNOSI_OPEN_ROOTS, ':'-separated).
      If empty, accepts any path within the user's HOME.
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
    """List of allowed roots.

    - If `GNOSI_OPEN_ROOTS` is defined (`:`-separated), it's used exactly as given.
    - If empty or not set, we return `[]` which means "any path on the
      system". The helper only listens on 127.0.0.1 and is for personal
      use, so this relaxed restriction is acceptable. To limit it,
      define `GNOSI_OPEN_ROOTS=/Users/<usuari>:/Volumes` in the plist.
    
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
        return True  # no restriction (see _allowed_roots)
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


def _move_to_trash(path: Path) -> None:
    """Moves a file to the system Trash (RECOVERABLE, not a hard delete).

    On macOS this is done by Finder via `osascript`. The path is passed as argv
    (`on run argv`), without shell or interpolation → not injectable. If
    Finder can't (e.g. file no longer exists), osascript returns a code != 0 and
    we propagate the error.
    
    """
    if sys.platform == "darwin":
        script = (
            "on run argv\n"
            '  tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)\n'
            "end run"
        )
        proc = subprocess.run(
            ["osascript", "-e", script, str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or "osascript error").strip())
        return
    raise RuntimeError("trash no suportat en aquesta plataforma")


# Separator between the paths osascript prints when several files are chosen.
# A newline would be ambiguous: macOS filenames may legally contain one (only
# "/" and NUL are forbidden), so a multi-pick of such a file would split into
# two bogus paths. ASCII 30 (record separator) is a control character no file
# manager can type into a name.
_PICK_SEP = "\x1e"


# JXA (JavaScript for Automation) driving AppKit's real NSOpenPanel — the same
# panel Finder-aware apps show. AppleScript's `choose file`/`choose folder` are
# two different commands, so they can never offer files AND folders in one
# dialog; NSOpenPanel takes both as independent flags, which is what the picker's
# 'any' mode needs. `setActivationPolicy(0)` (Regular) plus
# `activateIgnoringOtherApps` bring it to the front — the helper is a faceless
# LaunchAgent, so its window would otherwise open behind the browser.
#
# Arguments arrive via argv (never interpolated into the source) → not
# injectable. runModal returns NSModalResponseOK (1) on accept; anything else
# (including cancel) yields an empty string, which the caller reads as
# "cancelled".
_PANEL_JXA = """
ObjC.import('AppKit');
function run(argv) {
  var prompt = argv[0] || '';
  var mode = argv[1] || 'any';
  var multi = argv[2] === 'multi';
  var app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(0);
  var panel = $.NSOpenPanel.openPanel;
  panel.canChooseFiles = (mode !== 'folder');
  panel.canChooseDirectories = (mode !== 'file');
  panel.allowsMultipleSelection = multi;
  panel.message = prompt;
  panel.resolvesAliases = true;
  app.activateIgnoringOtherApps(true);
  if (panel.runModal != 1) return '';
  var urls = panel.URLs;
  var out = [];
  for (var i = 0; i < urls.count; i++) out.push(ObjC.unwrap(urls.objectAtIndex(i).path));
  return out.join(String.fromCharCode(30));
}
"""


def _native_choose(mode: str, prompt: str, multiple: bool = False) -> dict:
    """Show the native macOS open panel and return the chosen POSIX path(s).

    `mode` is "file", "folder" or "any" — "any" accepts both in a single dialog,
    which is why this runs NSOpenPanel rather than AppleScript's `choose file`.
    `multiple` allows picking several entries.

    The result always carries `paths` (a list) plus `path` (the first one) so
    single-pick callers keep working. Cancelling is a normal outcome:
    {"status": "cancelled"}, not an error.

    macOS remembers the panel's last folder per app on its own, so repeated
    picks resume where the user left off.
    """
    if sys.platform != "darwin":
        raise RuntimeError("native picker only supported on macOS")
    normalized = (mode or "any").strip().lower()
    if normalized not in ("file", "folder", "any"):
        normalized = "any"
    proc = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", _PANEL_JXA,
         prompt or "", normalized, "multi" if multiple else "single"],
        capture_output=True, text=True, timeout=3600,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "osascript error").strip())
    raw = (proc.stdout or "").strip()
    if not raw:
        return {"status": "cancelled"}
    paths = [str(Path(chunk)) for chunk in raw.split(_PICK_SEP) if chunk.strip()]
    if not paths:
        return {"status": "cancelled"}
    # A single "any" pick can mix folders and files, so each entry carries its
    # own is_dir: the caller links a folder but registers a file, and a shared
    # top-level flag could only describe the first one.
    entries = [{"path": p, "is_dir": Path(p).is_dir()} for p in paths]
    first = entries[0]
    return {
        "status": "ok",
        "path": first["path"],
        "paths": paths,
        "entries": entries,
        "is_dir": first["is_dir"],
    }


# Non-hidden path components that we never want in search results. The
# hidden components (starting with ".") are filtered separately in _is_noise_path.
_SEARCH_SKIP_COMPONENTS = {"node_modules", "__pycache__", "Trash"}


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _is_noise_path(path: Path) -> bool:
    """True if the path passes through a noisy or hidden folder.

    Keeps the search clean: dependencies, caches/VCS, trash, and any
    hidden component (.history, .git, .cache…). Same criteria as the
    backend's fallback walk.
    
    """
    for part in path.parts:
        if part in _SEARCH_SKIP_COMPONENTS:
            return True
        if len(part) > 1 and part.startswith("."):
            return True
    return False


def _collapse_roots(roots: list[Path]) -> list[Path]:
    """Removes roots that are already inside another one (avoids redundant `mdfind` calls).

    E.g.: the Vault usually lives inside HOME → passing both would do two
    Spotlight passes when HOME alone is already enough.
    
    """
    uniq: list[Path] = []
    for r in sorted(set(roots), key=lambda p: len(p.parts)):
        if any(_is_within(r, kept) for kept in uniq):
            continue
        uniq.append(r)
    return uniq


def _run_spotlight_search(query: str, limit: int, roots: list[Path]) -> dict:
    """Searches by name with Spotlight (`mdfind -name`) within the given roots.

    Spotlight keeps a live index of the disk, so this returns in
    milliseconds — unlike the backend's recursive `os.walk`, which
    took seconds on slow mounts like OneDrive.

    `query` is passed as a separate argv (no shell): it's not injectable.
    
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
        """Reads and parses the JSON body. Returns None (and responds 400) if it fails."""
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
        elif self.path == "/pick":
            self._handle_pick()
        elif self.path == "/trash":
            self._handle_trash()
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

    def _handle_trash(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return
        raw = str((payload or {}).get("path") or "").strip()
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
            _move_to_trash(path)
        except Exception as exc:
            LOG.exception("trash failed")
            self._send(500, {"detail": f"could not trash: {exc}"})
            return
        self._send(200, {"status": "ok", "target": str(path)})

    def _handle_pick(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return
        mode = str((payload or {}).get("mode") or "any").strip().lower()
        if mode not in ("file", "folder", "any"):
            mode = "any"
        prompt = str((payload or {}).get("prompt") or "").strip()
        multiple = bool((payload or {}).get("multiple"))
        try:
            result = _native_choose(mode, prompt, multiple)
        except Exception as exc:
            LOG.exception("pick failed")
            self._send(500, {"detail": f"could not pick: {exc}"})
            return
        self._send(200, result)

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

        # Roots: paths (HOST) to search in. We validate that they exist and are
        # within the allowed roots (same allowlist as /open); if none
        # remain valid, we use HOME.
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

        # No results + mdfind failed → 500, so the backend falls
        # back to its own os.walk. If there are results (even partial),
        # we return them with truncated=True.
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
