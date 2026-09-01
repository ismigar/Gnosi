"""Plugin catalog/gallery (phase 2.2 of plugin_system.md).

An index of recommended plugins, in the style of Obsidian's "community plugins",
with one-click installation. Two input sources:

  * `bundled`: example plugins that ship with Gnosi in `extensions/examples/`. They
    are zipped on the fly and passed to `plugin_system.install_from_zip`.
  * `url`: a remote .zip (requires network access on the backend; admin action).

The catalog is read from `extensions/examples/catalog.json`. Keeping it as
data (not code) allows it to be extended without touching the backend.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.config.logger_config import get_logger
from backend.services import plugin_system as ps
from backend.services import plugin_signing
from backend.services.marketplace_http import MarketplaceHTTPError, fetch_public_bytes

logger = get_logger(__name__)

_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
_MAX_INDEX_BYTES = 2 * 1024 * 1024
_DEFAULT_REGISTRY_URL = (
    "https://github.com/ismigar/Gnosi/releases/latest/download/plugins-index.json"
)


def default_registry_url() -> str:
    """Return the official plugin index URL, with a deployment override."""

    return os.environ.get("GNOSI_PLUGIN_REGISTRY_URL", _DEFAULT_REGISTRY_URL).strip()


def _examples_dir() -> Path:
    # plugin_catalog.py → services → backend → gnosi → extensions/examples/
    return Path(__file__).resolve().parents[2] / "extensions" / "examples"


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


def _index_signature_url(url: str) -> str:
    return f"{url[:-5]}.sig" if url.lower().endswith(".json") else f"{url}.sig"


def fetch_remote_index(
    url: str,
    config_dir: Optional[Path] = None,
    *,
    require_signature: bool = False,
) -> List[Dict[str, Any]]:
    """Downloads a remote plugin index (JSON: list of `url` entries).

    Each entry may carry `id`, `name`, `description`, `url` (zip), `sha256` and
    `signature`. `source='url'` is forced. Errors → [] (the remote index must
    never take down the local gallery).

    """
    try:
        raw = fetch_public_bytes(url, max_bytes=_MAX_INDEX_BYTES, timeout=15).body
        if require_signature:
            signature = (
                fetch_public_bytes(_index_signature_url(url), max_bytes=4_096, timeout=15)
                .body.decode("ascii")
                .strip()
            )
            if plugin_signing.verify_against_trust(config_dir or Path(), signature, raw) is None:
                raise ValueError("remote plugin index signature is invalid or untrusted")
        decoded = json.loads(raw.decode("utf-8"))
        data = decoded.get("plugins", []) if isinstance(decoded, dict) else decoded
    except (MarketplaceHTTPError, UnicodeDecodeError, ValueError) as exc:
        logger.warning("Could not load the remote index: %s", exc)
        return []
    if not isinstance(data, list):
        return []
    out = []
    for entry in data:
        if isinstance(entry, dict) and entry.get("id") and entry.get("url"):
            out.append({**entry, "source": "url"})
    return out


def load_catalog(
    registry_url: Optional[str] = None,
    config_dir: Optional[Path] = None,
    *,
    require_index_signature: bool = False,
) -> List[Dict[str, Any]]:
    """Full catalog: `bundled` examples + (optional) remote index.

    If `registry_url` is given, the remote entries are merged in; the local
    (bundled) ones take priority if there's an id collision.

    """
    catalog = _load_bundled_catalog()
    if registry_url:
        seen = {e.get("id") for e in catalog}
        for e in fetch_remote_index(
            registry_url,
            config_dir,
            require_signature=require_index_signature,
        ):
            if e.get("id") not in seen:
                catalog.append(e)
    return catalog


def _zip_dir_bytes(src: Path) -> bytes:
    """Compresses a directory (recursively) into .zip bytes, relative paths."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, str(f.relative_to(src)))
    return buf.getvalue()


