"""Baixada d'adjunts de Notion (clon) → Vault local, amb reescriptura de rutes.

Notion serveix els fitxers via URLs S3 signades que **caduquen ~1h**. Per fer un clon autònom
cal baixar-los DURANT el clon i reescriure les referències a rutes `Assets/...` locals:
  - valors de camps d'arxiu (`file`/`files`/`image`) → llista d'URLs → llista de rutes locals.
  - imatges del cos markdown (`![alt](url)`) → ruta local.

Disseny: els helpers de localització (`localize_values`, `localize_body`) són PURS — reben un
callable `save_asset(url, prop) -> ruta_local|None` que fa la I/O (la capa de ruta el wira amb
`download_to`, que sí baixa). Així es testegen sense xarxa. cf. directiva
`notion_import_configurable_schema.md`.
"""
from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

log = logging.getLogger(__name__)

ASSET_TYPES = {"file", "files", "image", "images", "attachment", "attachments", "media"}
_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(\s+\"[^\"]*\")?\)")

# save_asset(url, prop_name_or_None) → ruta local "Assets/..." (o None si no es pot baixar)
SaveAsset = Callable[[str, Optional[str]], Optional[str]]


def is_remote(url: str) -> bool:
    return isinstance(url, str) and url.strip().lower().startswith(("http://", "https://"))


def filename_for(url: str, *, default_ext: str = "") -> str:
    """Nom de fitxer estable per a una URL: basename net + sufix hash (evita col·lisions i
    URLs sense nom). Manté l'extensió si n'hi ha."""
    path = urlparse(url).path
    base = unquote(Path(path).name) or "fitxer"
    base = re.sub(r"[^\w.\-]+", "_", base).strip("._") or "fitxer"
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, default_ext.lstrip(".")
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    return f"{stem}_{h}.{ext}" if ext else f"{stem}_{h}"


def download_to(url: str, dest_dir: Path, vault_root: Path, *, timeout: float = 60.0) -> Optional[str]:
    """Baixa `url` a `dest_dir` (creant-lo) i torna la ruta RELATIVA a `vault_root` amb `/`
    (p.ex. `Assets/DB/Taula/Camp/foto_ab12cd34.png`). None si no és remota o falla."""
    if not is_remote(url):
        return None
    try:
        import httpx
        ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
        with httpx.Client(timeout=timeout, follow_redirects=True) as c:
            resp = c.get(url, headers={"User-Agent": ua})
            resp.raise_for_status()
            data = resp.content
            ext = _ext_from_content_type(resp.headers.get("content-type", ""))
        dest_dir.mkdir(parents=True, exist_ok=True)
        fname = filename_for(url, default_ext=ext)
        (dest_dir / fname).write_bytes(data)
        rel = (dest_dir / fname).resolve().relative_to(vault_root.resolve())
        return str(rel).replace("\\", "/")
    except Exception as e:  # noqa: BLE001
        log.warning("No s'ha pogut baixar l'adjunt %s: %s", url[:80], e)
        return None


def _ext_from_content_type(ct: str) -> str:
    ct = (ct or "").split(";")[0].strip().lower()
    return {
        "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
        "image/svg+xml": "svg", "application/pdf": "pdf",
    }.get(ct, "")


def localize_values(values: Dict[str, Any], properties: List[Dict[str, Any]],
                    save_asset: SaveAsset) -> Tuple[Dict[str, Any], int]:
    """Reescriu els valors de camps d'arxiu: URLs remotes → rutes locals (via `save_asset`).
    Manté la URL original si la baixada falla. Torna (valors, nombre baixats)."""
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
    """Reescriu les imatges del cos markdown: `![alt](url-remota)` → `![alt](Assets/...)`."""
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
