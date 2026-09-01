"""Compatibility facade for the typed third-party plugin domain.

Historical callers keep importing this module. Manifest validation, storage,
package lifecycle and permission behavior live in ``backend.domains.plugins``.
Every wrapper resolves facade globals at call time so existing test and plugin
monkeypatch seams remain observable during the Gnosi 3 migration.
"""

from __future__ import annotations

import io
import json
import re
import shutil
import tempfile
import threading
import uuid
import zipfile
from collections.abc import Callable as _Callable
from collections.abc import Mapping as _Mapping
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

from backend.config.logger_config import get_logger
from backend.domains.plugins import contracts as _contracts
from backend.domains.plugins import packages as _packages
from backend.domains.plugins import permissions as _permissions
from backend.domains.plugins import storage as _storage

logger = get_logger(__name__)

PERMISSIONS: Dict[str, str] = {
    "vault:read": "Read vault pages and tables",
    "vault:write": "Create and modify vault pages",
    "vault:delete": "Delete vault pages",
    "network": "Make network requests to external servers",
    "ui:command": "Add commands to the palette and menus",
    "ui:view": "Register custom views and screens",
    "ui:sidebar": "Add panels to the sidebar",
    "ui:settings": "Add a sandboxed panel to Settings",
    "settings": "Save the plugin's own settings",
    "ai:skills": "Contribute declarative skills to AI agents",
    "ai:agents": "Contribute managed AI agent templates",
    "ai:tools": "Expose sandboxed plugin actions to contributed AI skills",
}

BACKEND_PERMISSIONS = {"vault:read", "vault:write", "vault:delete", "network"}
PLUGIN_API_VERSION = 2

_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$")
_RESERVED_PLUGIN_IDS = frozenset({"llm-wiki"})
_PROVENANCE_FILE = ".gnosi-provenance.json"
_state_lock = threading.Lock()

_MAX_ZIP_BYTES = 20 * 1024 * 1024
_MAX_UNCOMPRESSED = 80 * 1024 * 1024
_MAX_ENTRIES = 2000

PluginError = _contracts.PluginError
PluginError.__module__ = __name__

# Retain historical module/type attributes used by downstream diagnostics and
# monkeypatches even though domain modules own the implementation.
_COMPATIBILITY_MODULES = (io, json)
_COMPATIBILITY_TYPES = (Optional,)


def is_valid_plugin_id(pid: Any) -> bool:
    return _contracts.is_valid_plugin_id(pid, _PLUGIN_ID_RE)


def plugins_dir(config_dir: Path) -> Path:
    """Root directory of installed plugins: `.gnosi/plugins/`."""

    return _storage.plugins_dir(config_dir)


def plugin_dir(config_dir: Path, plugin_id: str) -> Path:
    """Directory of a specific plugin, validating the id against path traversal."""

    return _storage.plugin_dir(
        config_dir,
        plugin_id,
        is_valid_plugin_id=is_valid_plugin_id,
        resolve_plugins_dir=plugins_dir,
    )


def validate_manifest(raw: Any) -> Dict[str, Any]:
    """Validates and normalizes a manifest.json. Raises PluginError if invalid.

    Fields: id (required, safe), version (semver), name, description, icon,
    main (frontend entry, optional), backend (data entry, optional),
    permissions (subset of PERMISSIONS), author/homepage (optional).

    """

    return dict(
        _contracts.validate_manifest(
            raw,
            permission_catalog=PERMISSIONS,
            plugin_id_pattern=_PLUGIN_ID_RE,
            semver_pattern=_SEMVER_RE,
            reserved_plugin_ids=_RESERVED_PLUGIN_IDS,
        )
    )


def read_manifest(config_dir: Path, plugin_id: str) -> Dict[str, Any]:
    """Read and validate the manifest of an installed plugin."""

    return cast(
        Dict[str, Any],
        _storage.read_manifest(
            config_dir,
            plugin_id,
            resolve_plugin_dir=plugin_dir,
            validate_manifest=validate_manifest,
            plugin_api_version=PLUGIN_API_VERSION,
        ),
    )