def install_bundled(config_dir: Path, entry_id: str) -> Dict[str, Any]:
    """Installs a `bundled` plugin from the catalog by its entry id."""
    entry = next((e for e in load_catalog() if e.get("id") == entry_id), None)
    if not entry or entry.get("source") != "bundled":
        raise ps.PluginError(f"unknown catalog entry: {entry_id!r}")
    # `path` is relative to extensions/examples/ and validated against path traversal.
    rel = str(entry.get("path") or entry_id)
    if ".." in rel.split("/") or rel.startswith("/"):
        raise ps.PluginError("invalid example path")
    src = (_examples_dir() / rel).resolve()
    if _examples_dir().resolve() not in src.parents:
        raise ps.PluginError("example path is outside the examples directory")
    if not (src / "manifest.json").exists():
        raise ps.PluginError(f"example has no manifest: {rel}")
    return ps.install_from_zip(config_dir, _zip_dir_bytes(src), overwrite=True)


def install_from_url(
    config_dir: Path,
    url: str,
    expected_sha256: Optional[str] = None,
    signature: Optional[str] = None,
    *,
    require_integrity: bool = False,
) -> Dict[str, Any]:
    """Downloads a .zip and installs it (admin action; requires network access).

    Checks BEFORE installing (fail-closed):
      * `expected_sha256`: integrity (detects binary corruption/tampering).
      * `signature`: Ed25519 signature over the zip bytes; must verify
        against some key in the trust store. If given but it does NOT verify →
        it's rejected (unknown publisher or altered binary). If NOT given →
        it's installed but the returned manifest is marked with `signedBy=None`.

    """
    if require_integrity and (not expected_sha256 or not signature):
        raise ps.PluginError("remote catalog plugins require a checksum and trusted signature")
    try:
        data = fetch_public_bytes(url, max_bytes=_MAX_DOWNLOAD_BYTES, timeout=20).body
    except MarketplaceHTTPError as e:
        raise ps.PluginError(f"could not download: {e}") from e
    actual = hashlib.sha256(data).hexdigest()
    if expected_sha256:
        if actual.lower() != str(expected_sha256).strip().lower():
            raise ps.PluginError(
                f"SHA-256 checksum mismatch (expected {expected_sha256[:12]}…, got {actual[:12]}…)"
            )
    signed_by = None
    if signature:
        signed_by = plugin_signing.verify_against_trust(config_dir, signature, data)
        if signed_by is None:
            raise ps.PluginError(
                "the plugin signature does not verify against any trusted key "
                "(unknown publisher or altered binary)"
            )
    manifest = ps.install_from_zip(config_dir, data, overwrite=True)
    manifest["signedBy"] = signed_by
    ps.write_provenance(
        config_dir,
        manifest["id"],
        {
            "sourceUrl": url,
            "sha256": actual,
            "signedBy": signed_by,
        },
    )
    return manifest


def install_catalog_entry(
    config_dir: Path,
    entry_id: str,
    registry_url: Optional[str] = None,
    *,
    require_index_signature: bool = False,
) -> Dict[str, Any]:
    """Installs a catalog entry by its id, whether `bundled` or `url`.

    For `url` entries, if the catalog declares `sha256` and/or `signature`,
    they are verified before installing.

    """
    entry = next(
        (
            e
            for e in load_catalog(
                registry_url,
                config_dir,
                require_index_signature=require_index_signature,
            )
            if e.get("id") == entry_id
        ),
        None,
    )
    if not entry:
        raise ps.PluginError(f"unknown catalog entry: {entry_id!r}")
    source = entry.get("source")
    if source == "bundled":
        return install_bundled(config_dir, entry_id)
    if source == "url":
        url = str(entry.get("url") or "")
        if not url:
            raise ps.PluginError("the `url` entry does not declare a URL")
        return install_from_url(
            config_dir,
            url,
            entry.get("sha256"),
            entry.get("signature"),
            require_integrity=True,
        )
    raise ps.PluginError(f"unknown entry source: {source!r}")
