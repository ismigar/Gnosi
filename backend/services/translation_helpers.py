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
import re
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


def detect_record_lang_raw(metadata: Optional[Dict[str, Any]]) -> str:
    """Valor CRU (minúscules) del camp "Idioma" de la fila, SENSE truncar a 2
    lletres. P. ex. "EN-GB" → "en-gb". '' si no en té. Per a destins que accepten
    codis regionals (com Drupal, que pot tenir "en-gb")."""
    if not metadata or not isinstance(metadata, dict):
        return ""
    for key, val in metadata.items():
        if _strip_accents(str(key).lower()) in _LANGUAGE_FIELD_NAMES:
            v = val[0] if isinstance(val, list) and val else val
            return str(v or "").strip().lower()
    return ""


# --- Omplir el camp "Idioma" de la traducció ---------------------------------
# `detect_record_source_lang` LLEGEIX l'idioma de l'original; aquestes funcions
# fan l'invers: decideixen QUÈ escriure al camp "Idioma" del subitem traduït
# perquè quedi marcat amb l'idioma destí (abans quedava buit). Són pures (dades
# entren, dades surten) perquè el test no hagi d'importar el backend sencer.


def find_language_property(properties: Optional[Iterable[Any]]) -> Optional[Dict[str, Any]]:
    """Retorna la propietat "Idioma" (o sinònim) d'una llista de propietats de
    taula, o None si no en té cap. El nom es compara accent/caixa-insensiblement
    (mirall de `detect_record_source_lang`)."""
    for p in properties or []:
        if not isinstance(p, dict):
            continue
        if _strip_accents(str(p.get("name") or "").lower()) in _LANGUAGE_FIELD_NAMES:
            return p
    return None


def _select_option_values(prop: Dict[str, Any]) -> list:
    """Valors triables d'un select: `config.options` (niat, el que escriu el PATCH
    inline) o `options` (nivell superior, el que escriu el desat del modal). Cada
    opció pot ser un string o un dict {name/label/value}. Retorna strings nets."""
    cfg = prop.get("config")
    raw = None
    if isinstance(cfg, dict) and isinstance(cfg.get("options"), list):
        raw = cfg["options"]
    elif isinstance(prop.get("options"), list):
        raw = prop["options"]
    out: list = []
    for o in raw or []:
        label = (o.get("name") or o.get("label") or o.get("value")) if isinstance(o, dict) else o
        if isinstance(label, str) and label.strip():
            out.append(label.strip())
    return out


def language_field_value(prop: Dict[str, Any], target_lang: str) -> str:
    """Valor a escriure al camp idioma per a `target_lang`.

    Prioritza una opció existent del catàleg del select que casi amb el codi
    destí (estil Notion: reaprofita el valor que l'usuari ja té —"Català", "CA"…—
    en lloc de duplicar-lo). Si no n'hi ha cap, cau al codi ISO en MAJÚSCULES
    ("CA", "EN"…), el format dels registres ja existents. Retorna '' si el codi
    no es pot determinar.
    """
    # normalize_lang_code ja accepta tant etiquetes ("Català") com qualsevol codi
    # ISO de 2 lletres ("ca", "ja"…); si el rebutja, no és un idioma → no escrivim.
    code = normalize_lang_code(target_lang)
    if not code:
        return ""
    for opt in _select_option_values(prop):
        if normalize_lang_code(opt) == code:
            return opt
    return code.upper()


def language_field_assignment(
    properties: Optional[Iterable[Any]],
    target_lang: str,
    parent_metadata: Optional[Dict[str, Any]] = None,
) -> tuple:
    """(clau, valor) per marcar el camp idioma d'una traducció, o (None, None) si
    la taula no té camp idioma o el codi no es pot resoldre.

    La `clau` és l'id estable de la propietat (o el nom si no en té); el backend
    (`to_storage_names`) la reescriu al nom en desar, com fa amb la resta de
    camps. El `valor` respecta el format multi_select (llista) quan la propietat
    ho és, o quan el pare ja desava l'idioma com a llista.
    """
    prop = find_language_property(properties)
    if not prop:
        return None, None
    key = prop.get("id") or prop.get("name")
    if not key:
        return None, None
    value = language_field_value(prop, target_lang)
    if not value:
        return None, None
    ptype = str(prop.get("type") or "").lower().replace("-", "_")
    is_multi = ptype in ("multi_select", "multiselect")
    if not is_multi and isinstance(parent_metadata, dict):
        parent_val = parent_metadata.get(prop.get("name"))
        if parent_val is None and prop.get("id"):
            parent_val = parent_metadata.get(prop.get("id"))
        if isinstance(parent_val, list):
            is_multi = True
    return key, ([value] if is_multi else value)


# --- Camps imatge compostos -------------------------------------------------
# Un camp imatge pot tenir com a valor una ruta (string) o un mapa compost
# {src, alt, title, caption, credit} (veure frontend lib/fileResource.js). Quan
# és traduïble, NO s'ha de traduir la imatge (src) — es manté la mateixa (el
# subitem referencia el mateix fitxer, sense duplicar-lo) — i només es tradueixen
# els subcamps de TEXT (alt, title, caption, credit).

_IMAGE_SRC_KEYS = ("src", "url", "path")
_IMAGE_TEXT_SUBKEYS = ("alt", "title", "caption", "credit", "description")
# Mirall de isImageFieldName(): exclou noms de text SOBRE la imatge (Alt, Peu…)
# i accepta Imatge/Cover/Foto… El fem servir per als camps imatge sense subcamps
# (valor ruta string) perquè no se'ls tradueixi la ruta com si fos text.
_IMAGE_NAME_RE = re.compile(r"(image|imatge|cover|thumbnail|thumb|foto|imagen)", re.IGNORECASE)
_IMAGE_NAME_EXCLUDE_RE = re.compile(
    r"\balt\b|\btext\b|\bcaption\b|\bpeu\b|\bllegenda\b|\bleyenda\b|descrip", re.IGNORECASE
)


def is_image_field_name(name: Any) -> bool:
    """True si el NOM del camp denota una imatge (Imatge/Cover/Foto…), excloent
    els que denoten text sobre la imatge (Alt/Caption/Peu…)."""
    s = str(name or "")
    if _IMAGE_NAME_EXCLUDE_RE.search(s):
        return False
    return bool(_IMAGE_NAME_RE.search(s))


def is_composite_image_value(val: Any) -> bool:
    """True si el valor és un mapa d'imatge compost (té src/url/path no buit)."""
    return isinstance(val, dict) and any(
        isinstance(val.get(k), str) and val.get(k).strip() for k in _IMAGE_SRC_KEYS
    )


def translate_image_field(val: Any, translate_one) -> tuple:
    """Tradueix els subcamps de text d'un camp imatge, mantenint la imatge.

    `translate_one(text) -> (traduït, provider)`. Retorna
    `(nou_valor, providers, any_translated)`:
      - Si `val` és un mapa compost, es còpia i es tradueixen alt/title/caption/
        credit/description; el src (i la resta de claus) es manté → el subitem
        referencia el mateix fitxer, no se'n crea cap còpia.
      - Si `val` és un string (ruta) es retorna tal qual (no es tradueix la ruta).
    """
    if not isinstance(val, dict):
        return val, set(), False
    out = dict(val)
    providers: set = set()
    any_tr = False
    for k in _IMAGE_TEXT_SUBKEYS:
        sub = val.get(k)
        if isinstance(sub, str) and sub.strip():
            translated, provider = translate_one(sub)
            out[k] = translated
            if provider and provider != "noop":
                providers.add(provider)
            any_tr = True
    return out, providers, any_tr
