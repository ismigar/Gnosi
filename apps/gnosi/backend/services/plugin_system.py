"""Sistema de plugins v2 de Gnosi — descobriment, manifest i permisos.

Estén el registre v1 (features internes, `.gnosi/plugins.json`) cap a plugins de
TERCERS carregables des de `.gnosi/plugins/<id>/`. Aquest mòdul és la capa de
DADES pura del nucli (fase 1 de `docs/dev_memory/directives/plugin_system.md`):

  * Descobreix plugins instal·lats llegint-ne el `manifest.json`.
  * Valida el manifest (id segur, versió, permisos declarats coneguts).
  * Governa el model de PERMISOS: un plugin només pot fer el que ha declarat al
    manifest I l'usuari ha aprovat (persistit a `.gnosi/plugins.json` →
    `granted[<id>] = [perms]`).

Frontera de seguretat: aquí NO s'executa codi de tercers. L'execució viu al
sandbox de UI (iframe, frontend) i al sandbox de dades (`plugin_sandbox.py`,
subprocés Node capat). Aquest mòdul només decideix QUÈ està permès.

Mòdul quasi pur: només I/O de lectura de fitxers del directori de plugins i de
l'estat. No importa routers ni serveis pesants.
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
# Catàleg de permisos. Un plugin ha de declarar-los al manifest; l'usuari els
# aprova en instal·lar. Sense el permís, l'API corresponent NO existeix per al
# plugin (ni al bridge de UI ni al sandbox de dades).
# ---------------------------------------------------------------------------
PERMISSIONS: Dict[str, str] = {
    "vault:read": "Llegir pàgines i taules del vault",
    "vault:write": "Crear i modificar pàgines del vault",
    "vault:delete": "Esborrar pàgines del vault",
    "network": "Fer peticions de xarxa a servidors externs",
    "ui:command": "Afegir comandes a la paleta i menús",
    "ui:view": "Registrar vistes/pantalles pròpies",
    "ui:sidebar": "Afegir panells a la barra lateral",
    "settings": "Desar la seva pròpia configuració",
}

# Permisos que impliquen execució al backend (sandbox de dades). La resta són
# només de UI (frontend). Serveix per decidir si cal arrencar el sandbox Node.
BACKEND_PERMISSIONS = {"vault:read", "vault:write", "vault:delete", "network"}

# Versió MAJOR de l'API de plugins que aquest Gnosi implementa. Un plugin declara
# `apiVersion` al manifest; si demana una major SUPERIOR, el host la refusa (el
# plugin necessita un Gnosi més nou). Incrementar-la NOMÉS en canvis d'API
# incompatibles. Els plugins que no la declaren assumeixen 1 (compat enrere).
PLUGIN_API_VERSION = 1

# id de plugin segur com a segment de path (mateixa política que _PAGE_ID_RE de
# vault_routes: bloqueja `..`, `/`, `\`, punts inicials → anti path-traversal).
_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$")

_state_lock = threading.Lock()


class PluginError(Exception):
    """Manifest invàlid o operació de plugin no permesa."""


def is_valid_plugin_id(pid: Any) -> bool:
    return bool(pid) and isinstance(pid, str) and bool(_PLUGIN_ID_RE.match(pid))


def plugins_dir(config_dir: Path) -> Path:
    """Directori arrel dels plugins instal·lats: `.gnosi/plugins/`."""
    return Path(config_dir) / "plugins"


def plugin_dir(config_dir: Path, plugin_id: str) -> Path:
    """Directori d'un plugin concret, validant l'id contra path-traversal."""
    if not is_valid_plugin_id(plugin_id):
        raise PluginError(f"Invalid plugin id: {plugin_id!r}")
    base = plugins_dir(config_dir).resolve()
    target = (base / plugin_id).resolve()
    # Defensa en profunditat: el resultat ha de quedar DINS de plugins/.
    if base not in target.parents and target != base:
        raise PluginError("Plugin path escapes plugins dir")
    return target


def validate_manifest(raw: Any) -> Dict[str, Any]:
    """Valida i normalitza un manifest.json. Llança PluginError si invàlid.

    Camps: id (obligatori, segur), version (semver), name, description, icon,
    main (entry frontend, opcional), backend (entry dades, opcional),
    permissions (subconjunt de PERMISSIONS), author/homepage (opcionals).
    """
    if not isinstance(raw, dict):
        raise PluginError("manifest.json ha de ser un objecte JSON")

    pid = raw.get("id")
    if not is_valid_plugin_id(pid):
        raise PluginError(
            f"id de plugin invàlid: {pid!r} (minúscules, [a-z0-9_-], 2-64 chars)"
        )

    version = str(raw.get("version") or "0.0.0")
    if not _SEMVER_RE.match(version):
        raise PluginError(f"version invàlida (semver): {version!r}")

    perms_raw = raw.get("permissions") or []
    if not isinstance(perms_raw, list):
        raise PluginError("permissions ha de ser una llista")
    permissions: List[str] = []
    for p in perms_raw:
        if p not in PERMISSIONS:
            raise PluginError(f"permís desconegut: {p!r}")
        if p not in permissions:
            permissions.append(p)

    def _rel(entry: Any) -> Optional[str]:
        """Normalitza un entry relatiu segur (sense `..`, sense absolut)."""
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

    # apiVersion: major enter de l'API que el plugin espera. Per defecte 1.
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
        # Esdeveniments del bus als quals se subscriu l'entry backend. Sense
        # aquesta llista, un plugin de dades no rep cap crida (evita arrencar
        # Node per esdeveniments que no li interessen).
        "events": events,
        "permissions": permissions,
        "author": str(raw.get("author") or ""),
        "homepage": str(raw.get("homepage") or ""),
    }


def read_manifest(config_dir: Path, plugin_id: str) -> Dict[str, Any]:
    """Llegeix i valida el manifest d'un plugin instal·lat."""
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
    """Llista els plugins de tercers instal·lats amb el manifest validat.

    Els que tenen manifest invàlid s'inclouen amb `error` en lloc de manifest,
    perquè el panell de gestió pugui mostrar-los com a trencats (no s'amaguen
    silenciosament).
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
# Estat de permisos concedits. Es guarda dins de `.gnosi/plugins.json` (mateix
# fitxer que v1) sota la clau `granted`, per no fragmentar l'estat de plugins.
# El load/save del fitxer sencer viu a vault_routes (_load/_save_plugins_state);
# aquí només oferim helpers purs sobre el dict d'estat.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Instal·lació / desinstal·lació de plugins des d'un .zip.
# ---------------------------------------------------------------------------
# Un .zip amb el manifest.json a l'arrel (o dins d'una única carpeta arrel). Es
# valida el manifest ABANS d'escriure res, i l'extracció és anti zip-slip.
_MAX_ZIP_BYTES = 20 * 1024 * 1024      # 20 MB de zip comprimit
_MAX_UNCOMPRESSED = 80 * 1024 * 1024   # 80 MB descomprimits (anti zip-bomb)
_MAX_ENTRIES = 2000


def _find_manifest_root(zf: zipfile.ZipFile) -> str:
    """Retorna el prefix intern on viu el manifest.json (arrel o subcarpeta única).

    Accepta `manifest.json` a l'arrel del zip o dins d'exactament una carpeta de
    primer nivell (cas típic quan es comprimeix la carpeta del plugin).
    """
    names = [n for n in zf.namelist() if not n.endswith("/")]
    if "manifest.json" in names:
        return ""
    roots = {n.split("/", 1)[0] for n in names if "/" in n}
    if len(roots) == 1:
        root = next(iter(roots))
        if f"{root}/manifest.json" in names:
            return f"{root}/"
    raise PluginError("El zip no conté manifest.json a l'arrel ni en una única carpeta")


def install_from_zip(config_dir: Path, data: bytes, *, overwrite: bool = True) -> Dict[str, Any]:
    """Instal·la un plugin des dels bytes d'un .zip. Retorna el manifest instal·lat.

    Passos: mida → obrir zip → localitzar+validar manifest → extreure amb guàrdies
    anti zip-slip/zip-bomb a `.gnosi/plugins/<id>/`. Fail-closed: si el manifest
    és invàlid, no s'escriu res.
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

    dest = plugin_dir(config_dir, pid)  # valida l'id contra path-traversal
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
        # Anti zip-slip: la ruta resolta ha de quedar DINS de dest.
        out = (dest / rel).resolve()
        if dest_resolved not in out.parents and out != dest_resolved:
            shutil.rmtree(dest, ignore_errors=True)
            raise PluginError(f"entrada de zip insegura: {name}")
        out.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst)

    return manifest


def uninstall(config_dir: Path, plugin_id: str) -> None:
    """Esborra el directori d'un plugin instal·lat. No toca l'estat (granted/disabled)."""
    dest = plugin_dir(config_dir, plugin_id)
    if dest.exists():
        shutil.rmtree(dest)


def granted_permissions(state: Dict[str, Any], plugin_id: str) -> List[str]:
    granted = state.get("granted") or {}
    vals = granted.get(plugin_id) or []
    return [v for v in vals if v in PERMISSIONS]


def has_permission(state: Dict[str, Any], plugin_id: str, permission: str) -> bool:
    """True si el plugin està actiu I té el permís concedit per l'usuari."""
    if plugin_id in set(state.get("disabled") or []):
        return False
    return permission in granted_permissions(state, plugin_id)


def set_granted(state: Dict[str, Any], plugin_id: str, permissions: List[str]) -> Dict[str, Any]:
    """Retorna una còpia de l'estat amb els permisos concedits actualitzats.

    Només accepta permisos coneguts; la resta es descarta silenciosament.
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
