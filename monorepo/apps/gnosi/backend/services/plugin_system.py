"""Gnosi plugin system v2 — discovery, manifest and permissions.

Extends the v1 registry (internal features, `.gnosi/plugins.json`) to
THIRD-PARTY plugins loadable from `.gnosi/plugins/<id>/`. This module is the
pure DATA layer of the core (phase 1 of `docs/dev_memory/directives/plugin_system.md`):

  * Discovers installed plugins by reading their `manifest.json`.
  * Validates the manifest (safe id, version, known declared permissions).
  * Governs the PERMISSIONS model: a plugin can only do what it has declared in
    the manifest AND the user has approved (persisted in `.gnosi/plugins.json` →
    `granted[<id>] = [perms]`).

Security boundary: NO third-party code runs here. Execution lives in the
UI sandbox (iframe, frontend) and the data sandbox (`plugin_sandbox.py`,
restricted Node subprocess). This module only decides WHAT is allowed.

Almost-pure module: only file-read I/O of the plugins directory and of
the state. It does not import routers or heavy services.
"""
from __future__ import annotations

import io
import json
import re
import shutil
import threading
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Permission catalog. A plugin must declare them in the manifest; the user
# approves them on install. Without the permission, the corresponding API does NOT exist for the
# plugin (neither in the UI bridge nor in the data sandbox).
# ---------------------------------------------------------------------------
PERMISSIONS: Dict[str, str] = {
    "vault:read": "Read vault pages and tables",
    "vault:write": "Create and modify vault pages",
    "vault:delete": "Delete vault pages",
    "network": "Make network requests to external servers",
    "ui:command": "Add commands to the palette and menus",
    "ui:view": "Register custom views and screens",
    "ui:sidebar": "Add panels to the sidebar",
    "settings": "Save the plugin's own settings",
}

# Permissions that involve execution on the backend (data sandbox). The rest are
# UI-only (frontend). Used to decide whether the Node sandbox needs to be started.
BACKEND_PERMISSIONS = {"vault:read", "vault:write", "vault:delete", "network"}

# MAJOR version of the plugin API that this Gnosi implements. A plugin declares
# `apiVersion` in the manifest; if it asks for a HIGHER major, the host refuses it (the
# plugin needs a newer Gnosi). Increment it ONLY on API changes
# that are incompatible. Plugins that don't declare it assume 1 (backward compat).
PLUGIN_API_VERSION = 1

# safe plugin id as a path segment (same policy as _PAGE_ID_RE from
# vault_routes: blocks `..`, `/`, `\`, leading dots → anti path-traversal).
_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$")

_state_lock = threading.Lock()


class PluginError(Exception):
    """Invalid manifest or disallowed plugin operation."""


def is_valid_plugin_id(pid: Any) -> bool:
    return bool(pid) and isinstance(pid, str) and bool(_PLUGIN_ID_RE.match(pid))


def plugins_dir(config_dir: Path) -> Path:
    """Root directory of installed plugins: `.gnosi/plugins/`."""
    return Path(config_dir) / "plugins"


def plugin_dir(config_dir: Path, plugin_id: str) -> Path:
    """Directory of a specific plugin, validating the id against path traversal."""
    if not is_valid_plugin_id(plugin_id):
        raise PluginError(f"Invalid plugin id: {plugin_id!r}")
    base = plugins_dir(config_dir).resolve()
    target = (base / plugin_id).resolve()
    # Defense in depth: the result must stay INSIDE plugins/.
    if base not in target.parents and target != base:
        raise PluginError("Plugin path escapes plugins dir")
    return target