def discover_plugins(config_dir: Path) -> List[Dict[str, Any]]:
    """Lists installed third-party plugins with the validated manifest.

    Those with an invalid manifest are included with `error` instead of a
    manifest, so the management panel can show them as broken (they are not
    hidden silently).

    """

    discovered = _storage.discover_plugins(
        config_dir,
        is_valid_plugin_id=is_valid_plugin_id,
        read_manifest=read_manifest,
        resolve_plugins_dir=plugins_dir,
        provenance_file=_PROVENANCE_FILE,
        logger=cast(_storage.WarningLogger, logger),
    )
    return [dict(entry) for entry in discovered]


def _find_manifest_root(zf: zipfile.ZipFile) -> str:
    """Returns the internal prefix where manifest.json lives (root or single subfolder).

    Accepts `manifest.json` at the zip root or inside exactly one top-level
    folder (the typical case when the plugin folder is zipped).

    """

    return _packages.find_manifest_root(zf)


def install_from_zip(config_dir: Path, data: bytes, *, overwrite: bool = True) -> Dict[str, Any]:
    """Installs a plugin from the bytes of a .zip. Returns the installed manifest.

    Steps: size → open zip → locate+validate manifest → extract with anti
    zip-slip/zip-bomb guards into `.gnosi/plugins/<id>/`. Fail-closed: if the
    manifest is invalid, nothing is written.

    """

    manifest = _packages.install_from_zip(
        config_dir,
        data,
        overwrite=overwrite,
        max_zip_bytes=_MAX_ZIP_BYTES,
        max_uncompressed=_MAX_UNCOMPRESSED,
        max_entries=_MAX_ENTRIES,
        plugin_api_version=PLUGIN_API_VERSION,
        find_manifest_root=_find_manifest_root,
        validate_manifest=validate_manifest,
        resolve_plugin_dir=plugin_dir,
        resolve_plugins_dir=plugins_dir,
        make_temporary_directory=tempfile.mkdtemp,
        copy_file=shutil.copyfileobj,
        remove_tree=shutil.rmtree,
        uuid_hex=lambda: uuid.uuid4().hex,
    )
    return cast(Dict[str, Any], manifest)


def write_provenance(config_dir: Path, plugin_id: str, provenance: Dict[str, Any]) -> None:
    """Persist verified installation provenance inside the plugin directory."""

    _storage.write_provenance(
        config_dir,
        plugin_id,
        provenance,
        resolve_plugin_dir=plugin_dir,
        provenance_file=_PROVENANCE_FILE,
    )


def package_plugin(config_dir: Path, plugin_id: str) -> bytes:
    """Return a deterministic ZIP for an installed, validated plugin."""

    return _packages.package_plugin(
        config_dir,
        plugin_id,
        read_manifest=read_manifest,
        resolve_plugin_dir=plugin_dir,
        provenance_file=_PROVENANCE_FILE,
    )


def uninstall(config_dir: Path, plugin_id: str) -> None:
    """Deletes an installed plugin's directory. Does not touch the state (granted/disabled)."""

    _packages.uninstall(
        config_dir,
        plugin_id,
        resolve_plugin_dir=plugin_dir,
        remove_tree=shutil.rmtree,
    )


def granted_permissions(state: Dict[str, Any], plugin_id: str) -> List[str]:
    return _permissions.granted_permissions(state, plugin_id, PERMISSIONS)


def has_permission(state: Dict[str, Any], plugin_id: str, permission: str) -> bool:
    """True if the plugin is active AND has the permission granted by the user."""

    from backend.services import builtin_plugins

    enabled = cast(
        _Callable[[_Mapping[str, object], str], bool],
        builtin_plugins.is_enabled,
    )
    return _permissions.has_permission(
        state,
        plugin_id,
        permission,
        is_enabled=enabled,
        permission_catalog=PERMISSIONS,
    )


def set_granted(state: Dict[str, Any], plugin_id: str, permissions: List[str]) -> Dict[str, Any]:
    """Returns a copy of the state with the granted permissions updated.

    Only accepts known permissions; the rest are silently discarded.

    """

    return dict(
        _permissions.set_granted(
            state,
            plugin_id,
            permissions or [],
            PERMISSIONS,
        )
    )
