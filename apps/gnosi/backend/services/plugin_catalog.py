"""Catàleg/galeria de plugins (fase 2.2 de plugin_system.md).

Un índex de plugins recomanats, a l'estil dels "community plugins" d'Obsidian,
amb instal·lació d'un clic. Dues fonts d'entrada:

  * `bundled`: plugins d'exemple que viatgen amb Gnosi a `plugins-examples/`. Es
    comprimeixen al vol i es passen a `plugin_system.install_from_zip`.
  * `url`: un .zip remot (requereix xarxa al backend; acció d'administració).

El catàleg es llegeix de `plugins-examples/catalog.json`. Mantenir-lo com a
dades (no codi) permet ampliar-lo sense tocar el backend.
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from backend.config.logger_config import get_logger
from backend.services import plugin_system as ps
from backend.services import plugin_signing

logger = get_logger(__name__)

_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
_MAX_INDEX_BYTES = 2 * 1024 * 1024


def _examples_dir() -> Path:
    # plugin_catalog.py → services → backend → gnosi → plugins-examples/
    return Path(__file__).resolve().parents[2] / "plugins-examples"


def _load_bundled_catalog() -> List[Dict[str, Any]]:
    path = _examples_dir() / "catalog.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        logger.warning("catalog.json il·legible")
        return []
    return data if isinstance(data, list) else []


def fetch_remote_index(url: str) -> List[Dict[str, Any]]:
    """Descarrega un índex remot de plugins (JSON: llista d'entrades `url`).

    Cada entrada pot dur `id`, `name`, `description`, `url` (zip), `sha256` i
    `signature`. Es força `source='url'`. Errors → [] (l'índex remot mai ha de
    tombar la galeria local).
    """
    if not url or not url.lower().startswith(("http://", "https://")):
        return []
    try:
        resp = requests.get(url, timeout=15, stream=True)
        resp.raise_for_status()
        raw = b""
        for chunk in resp.iter_content(64 * 1024):
            raw += chunk
            if len(raw) > _MAX_INDEX_BYTES:
                logger.warning("índex remot massa gran, ignorat")
                return []
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        logger.warning("no s'ha pogut carregar l'índex remot: %s", e)
        return []
    if not isinstance(data, list):
        return []
    out = []
    for e in data:
        if isinstance(e, dict) and e.get("id") and e.get("url"):
            out.append({**e, "source": "url"})
    return out


def load_catalog(registry_url: Optional[str] = None) -> List[Dict[str, Any]]:
    """Catàleg complet: exemples `bundled` + (opcional) índex remot.

    Si es dona `registry_url`, s'hi fusionen les entrades remotes; les locals
    (bundled) tenen prioritat si hi ha col·lisió d'id.
    """
    catalog = _load_bundled_catalog()
    if registry_url:
        seen = {e.get("id") for e in catalog}
        for e in fetch_remote_index(registry_url):
            if e.get("id") not in seen:
                catalog.append(e)
    return catalog


def _zip_dir_bytes(src: Path) -> bytes:
    """Comprimeix un directori (recursiu) a bytes de .zip, rutes relatives."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, str(f.relative_to(src)))
    return buf.getvalue()


def install_bundled(config_dir: Path, entry_id: str) -> Dict[str, Any]:
    """Instal·la un plugin `bundled` del catàleg pel seu id d'entrada."""
    entry = next((e for e in load_catalog() if e.get("id") == entry_id), None)
    if not entry or entry.get("source") != "bundled":
        raise ps.PluginError(f"entrada de catàleg desconeguda: {entry_id!r}")
    # `path` és relatiu a plugins-examples/ i validat contra path-traversal.
    rel = str(entry.get("path") or entry_id)
    if ".." in rel.split("/") or rel.startswith("/"):
        raise ps.PluginError("ruta d'exemple invàlida")
    src = (_examples_dir() / rel).resolve()
    if _examples_dir().resolve() not in src.parents:
        raise ps.PluginError("ruta d'exemple fora del directori d'exemples")
    if not (src / "manifest.json").exists():
        raise ps.PluginError(f"exemple sense manifest: {rel}")
    return ps.install_from_zip(config_dir, _zip_dir_bytes(src), overwrite=True)


def install_from_url(
    config_dir: Path,
    url: str,
    expected_sha256: Optional[str] = None,
    signature: Optional[str] = None,
) -> Dict[str, Any]:
    """Descarrega un .zip i l'instal·la (acció d'administració; requereix xarxa).

    Verificacions ABANS d'instal·lar (fail-closed):
      * `expected_sha256`: integritat (detecta corrupció/manipulació del binari).
      * `signature`: signatura Ed25519 sobre els bytes del zip; ha de verificar
        amb alguna clau del magatzem de confiança. Si es dona però NO verifica →
        es rebutja (editor desconegut o binari alterat). Si NO es dona →
        s'instal·la però el manifest retornat es marca amb `signedBy=None`.
    """
    if not url.lower().startswith(("http://", "https://")):
        raise ps.PluginError("url ha de ser http(s)")
    try:
        resp = requests.get(url, timeout=20, stream=True)
        resp.raise_for_status()
    except Exception as e:  # noqa: BLE001
        raise ps.PluginError(f"no s'ha pogut descarregar: {e}") from e
    data = b""
    for chunk in resp.iter_content(64 * 1024):
        data += chunk
        if len(data) > _MAX_DOWNLOAD_BYTES:
            raise ps.PluginError("descàrrega massa gran")
    if expected_sha256:
        actual = hashlib.sha256(data).hexdigest()
        if actual.lower() != str(expected_sha256).strip().lower():
            raise ps.PluginError(
                f"checksum SHA-256 no coincideix (esperat {expected_sha256[:12]}…, obtingut {actual[:12]}…)"
            )
    signed_by = None
    if signature:
        signed_by = plugin_signing.verify_against_trust(config_dir, signature, data)
        if signed_by is None:
            raise ps.PluginError(
                "la signatura del plugin no verifica amb cap clau de confiança "
                "(editor desconegut o binari alterat)"
            )
    manifest = ps.install_from_zip(config_dir, data, overwrite=True)
    manifest["signedBy"] = signed_by
    return manifest


def install_catalog_entry(config_dir: Path, entry_id: str) -> Dict[str, Any]:
    """Instal·la una entrada del catàleg pel seu id, sigui `bundled` o `url`.

    Per a entrades `url`, si el catàleg declara `sha256` i/o `signature`, es
    verifiquen abans d'instal·lar.
    """
    entry = next((e for e in load_catalog() if e.get("id") == entry_id), None)
    if not entry:
        raise ps.PluginError(f"entrada de catàleg desconeguda: {entry_id!r}")
    source = entry.get("source")
    if source == "bundled":
        return install_bundled(config_dir, entry_id)
    if source == "url":
        url = str(entry.get("url") or "")
        if not url:
            raise ps.PluginError("l'entrada `url` no declara cap URL")
        return install_from_url(config_dir, url, entry.get("sha256"), entry.get("signature"))
    raise ps.PluginError(f"font d'entrada desconeguda: {source!r}")
