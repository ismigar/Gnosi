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


# --- Detecció de l'idioma origen via el camp "Idioma" del registre ----------
# Mirall del helper de frontend (schemaUtils.detectRecordSourceLang): backend i
# UI han de coincidir en quin és l'idioma original. Si el registre té un camp
# "Idioma" (o sinònim), el seu valor mana sobre la detecció heurística del text.

# Noms de camp que solem usar per a "l'idioma del registre".
_LANGUAGE_FIELD_NAMES = {"idioma", "llengua", "language", "lang", "lengua", "lingua"}

# Etiquetes/codis habituals → codi ISO 639-1.
_LANGUAGE_VALUE_TO_CODE = {
    "ca": "ca", "cat": "ca", "català": "ca", "catala": "ca", "catalan": "ca", "catalán": "ca",
    "es": "es", "spa": "es", "cas": "es", "castellà": "es", "castella": "es", "castellano": "es", "español": "es", "espanyol": "es", "spanish": "es",
    "en": "en", "eng": "en", "anglès": "en", "angles": "en", "inglés": "en", "english": "en",
    "fr": "fr", "fra": "fr", "fre": "fr", "francès": "fr", "frances": "fr", "francés": "fr", "french": "fr",
    "de": "de", "deu": "de", "ger": "de", "alemany": "de", "alemán": "de", "aleman": "de", "german": "de",
    "it": "it", "ita": "it", "italià": "it", "italia": "it", "italiano": "it", "italian": "it",
    "pt": "pt", "por": "pt", "portuguès": "pt", "portugues": "pt", "portugués": "pt", "portuguese": "pt",
    "nl": "nl", "nld": "nl", "dut": "nl", "neerlandès": "nl", "neerlandes": "nl", "neerlandés": "nl", "dutch": "nl", "holandés": "nl",
    "eu": "eu", "eus": "eu", "baq": "eu", "basc": "eu", "euskera": "eu", "euskara": "eu", "vasco": "eu", "vascuence": "eu", "basque": "eu",
    "gl": "gl", "glg": "gl", "gallec": "gl", "gallego": "gl", "galego": "gl", "galician": "gl",
    "ar": "ar", "ara": "ar", "àrab": "ar", "arab": "ar", "árabe": "ar", "arabe": "ar", "arabic": "ar",
    "zh": "zh", "zho": "zh", "chi": "zh", "xinès": "zh", "xines": "zh", "chino": "zh", "chinese": "zh", "mandarí": "zh", "mandarin": "zh",
}


def _strip_accents(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normalize_lang_code(value: Any) -> str:
    """Normalitza un valor d'idioma ("Català", "EN-GB", "ca") a codi ISO 639-1.

    Retorna '' si no es pot determinar.
    """
    if not isinstance(value, str):
        return ""
    raw = value.strip().lower()
    if not raw:
        return ""
    if raw in _LANGUAGE_VALUE_TO_CODE:
        return _LANGUAGE_VALUE_TO_CODE[raw]
    prefix = raw.split("-")[0].split("_")[0]  # "en-gb" / "pt_br" → prefix
    if prefix in _LANGUAGE_VALUE_TO_CODE:
        return _LANGUAGE_VALUE_TO_CODE[prefix]
    return prefix if len(prefix) == 2 and prefix.isalpha() else ""


def detect_record_source_lang(metadata: Optional[Dict[str, Any]]) -> str:
    """Idioma origen d'un registre llegit del seu camp "Idioma" (o sinònim).

    Retorna el codi ISO 639-1, o '' si el registre no té un camp idioma
    reconeixible amb valor vàlid (el caller cau llavors a la heurística de text).
    Es compara el nom de la clau accent/caixa-insensiblement.
    """
    if not metadata or not isinstance(metadata, dict):
        return ""
    for key, val in metadata.items():
        norm_key = _strip_accents(str(key).lower())
        if norm_key in _LANGUAGE_FIELD_NAMES:
            code = normalize_lang_code(val[0] if isinstance(val, list) and val else val)
            if code:
                return code
    return ""
