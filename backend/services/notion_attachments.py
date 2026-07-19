"""Downloading Notion attachments (clone) → local Vault, with path rewriting.

Notion serves files via signed S3 URLs that **expire in ~1h**. To build a self-contained clone
we need to download them DURING the clone and rewrite references to local `Assets/...`
paths:
  - file-field values (`file`/`files`/`image`) → list of URLs → list of local paths.
  - images in the markdown body (`![alt](url)`) → local path.
  - `<!-- gnosi-notion-file:... -->` body markers (Notion-hosted attachment blocks, from
    `notion_mcp_md`) → local link, via a fresh REST signed URL (`resolve_file_markers`).

Design: the localization helpers (`localize_values`, `localize_body`) are PURE — they receive a
`save_asset(url, prop) -> ruta_local|None` callable that does the I/O (the path layer wires it with
`download_to`, which does download). This way they can be tested without a network. cf. directive
`notion_import_configurable_schema.md`.
"""
from __future__ import annotations

import hashlib
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

log = logging.getLogger(__name__)

ASSET_TYPES = {"file", "files", "image", "images", "attachment", "attachments", "media"}
_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(\s+\"[^\"]*\")?\)")

# save_asset(url, prop_name_or_None) → local path "Assets/..." (or None if it can't be downloaded)
SaveAsset = Callable[[str, Optional[str]], Optional[str]]


def is_remote(url: str) -> bool:
    return isinstance(url, str) and url.strip().lower().startswith(("http://", "https://"))


def filename_for(url: str, *, default_ext: str = "") -> str:
    """Stable filename for a URL: clean basename + hash suffix (avoids collisions and
    unnamed URLs). Keeps the extension if there is one."""
    path = urlparse(url).path
    base = unquote(Path(path).name) or "fitxer"
    base = re.sub(r"[^\w.\-]+", "_", base).strip("._") or "fitxer"
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, default_ext.lstrip(".")
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    return f"{stem}_{h}.{ext}" if ext else f"{stem}_{h}"


def download_file(url: str, dest_dir: Path, *, timeout: float = 60.0) -> Optional[str]:
    """Downloads `url` to `dest_dir` (creating it) and returns the NAME of the created file (or None if it's not remote
    or fails). It doesn't compute any relative path → used for destinations OUTSIDE the vault (e.g. Library,
    a sibling of the vault)."""
    if not is_remote(url):
        return None
    try:
        import httpx
        ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
        # Streaming with a TOTAL DEADLINE: httpx's timeout is per read operation, so a
        # file that trickles (slow but steady chunks) never times out and can stall the clone
        # for minutes. We cap the TOTAL time: if it exceeds `timeout` seconds, we abort and skip the file.
        deadline = time.monotonic() + timeout
        with httpx.Client(timeout=timeout, follow_redirects=True) as c:
            with c.stream("GET", url, headers={"User-Agent": ua}) as resp:
                resp.raise_for_status()
                ext = _ext_from_content_type(resp.headers.get("content-type", ""))
                buf = bytearray()
                for chunk in resp.iter_bytes():
                    buf += chunk
                    if time.monotonic() > deadline:
                        raise TimeoutError(f"baixada supera el pressupost total de {timeout:.0f}s")
                data = bytes(buf)
        dest_dir.mkdir(parents=True, exist_ok=True)
        fname = filename_for(url, default_ext=ext)
        (dest_dir / fname).write_bytes(data)
        return fname
    except Exception as e:  # noqa: BLE001
        log.warning("No s'ha pogut baixar l'adjunt %s: %s", url[:80], e)
        return None


