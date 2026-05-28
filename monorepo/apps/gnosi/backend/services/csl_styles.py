"""Gestió de fitxers CSL al disc — llistat i upload.

Els estils CSL viuen a `monorepo/apps/gnosi/frontend/public/csl/styles/`
perquè el frontend els pot servir directament via Vite/HTTP estàtic.
Aquest mòdul exposa funcions pures per:

  - Llistar els estils detectats (inclou el `<title>` extret del XML).
  - Validar i desar un fitxer CSL pujat per l'usuari.

NO renderitza cap cita — això és feina de citeproc-js al frontend (i de
pandoc al backend per a l'export). Aquí només administrem el catàleg.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

# Aquest fitxer viu a monorepo/apps/gnosi/backend/services/; parents[2]
# arriba a monorepo/apps/gnosi (gnosi root). Els estils viuen a frontend/.
_GNOSI_ROOT = Path(__file__).resolve().parents[2]
STYLES_DIR = _GNOSI_ROOT / "frontend" / "public" / "csl" / "styles"

# CSL Schema namespace (style fitxers comencen amb `<style xmlns="...1.0">`)
_CSL_NS = "{http://purl.org/net/xbiblio/csl}"


def _extract_csl_title(path: Path) -> Optional[str]:
    """Llegeix l'XML i extreu `<title>` o `<info><title>` del header.

    `xml.etree` ja gestiona el namespace si el .csl el declara
    correctament. Si l'XML és malformat o no porta title, retornem None.
    """
    try:
        # Llegim només les primeres ~10 KB; el title sempre està al header.
        # Útil amb fitxers CSL gegants (chicago-author-date.csl > 160 KB).
        with open(path, "rb") as f:
            raw = f.read(16384)
        # Parser tolerant: si l'XML és inacabat (per truncat), busquem el title amb regex.
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
        # Fallback regex (no estricte amb namespaces): busca el primer <title>...</title>
        # dins del header. Si no troba, retorna None.
        m = re.search(rb"<title[^>]*>([^<]+)</title>", raw)
        if m:
            return m.group(1).decode("utf-8", errors="replace").strip() or None
    except OSError:
        pass
    return None


def list_styles() -> list[dict]:
    """Llista els fitxers .csl detectats al catàleg amb metadata extreta.

    Returns: `[{id, file, title}, ...]` ordenat alfabèticament per id.
    `id` és el nom del fitxer sense extensió. `title` és el `<title>` del CSL
    (lo que la comunitat anomena oficialment l'estil, p.ex. \"American Psychological
    Association 7th edition\"); pot ser None si l'XML no el porta o és malformat.
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
    """Valida i desa un fitxer CSL pujat.

    Validació mínima:
      - Mida raonable (< 1 MB; el CSL més gran de la comunitat ronda els 200 KB)
      - Parsing XML correcte
      - Element root `<style>` (amb o sense namespace CSL)

    Returns: `{id, file, title}` igual que `list_styles()`, o lança ValueError
    amb el motiu si no és vàlid.
    """
    if len(file_bytes) > 1024 * 1024:
        raise ValueError("Fitxer massa gran (>1 MB). Els CSL solen ser <200 KB.")
    if not filename.lower().endswith(".csl"):
        raise ValueError("L'extensió ha de ser .csl")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    # Validació XML: ha de parseig + element root ha de ser <style>.
    try:
        root = ET.fromstring(file_bytes)
    except ET.ParseError as e:
        raise ValueError(f"XML invàlid: {e}")
    tag = root.tag
    # Eliminem el namespace si n'hi ha per comparar.
    local_tag = tag.split("}", 1)[1] if "}" in tag else tag
    if local_tag != "style":
        raise ValueError(f"Root XML esperat <style>, trobat <{local_tag}>")

    # Desa al disc. Sobreescriu si ja existeix amb el mateix nom (l'usuari
    # vol actualitzar la seva versió, p.ex. una revisió d'un estil custom).
    STYLES_DIR.mkdir(parents=True, exist_ok=True)
    dest = STYLES_DIR / safe_name
    dest.write_bytes(file_bytes)

    return {
        "id": dest.stem,
        "file": dest.name,
        "title": _extract_csl_title(dest),
    }