def validate_manifest(raw: Any) -> Dict[str, Any]:
    """Validates and normalizes a manifest.json. Raises PluginError if invalid.

    Fields: id (required, safe), version (semver), name, description, icon,
    main (frontend entry, optional), backend (data entry, optional),
    permissions (subset of PERMISSIONS), author/homepage (optional).
    
    """
    if not isinstance(raw, dict):
        raise PluginError("manifest.json must be a JSON object")

    pid = raw.get("id")
    if not is_valid_plugin_id(pid):
        raise PluginError(
            f"invalid plugin ID: {pid!r} (lowercase [a-z0-9_-], 2–64 characters)"
        )

    version = str(raw.get("version") or "0.0.0")
    if not _SEMVER_RE.match(version):
        raise PluginError(f"invalid semantic version: {version!r}")

    perms_raw = raw.get("permissions") or []
    if not isinstance(perms_raw, list):
        raise PluginError("permissions must be a list")
    permissions: List[str] = []
    for p in perms_raw:
        if p not in PERMISSIONS:
            raise PluginError(f"unknown permission: {p!r}")
        if p not in permissions:
            permissions.append(p)

    def _rel(entry: Any) -> Optional[str]:
        """Normalize a safe relative entry (no `..`, not absolute)."""
        if not entry:
            return None
        s = str(entry).strip().lstrip("/")
        if not s or ".." in s.split("/"):
            raise PluginError(f"entry invàlid: {entry!r}")
        return s

    events_raw = raw.get("events") or []
    if not isinstance(events_raw, list):
        raise PluginError("events ha de ser una llista")
    events = [str(e) for e in events_raw if str(e).strip()]

    # apiVersion: major integer of the API the plugin expects. Defaults to 1.
    try:
        api_version = int(raw.get("apiVersion", 1))
    except (TypeError, ValueError):
        raise PluginError("apiVersion ha de ser un enter")
    if api_version < 1:
        raise PluginError("apiVersion ha de ser >= 1")

    return {
        "id": pid,
        "version": version,
        "apiVersion": api_version,
        "name": str(raw.get("name") or pid),
        "description": str(raw.get("description") or ""),
        "icon": str(raw.get("icon") or "Puzzle"),
        "main": _rel(raw.get("main")),
        "backend": _rel(raw.get("backend")),
        # Bus events that the backend entry subscribes to. Without
        # this list, a data plugin receives no calls at all (avoids starting
        # Node for events it doesn't care about).
        "events": events,
        "permissions": permissions,
        "author": str(raw.get("author") or ""),
        "homepage": str(raw.get("homepage") or ""),
    }