def download_to(url: str, dest_dir: Path, vault_root: Path, *, timeout: float = 60.0) -> Optional[str]:
    """Downloads `url` to `dest_dir` (inside the vault) and returns the path RELATIVE to `vault_root` with `/`
    (e.g. `Assets/DB/Taula/Camp/foto_ab12cd34.png`). None if it's not remote or fails."""
    fname = download_file(url, dest_dir, timeout=timeout)
    if not fname:
        return None
    try:
        rel = (dest_dir / fname).resolve().relative_to(vault_root.resolve())
        return str(rel).replace("\\", "/")
    except Exception as e:  # noqa: BLE001
        log.warning("Adjunt baixat fora del vault (%s): %s", dest_dir, e)
        return None


def _ext_from_content_type(ct: str) -> str:
    ct = (ct or "").split(";")[0].strip().lower()
    return {
        "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
        "image/svg+xml": "svg", "application/pdf": "pdf",
    }.get(ct, "")


def localize_values(values: Dict[str, Any], properties: List[Dict[str, Any]],
                    save_asset: SaveAsset) -> Tuple[Dict[str, Any], int]:
    """Rewrites file-field values: remote URLs → local paths (via `save_asset`).
    Keeps the original URL if the download fails. Returns (values, number downloaded)."""
    by_name = {p.get("name"): p for p in (properties or [])}
    out = dict(values)
    n = 0
    for name, val in list(values.items()):
        prop = by_name.get(name)
        if not prop or str(prop.get("type") or "").lower() not in ASSET_TYPES:
            continue
        urls = val if isinstance(val, list) else ([val] if val else [])
        new_list = []
        for u in urls:
            local = save_asset(u, name) if is_remote(u) else None
            if local:
                n += 1
                new_list.append(local)
            else:
                new_list.append(u)
        out[name] = new_list if isinstance(val, list) else (new_list[0] if new_list else val)
    return out, n


def localize_body(md: str, save_asset: SaveAsset) -> Tuple[str, int]:
    """Rewrites images in the markdown body: `![alt](url-remota)` → `![alt](Assets/...)`."""
    if not md:
        return md, 0
    count = {"n": 0}

    def repl(m: "re.Match[str]") -> str:
        alt, url, titlepart = m.group(1), m.group(2), m.group(3) or ""
        if not is_remote(url):
            return m.group(0)
        local = save_asset(url, None)
        if not local:
            return m.group(0)
        count["n"] += 1
        return f"![{alt}]({local}{titlepart})"

    return _IMG_RE.sub(repl, md), count["n"]


# fetch_file_url(block_id) → fresh signed/external URL of the block's file (None if unavailable)
FetchFileUrl = Callable[[str], Optional[str]]


def resolve_file_markers(md: str, fetch_file_url: FetchFileUrl,
                         save_asset: Optional[SaveAsset]) -> Tuple[str, int, int]:
    """Resolves the `<!-- gnosi-notion-file:<block_id>:<filename> -->` markers emitted by
    `notion_mcp_md` for Notion-hosted attachments (their `attachment:` URIs are NOT public
    URLs; only the REST block API can produce a fresh signed URL, hence `fetch_file_url`).
    Downloaded → `[filename](Assets/...)`. Not downloadable (no URL, no `save_asset`, or a
    failed download) → readable plain text `📎 filename`, so no marker/tag ever reaches the
    editor (BlockNote silently drops unknown HTML on save). Returns (md, downloaded, failed)."""
    from .notion_mcp_md import FILE_MARKER_RE
    if not md or "gnosi-notion-file:" not in md:
        return md, 0, 0
    stats = {"ok": 0, "fail": 0}

    def repl(m: "re.Match[str]") -> str:
        block_id, label = m.group(1), unquote(m.group(2)) or "fitxer adjunt"
        url = None
        try:
            url = fetch_file_url(block_id)
        except Exception as e:  # noqa: BLE001
            log.warning("Could not resolve Notion file block %s: %s", block_id, e)
        local = save_asset(url, None) if (url and save_asset) else None
        if local:
            stats["ok"] += 1
            return f"[{label}]({local})"
        stats["fail"] += 1
        return f"📎 {label}"

    out = FILE_MARKER_RE.sub(repl, md)
    return out, stats["ok"], stats["fail"]
