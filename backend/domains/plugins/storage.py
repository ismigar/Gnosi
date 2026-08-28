"""Installed plugin paths, manifests, discovery and provenance."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from backend.domains.plugins.contracts import PluginError, PluginManifest


class WarningLogger(Protocol):
    """Narrow logging port used while discovering broken plugins."""

    def warning(self, message: str, *args: object) -> None:
        """Record a non-fatal discovery warning."""


PluginIdValidator = Callable[[object], bool]
ManifestValidator = Callable[[object], Mapping[str, object]]
ManifestReader = Callable[[Path, str], Mapping[str, object]]
PluginsDirResolver = Callable[[Path], Path]


def plugins_dir(config_dir: Path) -> Path:
    """Return the installed plugin root below a Vault configuration directory."""

    return Path(config_dir) / "plugins"


def plugin_dir(
    config_dir: Path,
    plugin_id: str,
    *,
    is_valid_plugin_id: PluginIdValidator,
    resolve_plugins_dir: PluginsDirResolver = plugins_dir,
) -> Path:
    """Resolve a contained plugin directory after validating its identifier."""

    if not is_valid_plugin_id(plugin_id):
        raise PluginError(f"Invalid plugin id: {plugin_id!r}")
    base = resolve_plugins_dir(config_dir).resolve()
    target = (base / plugin_id).resolve()
    if base not in target.parents and target != base:
        raise PluginError("Plugin path escapes plugins dir")
    return target


def _validated_manifest(
    raw: object,
    plugin_id: str,
    *,
    validate_manifest: ManifestValidator,
    plugin_api_version: int,
) -> PluginManifest:
    manifest = validate_manifest(raw)
    if manifest["id"] != plugin_id:
        raise PluginError(
            f"id del manifest ({manifest['id']!r}) no coincideix amb la carpeta ({plugin_id!r})"
        )
    manifest_api_version = cast(int, manifest["apiVersion"])
    if manifest_api_version > plugin_api_version:
        raise PluginError(
            "el plugin necessita una versió més nova de Gnosi "
            f"(apiVersion {manifest_api_version} > {plugin_api_version})"
        )
    return cast(PluginManifest, manifest)


def read_manifest(
    config_dir: Path,
    plugin_id: str,
    *,
    resolve_plugin_dir: Callable[[Path, str], Path],
    validate_manifest: ManifestValidator,
    plugin_api_version: int,
) -> PluginManifest:
    """Read and validate one installed plugin manifest."""

    manifest_path = resolve_plugin_dir(config_dir, plugin_id) / "manifest.json"
    if not manifest_path.exists():
        raise PluginError(f"manifest.json no trobat per {plugin_id!r}")
    try:
        raw: object = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise PluginError(f"manifest.json il·legible: {exc}") from exc
    return _validated_manifest(
        raw,
        plugin_id,
        validate_manifest=validate_manifest,
        plugin_api_version=plugin_api_version,
    )


def _read_provenance(path: Path, plugin_id: str, logger: WarningLogger) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("Plugin provenance is unreadable for %s", plugin_id)
        return None


def discover_plugins(
    config_dir: Path,
    *,
    is_valid_plugin_id: PluginIdValidator,
    read_manifest: ManifestReader,
    resolve_plugins_dir: PluginsDirResolver = plugins_dir,
    provenance_file: str,
    logger: WarningLogger,
) -> list[dict[str, object]]:
    """Discover installed plugins while retaining invalid entries as errors."""

    base = resolve_plugins_dir(config_dir)
    discovered: list[dict[str, object]] = []
    if not base.exists():
        return discovered
    for entry in sorted(base.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        plugin_id = entry.name
        if not is_valid_plugin_id(plugin_id):
            discovered.append({"id": plugin_id, "error": "id de carpeta invàlid"})
            continue
        try:
            item: dict[str, object] = {"manifest": read_manifest(config_dir, plugin_id)}
            provenance_path = entry / provenance_file
            if provenance_path.exists():
                provenance = _read_provenance(provenance_path, plugin_id, logger)
                if isinstance(provenance, dict):
                    item["provenance"] = provenance
            discovered.append(item)
        except PluginError as exc:
            discovered.append({"id": plugin_id, "error": str(exc)})
    return discovered


def write_provenance(
    config_dir: Path,
    plugin_id: str,
    provenance: Mapping[str, object],
    *,
    resolve_plugin_dir: Callable[[Path, str], Path],
    provenance_file: str,
) -> None:
    """Persist verified installation provenance in the plugin directory."""

    target = resolve_plugin_dir(config_dir, plugin_id) / provenance_file
    payload = {
        "sourceUrl": str(provenance.get("sourceUrl") or ""),
        "sha256": str(provenance.get("sha256") or ""),
        "signedBy": provenance.get("signedBy"),
    }
    target.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
