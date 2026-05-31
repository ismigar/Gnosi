"""Helpers purs per a la traducció de contingut (skills translate_row / translate_page).

Viuen a `services/` (no inline a `vault_routes`) per dos motius:

1. **Testabilitat**: es poden provar amb pytest sense importar el backend sencer,
   que arrossega `langgraph` i és lent/feixuc d'importar en subprocess
   (veure directiva `feedback_local_backend_test_verification`).
2. **Reutilització**: tant els endpoints `translate-row`/`translate-page` (per a la
   idempotència) com els hooks de desat (`patch_page`/`save_page`, per al marcatge
   d'obsolescència) necessiten la mateixa lògica de cerca i comparació.

Sense I/O, sense FastAPI, sense imports del backend: dades entren, dades surten.
"""
from typing import Any, Dict, Iterable, Optional


def canonicalize_id(page_id: Any) -> str:
    """Normalitza un UUID per comparar-lo de forma robusta.

    Els IDs poden venir amb guions (`df361486-5ff3-...`, forma UUID estàndard) o
    sense (`df3614865ff3...`, com exporta Notion). `parent_id`, edicions manuals i
    `translation_origin_id` poden portar qualsevol de les dues formes; comparar-les
    com a strings crues provoca falsos negatius. Aquest helper unifica les dues
    formes (minúscules, sense guions ni espais).
    """
    return str(page_id or "").strip().lower().replace("-", "")


def _meta_of(page: Any) -> Dict[str, Any]:
    """Extreu el dict de metadata d'un `PageInfo` o d'un dict pla."""
    if page is None:
        return {}
    md = getattr(page, "metadata", None)
    if md is None and isinstance(page, dict):
        md = page.get("metadata")
    return md or {}


def find_translations_of(origin_id: str, pages: Iterable[Any]) -> Dict[str, Any]:
    """Retorna `{lang: page}` de les traduccions filles d'un original.

    Una traducció és una pàgina amb `metadata.translation_origin_id` igual a
    `origin_id` (comparat canònicament) i amb un `metadata.translation_lang` no buit.

    `pages` és qualsevol iterable d'objectes amb `.metadata` (p. ex. `PageInfo`) o de
    dicts amb clau `metadata`. Si hi hagués més d'una traducció per al mateix idioma
    (estat brut per re-traduccions antigues abans de la idempotència), guanya l'última
    vista — el caller en re-aprofitarà una i la resta es poden netejar manualment.
    """
    out: Dict[str, Any] = {}
    target = canonicalize_id(origin_id)
    if not target:
        return out
    for page in pages:
        md = _meta_of(page)
        if canonicalize_id(md.get("translation_origin_id")) != target:
            continue
        lang = md.get("translation_lang")
        if isinstance(lang, str) and lang.strip():
            out[lang.strip().lower()] = page
    return out


def translatable_content_changed(
    translatable_keys: Iterable[str],
    old_md: Optional[Dict[str, Any]],
    new_md: Optional[Dict[str, Any]],
    old_body: Optional[str] = None,
    new_body: Optional[str] = None,
    *,
    title_matters: bool = False,
) -> bool:
    """Indica si una edició afecta el contingut que es tradueix.

    Serveix de guarda al hook de desat: només si retorna `True` cal marcar les
    traduccions com a obsoletes. És clau per no disparar escriptures a cada
    pulsació de tecla de l'autosave del Vault quan el canvi no és rellevant.

    Casos:
      - **Registres**: `translatable_keys` són les claus (`id`/`name`) dels camps
        marcats com a traduïbles; es compara cada valor al frontmatter. `title_matters`
        s'activa quan el camp títol és traduïble.
      - **Pàgines**: es passen `old_body`/`new_body` i `title_matters=True` (les
        pàgines tradueixen sempre títol + cos).

    Compara amb `!=` directe; n'hi ha prou perquè abans i després comparteixen la
    mateixa forma de claus dins d'un mateix desat.
    """
    old_md = old_md or {}
    new_md = new_md or {}

    if old_body is not None or new_body is not None:
        if (old_body or "") != (new_body or ""):
            return True

    if title_matters and str(old_md.get("title") or "") != str(new_md.get("title") or ""):
        return True

    for key in translatable_keys or []:
        if not key:
            continue
        if old_md.get(key) != new_md.get(key):
            return True

    return False
