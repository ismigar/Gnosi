"""Pure helpers for content translation (translate_row / translate_page skills).

They live in `services/` (not inline in `vault_routes`) for two reasons:

1. **Testability**: they can be tested with pytest without importing the whole backend,
   which drags in `langgraph` and is slow/heavy to import in a subprocess
   (see the `feedback_local_backend_test_verification` directive).
2. **Reuse**: both the `translate-row`/`translate-page` endpoints (for
   idempotency) and the save hooks (`patch_page`/`save_page`, for obsolescence
   marking) need the same lookup and comparison logic.

No I/O or FastAPI; shared value contracts only: data goes in, data comes out.
"""
import re
from collections.abc import Callable, Iterable
from typing import TypeVar

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import RecordReader, is_object_list, is_record
from backend.utils.open_values import iterable_values


PageT = TypeVar("PageT")


def canonicalize_id(page_id: object) -> str:
    """Normalizes a UUID for robust comparison.

    IDs can come with dashes (`df361486-5ff3-...`, standard UUID form) or
    without (`df3614865ff3...`, as Notion exports them). `parent_id`, manual edits, and
    `translation_origin_id` can carry either of the two forms; comparing them
    as raw strings causes false negatives. This helper unifies the two
    forms (lowercase, without dashes or spaces).
    
    """
    return str(page_id or "").strip().lower().replace("-", "")


def _meta_of(page: object) -> PageMetadata:
    """Extracts the metadata dict from a `PageInfo` or from a plain dict."""
    if page is None:
        return {}
    md: object = getattr(page, "metadata", None)
    if md is None and is_record(page):
        md = page.get("metadata")
    return md if is_record(md) else {}


def find_translations_of(origin_id: str, pages: Iterable[PageT]) -> dict[str, PageT]:
    """Returns `{lang: page}` of the child translations of an original.

    A translation is a page with `metadata.translation_origin_id` equal to
    `origin_id` (compared canonically) and a non-empty `metadata.translation_lang`.

    `pages` is any iterable of objects with `.metadata` (e.g. `PageInfo`) or of
    dicts with a `metadata` key. If there were more than one translation for the same
    language (dirty state from old re-translations before idempotency), the last one
    seen wins — the caller will reuse one of them and the rest can be cleaned up manually.
    
    """
    out: dict[str, PageT] = {}
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
    old_md: RecordReader | None,
    new_md: RecordReader | None,
    old_body: str | None = None,
    new_body: str | None = None,
    *,
    title_matters: bool = False,
) -> bool:
    """Indicates whether an edit affects the content being translated.

    Acts as a guard in the save hook: translations only need to be marked as
    stale if this returns `True`. It's key to avoid triggering writes on every
    keystroke of the Vault's autosave when the change isn't relevant.

    Cases:
      - **Records**: `translatable_keys` are the keys (`id`/`name`) of the fields
        marked as translatable; each value is compared in the frontmatter. `title_matters`
        is activated when the title field is translatable.
      - **Pages**: `old_body`/`new_body` and `title_matters=True` are passed (pages
        always translate title + body).

    Compares with a direct `!=`; that's enough because before and after share the
    same key shape within the same save.
    
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


# --- Source language detection via the record's "Idioma" field ----------
# Mirror of the frontend helper (schemaUtils.detectRecordSourceLang): backend and
# UI must agree on what the original language is. If the record has a field
# "Idioma" (or a synonym), its value takes precedence over the text-based heuristic detection.

# Field names we typically use for "the record's language".
_LANGUAGE_FIELD_NAMES = {"idioma", "llengua", "language", "lang", "lengua", "lingua"}

# Common labels/codes → ISO 639-1 code.
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


def normalize_lang_code(value: object) -> str:
    """Normalizes a language value ("Català", "EN-GB", "ca") to an ISO 639-1 code.

    Returns '' if it can't be determined.
    
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


def detect_record_source_lang(metadata: object) -> str:
    """Source language of a record, read from its "Idioma" field (or a synonym).

    Returns the ISO 639-1 code, or '' if the record doesn't have a recognizable
    language field with a valid value (the caller then falls back to the text heuristic).
    The key name is compared accent/case-insensitively.
    
    """
    if not metadata or not is_record(metadata):
        return ""
    for key, val in metadata.items():
        norm_key = _strip_accents(str(key).lower())
        if norm_key in _LANGUAGE_FIELD_NAMES:
            code = normalize_lang_code(val[0] if is_object_list(val) and val else val)
            if code:
                return code
    return ""


def detect_record_lang_raw(metadata: object) -> str:
    """RAW value (lowercase) of the row's "Idioma" field, WITHOUT truncating to 2
    letters. E.g. "EN-GB" → "en-gb". '' if it doesn't have one. For targets that accept
    regional codes (like Drupal, which can have "en-gb")."""
    if not metadata or not is_record(metadata):
        return ""
    for key, val in metadata.items():
        if _strip_accents(str(key).lower()) in _LANGUAGE_FIELD_NAMES:
            v = val[0] if is_object_list(val) and val else val
            return str(v or "").strip().lower()
    return ""


# --- Filling in the translation's "Idioma" field ---------------------------------
# `detect_record_source_lang` READS the language of the original; these functions
# do the inverse: they decide WHAT to write in the translated subitem's "Idioma" field
# so it ends up marked with the target language (before, it was left empty). They are pure (data
# in, data out) so the test doesn't have to import the whole backend.


