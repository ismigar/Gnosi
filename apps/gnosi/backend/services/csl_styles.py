"""Management of CSL files on disk — listing and upload.

CSL styles live at `monorepo/apps/gnosi/frontend/public/csl/styles/`
so the frontend can serve them directly via static Vite/HTTP.
This module exposes pure functions to:

  - List the detected styles (includes the `<title>` extracted from the XML).
  - Validate and save a CSL file uploaded by the user.

It does NOT render any citation — that's citeproc-js's job on the frontend (and
pandoc's on the backend for export). Here we only manage the catalog.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

# This file lives at monorepo/apps/gnosi/backend/services/; parents[2]
# reaches monorepo/apps/gnosi (gnosi root). The styles live in frontend/.
_GNOSI_ROOT = Path(__file__).resolve().parents[2]
STYLES_DIR = _GNOSI_ROOT / "frontend" / "public" / "csl" / "styles"

# CSL Schema namespace (style files start with `<style xmlns="...1.0">`)
_CSL_NS = "{http://purl.org/net/xbiblio/csl}"


def _extract_csl_title(path: Path) -> Optional[str]:
    """Reads the XML and extracts `<title>` or `<info><title>` from the header.

    `xml.etree` already handles the namespace if the .csl declares it
    correctly. If the XML is malformed or has no title, we return None.
    
    """
    try:
        # We only read the first ~10 KB; the title is always in the header.
        # Useful with huge CSL files (chicago-author-date.csl > 160 KB).
        with open(path, "rb") as f:
            raw = f.read(16384)
        # Tolerant parser: if the XML is unfinished (because it was truncated), we look for the title with a regex.
        try:
            root = ET.fromstring(raw)
            info = root.find(f"{_CSL_NS}info")
            if info is None:
                info = root.find("info")
            if info is not None:
                title_el = info.find(f"{_CSL_NS}title")
                if title_el is None:
                    title_el = info.find("title")
                if title_el is not None and title_el.text:
                    return title_el.text.strip()
        except ET.ParseError:
            pass
        # Regex fallback (not strict about namespaces): looks for the first <title>...</title>
        # inside the header. If not found, returns None.
        m = re.search(rb"<title[^>]*>([^<]+)</title>", raw)
        if m:
            return m.group(1).decode("utf-8", errors="replace").strip() or None
    except OSError:
        pass
    return None


def list_styles() -> list[dict]:
    """Lists the .csl files detected in the catalog with extracted metadata.

    Returns: `[{id, file, title}, ...]` sorted alphabetically by id.
    `id` is the file name without extension. `title` is the CSL's `<title>`
    (what the community officially calls the style, e.g. \"American Psychological
    Association 7th edition\"); it can be None if the XML doesn't have it or is malformed.
    
    """
    out: list[dict] = []
    if not STYLES_DIR.exists():
        return out
    for path in sorted(STYLES_DIR.glob("*.csl")):
        out.append({
            "id": path.stem,
            "file": path.name,
            "title": _extract_csl_title(path),
        })
    return out


def save_uploaded_style(file_bytes: bytes, filename: str) -> dict:
    """Validates and saves an uploaded CSL file.

    Minimal validation:
      - Reasonable size (< 1 MB; the largest community CSL is around 200 KB)
      - Correct XML parsing
      - Root element `<style>` (with or without the CSL namespace)

    Returns: `{id, file, title}` same as `list_styles()`, or raises ValueError
    with the reason if it's not valid.
    
    """
    if len(file_bytes) > 1024 * 1024:
        raise ValueError("File is too large (>1 MB). CSL files are usually smaller than 200 KB.")
    if not filename.lower().endswith(".csl"):
        raise ValueError("The extension must be .csl")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    # XML validation: must parse + root element must be <style>.
    try:
        root = ET.fromstring(file_bytes)
    except ET.ParseError as e:
        raise ValueError(f"Invalid XML: {e}")
    tag = root.tag
    # We strip the namespace, if any, to compare.
    local_tag = tag.split("}", 1)[1] if "}" in tag else tag
    if local_tag != "style":
        raise ValueError(f"Expected XML root <style>, found <{local_tag}>")

    # Saves to disk. Overwrites if one already exists with the same name (the user
    # wants to update their version, e.g. a revision of a custom style).
    STYLES_DIR.mkdir(parents=True, exist_ok=True)
    dest = STYLES_DIR / safe_name
    dest.write_bytes(file_bytes)

    return {
        "id": dest.stem,
        "file": dest.name,
        "title": _extract_csl_title(dest),
    }