def read_manifest(config_dir: Path, plugin_id: str) -> Dict[str, Any]:
    """Read and validate the manifest of an installed plugin."""
    pdir = plugin_dir(config_dir, plugin_id)
    mpath = pdir / "manifest.json"
    if not mpath.exists():
        raise PluginError(f"manifest.json no trobat per {plugin_id!r}")
    try:
        raw = json.loads(mpath.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        raise PluginError(f"manifest.json il·legible: {e}") from e
    manifest = validate_manifest(raw)
    if manifest["id"] != plugin_id:
        raise PluginError(
            f"id del manifest ({manifest['id']!r}) no coincideix amb la carpeta ({plugin_id!r})"
        )
    if manifest["apiVersion"] > PLUGIN_API_VERSION:
        raise PluginError(
            f"el plugin necessita una versió més nova de Gnosi "
            f"(apiVersion {manifest['apiVersion']} > {PLUGIN_API_VERSION})"
        )
    return manifest


def discover_plugins(config_dir: Path) -> List[Dict[str, Any]]:
    """Lists installed third-party plugins with the validated manifest.

    Those with an invalid manifest are included with `error` instead of a
    manifest, so the management panel can show them as broken (they are not
    hidden silently).
    
    """
    base = plugins_dir(config_dir)
    out: List[Dict[str, Any]] = []
    if not base.exists():
        return out
    for entry in sorted(base.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        pid = entry.name
        if not is_valid_plugin_id(pid):
            out.append({"id": pid, "error": "id de carpeta invàlid"})
            continue
        try:
            out.append({"manifest": read_manifest(config_dir, pid)})
        except PluginError as e:
            out.append({"id": pid, "error": str(e)})
    return out


# ---------------------------------------------------------------------------
# State of granted permissions. Stored inside `.gnosi/plugins.json` (same
# file as v1) under the `granted` key, so as not to fragment the plugin state.
# The load/save of the whole file lives in vault_routes (_load/_save_plugins_state);
# here we only offer pure helpers over the state dict.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Installing / uninstalling plugins from a .zip.
# ---------------------------------------------------------------------------
# A .zip with manifest.json at the root (or inside a single root folder). The manifest
# is validated BEFORE writing anything, and the extraction is anti zip-slip.
_MAX_ZIP_BYTES = 20 * 1024 * 1024      # 20 MB of compressed zip
_MAX_UNCOMPRESSED = 80 * 1024 * 1024   # 80 MB uncompressed (anti-zip-bomb)
_MAX_ENTRIES = 2000


def _find_manifest_root(zf: zipfile.ZipFile) -> str:
    """Returns the internal prefix where manifest.json lives (root or single subfolder).

    Accepts `manifest.json` at the zip root or inside exactly one top-level
    folder (the typical case when the plugin folder is zipped).
    
    """
    names = [n for n in zf.namelist() if not n.endswith("/")]
    if "manifest.json" in names:
        return ""
    roots = {n.split("/", 1)[0] for n in names if "/" in n}
    if len(roots) == 1:
        root = next(iter(roots))
        if f"{root}/manifest.json" in names:
            return f"{root}/"
    raise PluginError("The ZIP contains no manifest.json at its root or in a single folder")


def install_from_zip(config_dir: Path, data: bytes, *, overwrite: bool = True) -> Dict[str, Any]:
    """Installs a plugin from the bytes of a .zip. Returns the installed manifest.

    Steps: size → open zip → locate+validate manifest → extract with anti
    zip-slip/zip-bomb guards into `.gnosi/plugins/<id>/`. Fail-closed: if the
    manifest is invalid, nothing is written.
    
    """
    if not data:
        raise PluginError("zip buit")
    if len(data) > _MAX_ZIP_BYTES:
        raise PluginError(f"zip massa gran (> {_MAX_ZIP_BYTES // (1024*1024)} MB)")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise PluginError(f"zip invàlid: {e}") from e

    infos = zf.infolist()
    if len(infos) > _MAX_ENTRIES:
        raise PluginError("el zip té massa entrades")
    total = sum(i.file_size for i in infos)
    if total > _MAX_UNCOMPRESSED:
        raise PluginError("contingut descomprimit massa gran")

    prefix = _find_manifest_root(zf)
    try:
        raw = json.loads(zf.read(f"{prefix}manifest.json").decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise PluginError(f"manifest.json il·legible al zip: {e}") from e
    manifest = validate_manifest(raw)
    if manifest["apiVersion"] > PLUGIN_API_VERSION:
        raise PluginError(
            f"el plugin necessita una versió més nova de Gnosi "
            f"(apiVersion {manifest['apiVersion']} > {PLUGIN_API_VERSION})"
        )
    pid = manifest["id"]

    dest = plugin_dir(config_dir, pid)  # validates the id against path-traversal
    if dest.exists():
        if not overwrite:
            raise PluginError(f"el plugin {pid!r} ja està instal·lat")
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    dest_resolved = dest.resolve()

    for info in infos:
        name = info.filename
        if prefix and not name.startswith(prefix):
            continue
        rel = name[len(prefix):]
        if not rel or rel.endswith("/"):
            continue
        # Anti zip-slip: the resolved path must stay INSIDE dest.
        out = (dest / rel).resolve()
        if dest_resolved not in out.parents and out != dest_resolved:
            shutil.rmtree(dest, ignore_errors=True)
            raise PluginError(f"entrada de zip insegura: {name}")
        out.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst)

    return manifest


def uninstall(config_dir: Path, plugin_id: str) -> None:
    """Deletes an installed plugin's directory. Does not touch the state (granted/disabled)."""
    dest = plugin_dir(config_dir, plugin_id)
    if dest.exists():
        shutil.rmtree(dest)


def granted_permissions(state: Dict[str, Any], plugin_id: str) -> List[str]:
    granted = state.get("granted") or {}
    vals = granted.get(plugin_id) or []
    return [v for v in vals if v in PERMISSIONS]


def has_permission(state: Dict[str, Any], plugin_id: str, permission: str) -> bool:
    """True if the plugin is active AND has the permission granted by the user."""
    if plugin_id in set(state.get("disabled") or []):
        return False
    return permission in granted_permissions(state, plugin_id)


def set_granted(state: Dict[str, Any], plugin_id: str, permissions: List[str]) -> Dict[str, Any]:
    """Returns a copy of the state with the granted permissions updated.

    Only accepts known permissions; the rest are silently discarded.
    
    """
    clean = [p for p in (permissions or []) if p in PERMISSIONS]
    granted = dict(state.get("granted") or {})
    if clean:
        granted[plugin_id] = clean
    else:
        granted.pop(plugin_id, None)
    new_state = dict(state)
    new_state["granted"] = granted
    return new_state
