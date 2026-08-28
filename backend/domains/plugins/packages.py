"""Safe installation, removal and deterministic packaging of plugins."""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import IO, cast

from backend.domains.plugins.contracts import PluginError, PluginManifest
from backend.domains.plugins.storage import ManifestValidator

PluginDirResolver = Callable[[Path, str], Path]
PluginsDirResolver = Callable[[Path], Path]
ManifestReader = Callable[[Path, str], Mapping[str, object]]
CopyFile = Callable[[IO[bytes], IO[bytes]], object]
RemoveTree = Callable[..., object]
MakeTemporaryDirectory = Callable[..., str]


def find_manifest_root(archive: zipfile.ZipFile) -> str:
    """Return the root or unique top-level prefix containing a manifest."""

    names = [name for name in archive.namelist() if not name.endswith("/")]
    if "manifest.json" in names:
        return ""
    roots = {name.split("/", 1)[0] for name in names if "/" in name}
    if len(roots) == 1:
        root = next(iter(roots))
        if f"{root}/manifest.json" in names:
            return f"{root}/"
    raise PluginError("The ZIP contains no manifest.json at its root or in a single folder")


def _open_archive(data: bytes, max_zip_bytes: int) -> zipfile.ZipFile:
    if not data:
        raise PluginError("zip buit")
    if len(data) > max_zip_bytes:
        raise PluginError(f"zip massa gran (> {max_zip_bytes // (1024 * 1024)} MB)")
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PluginError(f"zip invàlid: {exc}") from exc


def _validate_archive_size(
    archive: zipfile.ZipFile,
    max_entries: int,
    max_uncompressed: int,
) -> list[zipfile.ZipInfo]:
    infos = archive.infolist()
    if len(infos) > max_entries:
        raise PluginError("el zip té massa entrades")
    if sum(info.file_size for info in infos) > max_uncompressed:
        raise PluginError("contingut descomprimit massa gran")
    return infos


def _read_archive_manifest(
    archive: zipfile.ZipFile,
    prefix: str,
    validate_manifest: ManifestValidator,
) -> PluginManifest:
    try:
        raw: object = json.loads(archive.read(f"{prefix}manifest.json").decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise PluginError(f"manifest.json il·legible al zip: {exc}") from exc
    return cast(PluginManifest, validate_manifest(raw))


def _require_supported_api(
    manifest: PluginManifest,
    plugin_api_version: int,
) -> None:
    requested = manifest["apiVersion"]
    if requested > plugin_api_version:
        raise PluginError(
            "el plugin necessita una versió més nova de Gnosi "
            f"(apiVersion {requested} > {plugin_api_version})"
        )


def _extract_archive(
    archive: zipfile.ZipFile,
    infos: list[zipfile.ZipInfo],
    prefix: str,
    stage: Path,
    copy_file: CopyFile,
) -> None:
    stage_resolved = stage.resolve()
    for info in infos:
        name = info.filename
        if prefix and not name.startswith(prefix):
            continue
        relative = name[len(prefix) :]
        if not relative or relative.endswith("/"):
            continue
        output = (stage / relative).resolve()
        if stage_resolved not in output.parents and output != stage_resolved:
            raise PluginError(f"entrada de zip insegura: {name}")
        output.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info) as source, output.open("wb") as destination:
            copy_file(source, destination)


def _require_declared_entries(stage: Path, manifest: PluginManifest) -> None:
    for entry_name in (manifest.get("main"), manifest.get("backend")):
        if entry_name and not (stage / entry_name).is_file():
            raise PluginError(f"plugin entry is missing from the ZIP: {entry_name}")


def _restore_backup(
    backup: Path | None,
    destination: Path,
) -> None:
    if backup and backup.exists() and not destination.exists():
        backup.replace(destination)


def install_from_zip(
    config_dir: Path,
    data: bytes,
    *,
    overwrite: bool,
    max_zip_bytes: int,
    max_uncompressed: int,
    max_entries: int,
    plugin_api_version: int,
    find_manifest_root: Callable[[zipfile.ZipFile], str],
    validate_manifest: ManifestValidator,
    resolve_plugin_dir: PluginDirResolver,
    resolve_plugins_dir: PluginsDirResolver,
    make_temporary_directory: MakeTemporaryDirectory,
    copy_file: CopyFile,
    remove_tree: RemoveTree,
    uuid_hex: Callable[[], str],
) -> PluginManifest:
    """Install a validated plugin ZIP with containment and rollback guards."""

    archive = _open_archive(data, max_zip_bytes)
    infos = _validate_archive_size(archive, max_entries, max_uncompressed)
    prefix = find_manifest_root(archive)
    manifest = _read_archive_manifest(archive, prefix, validate_manifest)
    _require_supported_api(manifest, plugin_api_version)
    plugin_id = manifest["id"]
    destination = resolve_plugin_dir(config_dir, plugin_id)
    if destination.exists() and not overwrite:
        raise PluginError(f"el plugin {plugin_id!r} ja està instal·lat")

    base = resolve_plugins_dir(config_dir)
    base.mkdir(parents=True, exist_ok=True)
    stage = Path(make_temporary_directory(prefix=f".{plugin_id}-stage-", dir=base))
    backup: Path | None = None
    try:
        _extract_archive(archive, infos, prefix, stage, copy_file)
        _require_declared_entries(stage, manifest)
        if destination.exists():
            backup = base / f".{plugin_id}-backup-{uuid_hex()}"
            destination.replace(backup)
        stage.replace(destination)
        if backup:
            remove_tree(backup, ignore_errors=True)
        return manifest
    except Exception:
        _restore_backup(backup, destination)
        raise
    finally:
        remove_tree(stage, ignore_errors=True)


def package_plugin(
    config_dir: Path,
    plugin_id: str,
    *,
    read_manifest: ManifestReader,
    resolve_plugin_dir: PluginDirResolver,
    provenance_file: str,
) -> bytes:
    """Return a deterministic ZIP for one installed validated plugin."""

    manifest = read_manifest(config_dir, plugin_id)
    source = resolve_plugin_dir(config_dir, plugin_id)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*"), key=lambda item: item.as_posix().casefold()):
            if not path.is_file() or path.name == provenance_file or path.is_symlink():
                continue
            relative = path.relative_to(source).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    if manifest["id"] != plugin_id:
        raise PluginError("plugin manifest changed while packaging")
    return buffer.getvalue()


def uninstall(
    config_dir: Path,
    plugin_id: str,
    *,
    resolve_plugin_dir: PluginDirResolver,
    remove_tree: RemoveTree,
) -> None:
    """Remove one installed plugin directory without touching state."""

    destination = resolve_plugin_dir(config_dir, plugin_id)
    if destination.exists():
        remove_tree(destination)
