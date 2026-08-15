"""Verified Vault template catalogs, packages, exports, and installation."""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Mapping, Optional, Tuple

from backend.services import plugin_signing
from backend.services.marketplace_http import MarketplaceHTTPError, fetch_public_bytes

TEMPLATE_SCHEMA_VERSION = 1
DEFAULT_INDEX_URL = (
    "https://github.com/ismigar/Gnosi/releases/latest/download/"
    "vault-templates-index.json"
)
MAX_INDEX_BYTES = 2 * 1024 * 1024
MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_ENTRIES = 20_000
MAX_PATH_CHARS = 300

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$")
_VAULT_SUBFOLDERS = (
    "Assets", "BD", "Wiki", "Calendar", "Mail", "Templates", "Drawings",
    "Daily Notes", "Newsletters", ".Dashboards", ".gnosi",
)
_EXCLUDED_ROOTS = {
    ".git", ".gnosi", ".history", ".trash", "mail", "node_modules", "trash",
}
_BLOCKED_SUFFIXES = {
    ".app", ".bat", ".bin", ".cjs", ".cmd", ".com", ".dll", ".dylib",
    ".exe", ".gadget", ".hta", ".htm", ".html", ".jar", ".js", ".lnk",
    ".mjs", ".msi", ".pif", ".ps1", ".py", ".scr", ".sh", ".so",
    ".svg", ".vb", ".vbs", ".wsf",
}
_TEXT_SUFFIXES = {".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".bib"}
_SECRET_PATTERNS = (
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("oauth-refresh-token", re.compile(r"\b1//[0-9A-Za-z_-]{20,}\b")),
    (
        "credential-assignment",
        re.compile(
            r"(?i)\b(?:api[_-]?key|client[_-]?secret|password|refresh[_-]?token|secret)"
            r"\s*[:=]\s*['\"]?[^\s'\"]{8,}"
        ),
    ),
)


class VaultTemplateError(ValueError):
    """A template catalog or package failed validation."""


def default_index_url() -> str:
    """Return the official template index URL, with a deployment override."""

    return os.environ.get("GNOSI_VAULT_TEMPLATES_INDEX_URL", DEFAULT_INDEX_URL).strip()


def _signature_url(index_url: str) -> str:
    if index_url.lower().endswith(".json"):
        return f"{index_url[:-5]}.sig"
    return f"{index_url}.sig"


def _string_list(value: Any, field: str, *, maximum: int = 32) -> List[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > maximum:
        raise VaultTemplateError(f"{field} must be a bounded list")
    result = []
    for item in value:
        text = str(item or "").strip()
        if text and len(text) <= 80 and text not in result:
            result.append(text)
    return result


def validate_manifest(raw: Any) -> Dict[str, Any]:
    """Validate and normalize a `template.json` manifest."""

    if not isinstance(raw, dict):
        raise VaultTemplateError("template.json must be an object")
    template_id = str(raw.get("id") or "").strip()
    if not _ID_RE.fullmatch(template_id):
        raise VaultTemplateError("template id must use lowercase letters, numbers, _ or -")
    version = str(raw.get("version") or "").strip()
    if not _SEMVER_RE.fullmatch(version):
        raise VaultTemplateError("template version must use semantic versioning")
    try:
        schema_version = int(raw.get("schemaVersion"))
    except (TypeError, ValueError) as exc:
        raise VaultTemplateError("schemaVersion must be an integer") from exc
    if schema_version != TEMPLATE_SCHEMA_VERSION:
        raise VaultTemplateError(
            f"unsupported template schema {schema_version}; expected {TEMPLATE_SCHEMA_VERSION}"
        )
    name = str(raw.get("name") or "").strip()
    if not name or len(name) > 120:
        raise VaultTemplateError("template name is required and must be at most 120 characters")
    recommended = _string_list(raw.get("recommendedPlugins"), "recommendedPlugins")
    for plugin_id in recommended:
        if not _ID_RE.fullmatch(plugin_id):
            raise VaultTemplateError(f"invalid recommended plugin id: {plugin_id}")
    files = raw.get("files") or []
    if not isinstance(files, list) or len(files) > MAX_ENTRIES:
        raise VaultTemplateError("files must be a bounded list")
    normalized_files = []
    for item in files:
        if not isinstance(item, dict):
            raise VaultTemplateError("every files entry must be an object")
        path = _safe_payload_path(str(item.get("path") or ""))
        digest = str(item.get("sha256") or "").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise VaultTemplateError(f"invalid file checksum for {path}")
        try:
            size = int(item.get("size"))
        except (TypeError, ValueError) as exc:
            raise VaultTemplateError(f"invalid file size for {path}") from exc
        if size < 0 or size > MAX_FILE_BYTES:
            raise VaultTemplateError(f"file size is outside limits for {path}")
        normalized_files.append({"path": path, "sha256": digest, "size": size})
    return {
        "id": template_id,
        "version": version,
        "schemaVersion": schema_version,
        "name": name,
        "description": str(raw.get("description") or "")[:2_000],
        "author": str(raw.get("author") or "")[:120],
        "license": str(raw.get("license") or "")[:80],
        "minGnosiVersion": str(raw.get("minGnosiVersion") or "")[:40],
        "categories": _string_list(raw.get("categories"), "categories"),
        "languages": _string_list(raw.get("languages"), "languages"),
        "recommendedPlugins": recommended,
        "preview": str(raw.get("preview") or "")[:240],
        "files": normalized_files,
    }


def _safe_payload_path(value: str) -> str:
    if not value or "\\" in value or "\x00" in value or len(value) > MAX_PATH_CHARS:
        raise VaultTemplateError("template contains an invalid path")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise VaultTemplateError(f"unsafe template path: {value}")
    if pure.parts[0].casefold() in _EXCLUDED_ROOTS:
        raise VaultTemplateError(f"template payload contains a private root: {pure.parts[0]}")
    if pure.suffix.casefold() in _BLOCKED_SUFFIXES:
        raise VaultTemplateError(f"template payload contains executable content: {value}")
    return pure.as_posix()


def _is_archive_link(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return stat.S_IFMT(mode) in {stat.S_IFLNK, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFIFO}


def validate_package(data: bytes) -> Tuple[Dict[str, Any], List[zipfile.ZipInfo]]:
    """Validate a complete template ZIP without writing to disk."""

    if not data or len(data) > MAX_ARCHIVE_BYTES:
        raise VaultTemplateError("template archive is empty or too large")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise VaultTemplateError(f"invalid template ZIP: {exc}") from exc
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES:
        raise VaultTemplateError("template archive has too many entries")
    total = 0
    seen = set()
    payload_infos = []
    for info in infos:
        name = info.filename
        if info.flag_bits & 0x1:
            raise VaultTemplateError("encrypted template entries are not supported")
        if _is_archive_link(info):
            raise VaultTemplateError(f"template archive contains a link: {name}")
        if "\\" in name or "\x00" in name or len(name) > MAX_PATH_CHARS + 6:
            raise VaultTemplateError("template archive contains an invalid path")
        pure = PurePosixPath(name)
        if pure.is_absolute() or ".." in pure.parts:
            raise VaultTemplateError(f"template archive path escapes its root: {name}")
        folded = pure.as_posix().casefold()
        if folded in seen:
            raise VaultTemplateError(f"template archive contains a duplicate path: {name}")
        seen.add(folded)
        if info.is_dir():
            continue
        if info.file_size > MAX_FILE_BYTES:
            raise VaultTemplateError(f"template file is too large: {name}")
        total += info.file_size
        if total > MAX_UNCOMPRESSED_BYTES:
            raise VaultTemplateError("template expands beyond the allowed size")
        if pure.parts and pure.parts[0] == "vault":
            if len(pure.parts) < 2:
                continue
            _safe_payload_path(PurePosixPath(*pure.parts[1:]).as_posix())
            payload_infos.append(info)
        elif name not in {"template.json", "README.md", "LICENSE", "preview.webp", "preview.png", "preview.jpg"}:
            raise VaultTemplateError(f"unexpected file at template package root: {name}")
    if "template.json" not in {info.filename for info in infos}:
        raise VaultTemplateError("template package has no template.json")
    try:
        manifest = validate_manifest(json.loads(archive.read("template.json").decode("utf-8")))
    except (UnicodeDecodeError, ValueError) as exc:
        if isinstance(exc, VaultTemplateError):
            raise
        raise VaultTemplateError(f"template.json is unreadable: {exc}") from exc

    expected = {item["path"]: item for item in manifest["files"]}
    actual_names = {
        PurePosixPath(*PurePosixPath(info.filename).parts[1:]).as_posix()
        for info in payload_infos
    }
    if set(expected) != actual_names:
        raise VaultTemplateError("template manifest file inventory does not match the payload")
    for info in payload_infos:
        relative = PurePosixPath(*PurePosixPath(info.filename).parts[1:]).as_posix()
        payload = archive.read(info)
        item = expected[relative]
        if len(payload) != item["size"] or hashlib.sha256(payload).hexdigest() != item["sha256"]:
            raise VaultTemplateError(f"template payload integrity failed for {relative}")
    return manifest, payload_infos


def _catalog_entry(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise VaultTemplateError("catalog entries must be objects")
    template_id = str(raw.get("id") or "")
    version = str(raw.get("version") or "")
    url = str(raw.get("url") or raw.get("downloadUrl") or "")
    checksum = str(raw.get("sha256") or "").lower()
    signature = str(raw.get("signature") or "")
    if not _ID_RE.fullmatch(template_id) or not _SEMVER_RE.fullmatch(version):
        raise VaultTemplateError("catalog entry has an invalid id or version")
    if not url or not re.fullmatch(r"[0-9a-f]{64}", checksum) or not signature:
        raise VaultTemplateError("official templates require URL, SHA-256, and signature")
    return {
        "id": template_id,
        "version": version,
        "name": str(raw.get("name") or template_id)[:120],
        "description": str(raw.get("description") or "")[:2_000],
        "author": str(raw.get("author") or "")[:120],
        "license": str(raw.get("license") or "")[:80],
        "categories": _string_list(raw.get("categories"), "categories"),
        "languages": _string_list(raw.get("languages"), "languages"),
        "recommendedPlugins": _string_list(
            raw.get("recommendedPlugins"), "recommendedPlugins"
        ),
        "preview": str(raw.get("preview") or "")[:500],
        "url": url,
        "sha256": checksum,
        "signature": signature,
        "size": max(0, int(raw.get("size") or 0)),
        "verified": True,
    }


def load_catalog(config_dir: Path, index_url: Optional[str] = None) -> Dict[str, Any]:
    """Fetch and verify the detached-signed official Vault template index."""

    url = str(index_url or default_index_url()).strip()
    try:
        raw = fetch_public_bytes(url, max_bytes=MAX_INDEX_BYTES, timeout=15).body
        signature = fetch_public_bytes(
            _signature_url(url), max_bytes=4_096, timeout=15
        ).body.decode("ascii").strip()
    except (MarketplaceHTTPError, UnicodeDecodeError) as exc:
        raise VaultTemplateError(f"could not fetch the signed template catalog: {exc}") from exc
    signed_by = plugin_signing.verify_against_trust(config_dir, signature, raw)
    if signed_by is None:
        raise VaultTemplateError("template catalog signature is invalid or untrusted")
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise VaultTemplateError(f"template catalog is not valid JSON: {exc}") from exc
    source = decoded.get("vaultTemplates") if isinstance(decoded, dict) else decoded
    if not isinstance(source, list):
        raise VaultTemplateError("template catalog must contain vaultTemplates")
    entries = []
    for item in source:
        try:
            entries.append(_catalog_entry(item))
        except VaultTemplateError:
            continue
    return {"templates": entries, "signedBy": signed_by, "url": url}


def download_template(entry: Mapping[str, Any], config_dir: Path) -> Tuple[bytes, str]:
    """Download a catalog package and verify its checksum and trusted signature."""

    try:
        data = fetch_public_bytes(
            str(entry.get("url") or ""), max_bytes=MAX_ARCHIVE_BYTES, timeout=30
        ).body
    except MarketplaceHTTPError as exc:
        raise VaultTemplateError(f"could not download template: {exc}") from exc
    checksum = hashlib.sha256(data).hexdigest()
    if checksum != str(entry.get("sha256") or "").lower():
        raise VaultTemplateError("template checksum does not match the catalog")
    signed_by = plugin_signing.verify_against_trust(
        config_dir, str(entry.get("signature") or ""), data
    )
    if signed_by is None:
        raise VaultTemplateError("template package signature is invalid or untrusted")
    validate_package(data)
    return data, signed_by


def safe_vault_folder_name(name: str) -> str:
    """Return a portable folder name for a newly installed Vault."""

    safe = re.sub(r"[^\w\s\-À-ÿ]", "", str(name or "")).strip()
    return safe or "Vault"


def install_package(
    data: bytes,
    *,
    vaults_root: Path,
    vault_name: str,
    source_url: str,
    checksum: str,
    signed_by: str,
) -> Tuple[Dict[str, Any], Path]:
    """Extract a verified package to staging and atomically publish the Vault."""

    manifest, payload_infos = validate_package(data)
    root = Path(vaults_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    final = root / safe_vault_folder_name(vault_name)
    if final.exists():
        raise VaultTemplateError(f"a Vault folder already exists at {final.name}")
    stage = Path(tempfile.mkdtemp(prefix=".gnosi-template-stage-", dir=root))
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        for info in payload_infos:
            relative = PurePosixPath(*PurePosixPath(info.filename).parts[1:])
            output = stage.joinpath(*relative.parts)
            if stage.resolve() not in output.resolve().parents:
                raise VaultTemplateError("template extraction escaped the staging directory")
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, output.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            output.chmod(0o644)
        for folder in _VAULT_SUBFOLDERS:
            (stage / folder).mkdir(parents=True, exist_ok=True)
        provenance = {
            "templateId": manifest["id"],
            "version": manifest["version"],
            "sourceUrl": source_url,
            "sha256": checksum,
            "signedBy": signed_by,
        }
        (stage / ".gnosi" / "template_origin.json").write_text(
            json.dumps(provenance, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        stage.replace(final)
        return manifest, final
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _export_reason(path: Path, relative: Path) -> Optional[str]:
    if path.is_symlink():
        return "symlink"
    if relative.parts and relative.parts[0].casefold() in _EXCLUDED_ROOTS:
        return "private-root"
    if path.name.casefold().startswith(".env"):
        return "environment-file"
    if path.suffix.casefold() in _BLOCKED_SUFFIXES:
        return "executable-content"
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            return "file-too-large"
    except OSError:
        return "unreadable"
    return None


def _secret_findings(path: Path, relative: str) -> List[Dict[str, str]]:
    if path.suffix.casefold() not in _TEXT_SUFFIXES:
        return []
    try:
        if path.stat().st_size > 1024 * 1024:
            return []
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    findings = []
    for kind, pattern in _SECRET_PATTERNS:
        if pattern.search(text):
            findings.append({"path": relative, "kind": kind})
    return findings


def export_preview(vault_path: Path) -> Dict[str, Any]:
    """Return the deterministic export allowlist and privacy findings."""

    root = Path(vault_path).resolve()
    included = []
    excluded = []
    findings = []
    total_size = 0
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix().casefold()):
        try:
            relative_path = path.relative_to(root)
        except ValueError:
            continue
        if path.is_dir() and not path.is_symlink():
            continue
        relative = relative_path.as_posix()
        reason = _export_reason(path, relative_path)
        if reason:
            excluded.append({"path": relative, "reason": reason})
            continue
        try:
            size = path.stat().st_size
        except OSError:
            excluded.append({"path": relative, "reason": "unreadable"})
            continue
        included.append({"path": relative, "size": size})
        total_size += size
        findings.extend(_secret_findings(path, relative))
        if len(included) > MAX_ENTRIES or total_size > MAX_UNCOMPRESSED_BYTES:
            raise VaultTemplateError("Vault export exceeds the template limits")
    return {
        "included": included,
        "excluded": excluded,
        "findings": findings,
        "totalSize": total_size,
    }


def build_package(
    vault_path: Path,
    metadata: Mapping[str, Any],
    *,
    acknowledge_findings: bool = False,
) -> Tuple[bytes, Dict[str, Any]]:
    """Build a deterministic, allowlist-based Vault template package."""

    preview = export_preview(vault_path)
    if preview["findings"] and not acknowledge_findings:
        raise VaultTemplateError("privacy findings must be acknowledged before export")
    root = Path(vault_path).resolve()
    inventory = []
    file_payloads = []
    for item in preview["included"]:
        relative = _safe_payload_path(item["path"])
        payload = (root / relative).read_bytes()
        inventory.append({
            "path": relative,
            "size": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        })
        file_payloads.append((relative, payload))
    raw_manifest = {**dict(metadata), "schemaVersion": TEMPLATE_SCHEMA_VERSION, "files": inventory}
    manifest = validate_manifest(raw_manifest)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        manifest_bytes = json.dumps(
            manifest, indent=2, ensure_ascii=False, sort_keys=True
        ).encode("utf-8")
        _write_deterministic(archive, "template.json", manifest_bytes)
        for relative, payload in file_payloads:
            _write_deterministic(archive, f"vault/{relative}", payload)
    package = buffer.getvalue()
    if len(package) > MAX_ARCHIVE_BYTES:
        raise VaultTemplateError("compressed template package exceeds the size limit")
    return package, preview


def _write_deterministic(archive: zipfile.ZipFile, name: str, payload: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, payload)