def find_language_property(properties: Iterable[object] | None) -> PageMetadata | None:
    """Returns the "Idioma" property (or a synonym) from a list of table
    properties, or None if there isn't one. The name is compared accent/case-insensitively
    (mirrors `detect_record_source_lang`)."""
    for p in properties or []:
        if not is_record(p):
            continue
        if _strip_accents(str(p.get("name") or "").lower()) in _LANGUAGE_FIELD_NAMES:
            return p
    return None


def _select_option_values(prop: PageMetadata) -> list[str]:
    """Selectable values of a select: `config.options` (nested, what the inline PATCH
    writes) or `options` (top-level, what the modal's save writes). Each
    option can be a string or a dict {name/label/value}. Returns clean strings."""
    cfg = prop.get("config")
    raw: object = None
    if is_record(cfg) and isinstance(cfg.get("options"), list):
        raw = cfg["options"]
    elif isinstance(prop.get("options"), list):
        raw = prop["options"]
    out: list[str] = []
    for o in iterable_values(raw or []):
        label = (o.get("name") or o.get("label") or o.get("value")) if is_record(o) else o
        if isinstance(label, str) and label.strip():
            out.append(label.strip())
    return out


def language_field_value(prop: PageMetadata, target_lang: str) -> str:
    """Value to write to the language field for `target_lang`.

    Prioritizes an existing option from the select's catalog that matches the
    target code (Notion style: reuses the value the user already has —"Català", "CA"…—
    instead of duplicating it). If there isn't one, it falls back to the ISO code in
    UPPERCASE ("CA", "EN"…), the format of already-existing records. Returns '' if
    the code can't be determined.
    
    """
    # normalize_lang_code already accepts both labels ("Català") and any
    # 2-letter ISO code ("ca", "ja"…); if it rejects it, it's not a language → we don't write it.
    code = normalize_lang_code(target_lang)
    if not code:
        return ""
    for opt in _select_option_values(prop):
        if normalize_lang_code(opt) == code:
            return opt
    return code.upper()


def language_field_assignment(
    properties: Iterable[object] | None,
    target_lang: str,
    parent_metadata: object = None,
) -> tuple[str | None, str | list[str] | None]:
    """(key, value) to mark the language field of a translation, or (None, None) if
    the table has no language field or the code can't be resolved.

    The `key` is the property's stable id (or its name if it doesn't have one); the
    backend (`to_storage_names`) rewrites it to the name on save, as it does with
    the rest of the fields. The `value` respects the multi_select format (list) when
    the property is one, or when the parent already saved the language as a list.
    
    """
    prop = find_language_property(properties)
    if not prop:
        return None, None
    raw_key = prop.get("id") or prop.get("name")
    if not isinstance(raw_key, str) or not raw_key:
        return None, None
    key = raw_key
    value = language_field_value(prop, target_lang)
    if not value:
        return None, None
    ptype = str(prop.get("type") or "").lower().replace("-", "_")
    is_multi = ptype in ("multi_select", "multiselect")
    if not is_multi and is_record(parent_metadata):
        name = prop.get("name")
        field_id = prop.get("id")
        parent_val = parent_metadata.get(name) if isinstance(name, str) else None
        if parent_val is None and isinstance(field_id, str) and field_id:
            parent_val = parent_metadata.get(field_id)
        if isinstance(parent_val, list):
            is_multi = True
    return key, ([value] if is_multi else value)


# --- Composite image fields -------------------------------------------------
# An image field can have a path (string) or a composite map as its value
# {src, alt, title, caption, credit} (see frontend lib/fileResource.js). When
# is translatable, the image (src) must NOT be translated — it stays the same (the
# subitem references the same file, without duplicating it) — and only
# the TEXT subfields (alt, title, caption, credit).

_IMAGE_SRC_KEYS = ("src", "url", "path")
_IMAGE_TEXT_SUBKEYS = ("alt", "title", "caption", "credit", "description")
# Mirror of isImageFieldName(): excludes field names for text ABOUT the image (Alt, Peu…)
# and accepts Imatge/Cover/Foto… We use it for image fields without subfields
# (string path value) so the path doesn't get translated as if it were text.
_IMAGE_NAME_RE = re.compile(r"(image|imatge|cover|thumbnail|thumb|foto|imagen)", re.IGNORECASE)
_IMAGE_NAME_EXCLUDE_RE = re.compile(
    r"\balt\b|\btext\b|\bcaption\b|\bpeu\b|\bllegenda\b|\bleyenda\b|descrip", re.IGNORECASE
)


def is_image_field_name(name: object) -> bool:
    """True if the field NAME denotes an image (Imatge/Cover/Foto…), excluding
    those that denote text about the image (Alt/Caption/Peu…)."""
    s = str(name or "")
    if _IMAGE_NAME_EXCLUDE_RE.search(s):
        return False
    return bool(_IMAGE_NAME_RE.search(s))


def is_composite_image_value(val: object) -> bool:
    """True if the value is a composite image map (has non-empty src/url/path)."""
    return is_record(val) and any(
        isinstance((source := val.get(k)), str) and bool(source.strip())
        for k in _IMAGE_SRC_KEYS
    )


def translate_image_field(
    val: object,
    translate_one: Callable[[str], tuple[str, str]],
) -> tuple[object, set[str], bool]:
    """Translate the text subfields of an image field, keeping the image.

    `translate_one(text) -> (translated, provider)`. Returns
    `(new_value, providers, any_translated)`:
      - If `val` is a composite map, it is copied and alt/title/caption/
        credit/description are translated; the src (and the rest of the keys) is kept → the subitem
        references the same file, no copy is created.
      - If `val` is a string (path) it is returned as-is (the path is not translated).
    
    """
    if not is_record(val):
        return val, set(), False
    out = dict(val)
    providers: set[str] = set()
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
