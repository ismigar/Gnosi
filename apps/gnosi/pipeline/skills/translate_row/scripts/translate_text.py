"""Translate text used by the `translate_row` skill.

Public surface (consumed by `backend.api.vault_routes`):

    translate(text, src, tgt, *, deepl_api_key=None, softcatala_url=None) -> (str, provider)
    detect_source_lang(text) -> str

Routing (Mid plan, free-tools-first):

    Pair                   Provider              Notes
    ----                   --------              -----
    en↔ca                  Softcatalà NMT        Online, neural, excellent.
    other pair with ca     Softcatalà Apertium   Online, rule-based, +acronym fix.
    es↔fr / fr↔es          OPUS-MT (Helsinki)    Local, lazy-loaded, auto-unloaded.
    other pair without ca  Apertium APy public   Online, rule-based, +acronym fix.
    fallback               DeepL                 Only if API key configured.
    last resort            placeholder           "[lang] {text}".

The local OPUS-MT model is loaded on first use and freed after
``OPUS_IDLE_TIMEOUT_S`` seconds of inactivity, so RAM is ~0 when not
translating es↔fr.

Configured via environment:

    DEEPL_API_KEY              DeepL Pro/Free API key.
    DEEPL_API_URL              Override DeepL endpoint.
    SOFTCATALA_API_URL         Override Softcatalà NMT/Apertium endpoints.
    APERTIUM_PUBLIC_API_URL    Override the public Apertium APy endpoint.
    OPUS_IDLE_TIMEOUT_S        Seconds before unloading the OPUS-MT model.
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import threading
import time
from typing import Optional

import requests

log = logging.getLogger(__name__)

DEFAULT_DEEPL_URL = "https://api-free.deepl.com/v2/translate"

# Softcatalà publicly exposes two endpoints (neither requires an API key):
#  - NMT (Neural): high quality, but *only* en↔ca.
#  - Apertium (basat en regles): qualitat regular, cobreix
#    cat↔{spa, fra, ita, por, ron, oci, eng, arg, epo, …}.
DEFAULT_SOFTCATALA_NMT_URL = "https://www.softcatala.org/sc/v2/api/nmt-engcat/translate"
DEFAULT_SOFTCATALA_APERTIUM_URL = "https://www.softcatala.org/apertium/json/translate"

# Public Apertium APy: covers pairs *without* Catalan that Softcatalà doesn't serve
# (e.g. spa↔eng, spa↔fra). Shares the same payload and response format
# than Softcatalà's.
DEFAULT_APERTIUM_PUBLIC_URL = "https://apertium.org/apy/translate"

REQUEST_TIMEOUT_S = 20

# OPUS-MT lazy-load config. The model stays in memory while in use and is
# unloaded after this interval — so we never keep ~300-500 MB resident
# just in case we need to translate es↔fr.
OPUS_IDLE_TIMEOUT_S = int(os.environ.get("OPUS_IDLE_TIMEOUT_S", "300"))


# ---------------------------------------------------------------------------
# Detection heuristic
# ---------------------------------------------------------------------------

# Simple lexical markers — not a robust detection, but sufficient
# for the short, structured text typically found in a row.
_LANG_HINTS = {
    "ca": (r"\b(és|amb|pel|del|cap|fins|això|aquí|però|també|nostre)\b", r"[lt]·[lt]|ç|í|ò|ú"),
    "es": (r"\b(es|con|por|del|hasta|esto|aquí|pero|también|nuestro|qué)\b", r"ñ|¿|¡"),
    "en": (r"\b(the|with|from|this|here|but|also|our|what|and|of)\b", r""),
    "fr": (r"\b(est|avec|par|du|jusqu|ceci|ici|mais|aussi|notre|quoi)\b", r"œ|ç"),
    "de": (r"\b(ist|mit|von|bis|dies|hier|aber|auch|unser|was|und)\b", r"ä|ö|ü|ß"),
    "it": (r"\b(è|con|per|dal|fino|questo|qui|ma|anche|nostro|cosa)\b", r""),
    "pt": (r"\b(é|com|por|do|até|isto|aqui|mas|também|nosso|que)\b", r"ã|õ|ç"),
}


def detect_source_lang(text: str) -> str:
    """Return the most plausible ISO 639-1 code for ``text``.

    Defaults to ``"ca"`` when nothing matches — Gnosi's primary content language.
    """
    if not text:
        return "ca"
    sample = text.lower()[:500]
    scores = {}
    for code, (words_re, chars_re) in _LANG_HINTS.items():
        score = len(re.findall(words_re, sample))
        if chars_re:
            score += len(re.findall(chars_re, sample))
        scores[code] = score
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "ca"


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

# Apertium translates all-caps or capitalized words as common
# nouns: "API" → "apio" (es) / "céleri" (fr). This function protects them
# by substituting them with neutral alphanumeric tokens before the call and
# restoring them afterward. We consider 2-6 character acronyms as candidates
# fully uppercase (ASCII), optionally with digits or hyphens:
# API, URL, JSON, HTTP, OAuth2, GPT-4, etc.
_ACRONYM_RE = re.compile(r"\b[A-Z][A-Z0-9-]{1,5}\b")


def _protect_acronyms(text: str) -> tuple[str, dict[str, str]]:
    """Replace acronyms with neutral tokens. Return (protected_text, mapping).

    The token form ``XACRNZZZ`` is chosen because it survives most rule-based
    MT pipelines without being modified (no diacritics, no spaces, valid
    word-character sequence, low collision odds).
    """
    mapping: dict[str, str] = {}
    counter = [0]

    def repl(match):
        original = match.group(0)
        token = f"XACRN{counter[0]:03d}ZZZ"
        mapping[token] = original
        counter[0] += 1
        return token

    protected = _ACRONYM_RE.sub(repl, text)
    return protected, mapping


def _restore_acronyms(text: str, mapping: dict[str, str]) -> str:
    """Reverse ``_protect_acronyms``. Tolerant to case mangling by the MT.

    Apertium often lowercases the protected token ("xacrn001zzz"); we match
    case-insensitively when restoring so no acronym is lost.
    """
    if not mapping:
        return text
    out = text
    for token, original in mapping.items():
        out = re.sub(re.escape(token), original, out, flags=re.IGNORECASE)
    return out


# Softcatalà and Apertium use 3-letter ISO 639-3 codes in their `langpair`
# parameter (cat, eng, spa, …). We accept the more common 2-letter codes
# from the UI and map them on the way out.
_ISO639_2_TO_3 = {
    "ca": "cat",
    "es": "spa",
    "en": "eng",
    "fr": "fra",
    "de": "deu",
    "it": "ita",
    "pt": "por",
    "nl": "nld",
    "oc": "oci",
    "ro": "ron",
    "eu": "eus",  # Basque — Apertium covers it from ca/es
    "gl": "glg",  # Galician — Apertium covers it from ca/es
    "ar": "ara",  # Arabic (used to be "arg" = Aragonese, a mistake). Apertium doesn't cover it → via DeepL
    "zh": "zho",  # Chinese — Apertium doesn't cover it → via DeepL
    "eo": "epo",
}


def _to_iso3(code: str) -> str:
    return _ISO639_2_TO_3.get(code, code)


# Languages that Softcatalà's Apertium translates to/from Catalan (pairs
# `cat↔xxx`), VERIFIED empirically against the endpoint (unverified ones
# returned HTTP 400). For the rest (Arabic, Chinese, Basque, and Galician from Catalan)
# there's no cat↔ engine, so we fall back to DeepL.
#   - eu (Basque): Apertium does NOT cover it from ca or from es → DeepL.
#   - gl (Galician): Apertium covers it from ES (spa→glg ✅) but NOT from
#     Catalan (cat→glg returns 400). That's why gl is NOT here: with Catalan as source
#     it would fall to DeepL; with Spanish as source, the public Apertium block covers it.
_SOFTCATALA_APERTIUM_LANGS = {"es", "en", "fr", "pt", "it", "oc", "ro", "de", "nl"}


def _parse_apertium_response(data) -> str:
    """Extract translatedText from a Softcatalà or Apertium APy response.

    Both endpoints share the envelope:
        {"responseStatus": 200, "responseData": {"translatedText": "…"}, …}
    """
    rd = data.get("responseData") if isinstance(data, dict) else None
    if isinstance(rd, dict):
        out = rd.get("translatedText")
        if out is not None:
            return str(out)
    raise RuntimeError(f"Unexpected Apertium-shape response: {data!r}")


# ---------------------------------------------------------------------------
# Provider routing
# ---------------------------------------------------------------------------


def translate(
    text: str,
    source_lang: str,
    target_lang: str,
    *,
    deepl_api_key: Optional[str] = None,
    softcatala_url: Optional[str] = None,
) -> tuple[str, str]:
    """Translate ``text`` from ``source_lang`` to ``target_lang``.

    Returns ``(translated_text, provider)``. ``provider`` is one of:
    ``"softcatala_nmt"``, ``"softcatala_apertium"``, ``"opus_mt"``,
    ``"apertium_public"``, ``"deepl"``, ``"placeholder"``, ``"noop"``.

    Routing decisions and rationale live in the module docstring.
    """
    if not text:
        return text, "noop"
    if source_lang == target_lang:
        return text, "noop"

    pair = {source_lang, target_lang}
    involves_catalan = "ca" in pair

    # 1. Catalan: Softcatalà. NMT if en↔ca; Apertium for the languages it
    # covers (regional and closely related Romance languages), with an acronym quick-fix so that
    # "API" isn't translated as "apio/céleri". For pairs with Catalan that
    # Apertium does NOT cover (e.g. Arabic, Chinese), we do NOT return a placeholder here:
    # we fall through to DeepL (block 4) as a last resort.
    if involves_catalan:
        other = (pair - {"ca"}).pop() if pair != {"ca"} else "ca"
        if pair == {"en", "ca"}:
            try:
                return _translate_softcatala_nmt(text, source_lang, target_lang, softcatala_url), "softcatala_nmt"
            except Exception as exc:
                log.warning("Softcatalà NMT failed (%s→%s): %s — trying DeepL", source_lang, target_lang, exc)
        elif other in _SOFTCATALA_APERTIUM_LANGS:
            try:
                protected, acro = _protect_acronyms(text)
                translated = _translate_softcatala_apertium(protected, source_lang, target_lang, softcatala_url)
                return _restore_acronyms(translated, acro), "softcatala_apertium"
            except Exception as exc:
                log.warning("Softcatalà Apertium failed (%s→%s): %s — trying DeepL", source_lang, target_lang, exc)
        # If we get here, Apertium doesn't cover the pair (or it failed) →
        # we continue to the DeepL fallback below.
        api_key = (deepl_api_key or os.environ.get("DEEPL_API_KEY", "")).strip()
        if api_key:
            try:
                return _translate_deepl(text, source_lang, target_lang, api_key), "deepl"
            except Exception as exc:
                log.warning("DeepL translation failed (%s→%s): %s", source_lang, target_lang, exc)
        return f"[{target_lang}] {text}", "placeholder"

    # 2. es↔fr: local lazy OPUS-MT. Public Apertium gives very low quality
    # for this pair (serious grammatical errors), justifies loading a
    # ~300 MB model on demand.
    if pair == {"es", "fr"}:
        try:
            return _translate_opus_mt(text, source_lang, target_lang), "opus_mt"
        except Exception as exc:
            log.warning("OPUS-MT translation failed (%s→%s): %s — falling back", source_lang, target_lang, exc)
            # Falls back to public Apertium as a last free resort.

    # 3. Remaining pairs without Catalan: public Apertium APy + acronym fix.
    try:
        protected, acro = _protect_acronyms(text)
        translated = _translate_apertium_public(protected, source_lang, target_lang)
        return _restore_acronyms(translated, acro), "apertium_public"
    except Exception as exc:
        log.info("Apertium public failed (%s→%s): %s — trying DeepL", source_lang, target_lang, exc)

    # 4. DeepL as a last resort (only if the user has configured the key).
    api_key = (deepl_api_key or os.environ.get("DEEPL_API_KEY", "")).strip()
    if api_key:
        try:
            return _translate_deepl(text, source_lang, target_lang, api_key), "deepl"
        except Exception as exc:
            log.warning("DeepL translation failed (%s→%s): %s", source_lang, target_lang, exc)

    return f"[{target_lang}] {text}", "placeholder"


# ---------------------------------------------------------------------------
# Provider adapters — Softcatalà
# ---------------------------------------------------------------------------


def _translate_softcatala_nmt(text: str, source_lang: str, target_lang: str, override_url: Optional[str] = None) -> str:
    """Translate via Softcatalà's neural en↔ca endpoint."""
    url = (override_url or os.environ.get("SOFTCATALA_API_URL") or DEFAULT_SOFTCATALA_NMT_URL)
    params = {"langpair": f"{source_lang}|{target_lang}", "q": text}
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return _parse_apertium_response(response.json())


def _translate_softcatala_apertium(text: str, source_lang: str, target_lang: str, override_url: Optional[str] = None) -> str:
    """Translate via Softcatalà's Apertium endpoint (cat↔ regional langs)."""
    url = (override_url or os.environ.get("SOFTCATALA_API_URL") or DEFAULT_SOFTCATALA_APERTIUM_URL)
    src, tgt = _to_iso3(source_lang), _to_iso3(target_lang)
    params = {"langpair": f"{src}|{tgt}", "q": text, "markUnknown": "no"}
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return _parse_apertium_response(response.json())


def _translate_apertium_public(text: str, source_lang: str, target_lang: str) -> str:
    """Translate via the public Apertium APy server (apertium.org/apy)."""
    url = os.environ.get("APERTIUM_PUBLIC_API_URL") or DEFAULT_APERTIUM_PUBLIC_URL
    src, tgt = _to_iso3(source_lang), _to_iso3(target_lang)
    params = {"langpair": f"{src}|{tgt}", "q": text, "markUnknown": "no"}
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return _parse_apertium_response(response.json())


# ---------------------------------------------------------------------------
# Provider adapters — OPUS-MT (local, lazy)
# ---------------------------------------------------------------------------

# In-process cache for Marian models. Each entry: (model, tokenizer, last_used_ts).
# Keyed by "src-tgt" pair.
_opus_cache: dict[str, tuple[object, object, float]] = {}
_opus_lock = threading.Lock()


def _purge_idle_opus(now: float) -> None:
    """Drop OPUS models that haven't been used for OPUS_IDLE_TIMEOUT_S."""
    expired = [k for k, (_, _, last) in _opus_cache.items() if (now - last) > OPUS_IDLE_TIMEOUT_S]
    for k in expired:
        log.info("Unloading idle OPUS-MT model: %s", k)
        del _opus_cache[k]


def _translate_opus_mt(text: str, source_lang: str, target_lang: str) -> str:
    """Translate via Helsinki-NLP/opus-mt-{src}-{tgt}, lazily loaded.

    The first call downloads the model (~300 MB) into the HuggingFace cache
    (configurable via ``HF_HOME`` or ``${HOME}/.cache/huggingface``). Subsequent
    calls reuse the in-memory model. Idle models are unloaded after
    ``OPUS_IDLE_TIMEOUT_S`` seconds.
    """
    pair_key = f"{source_lang}-{target_lang}"
    now = time.time()

    with _opus_lock:
        _purge_idle_opus(now)
        cached = _opus_cache.get(pair_key)
        if cached is None:
            # Defer the heavy import so module import stays cheap.
            try:
                from transformers import MarianMTModel, MarianTokenizer
            except ImportError as exc:
                raise RuntimeError(
                    "OPUS-MT requires `transformers` and `sentencepiece` "
                    "(transformers ships with sentence-transformers; install "
                    "sentencepiece if missing)."
                ) from exc
            model_name = f"Helsinki-NLP/opus-mt-{pair_key}"
            log.info("Loading OPUS-MT model: %s", model_name)
            tokenizer = MarianTokenizer.from_pretrained(model_name)
            model = MarianMTModel.from_pretrained(model_name)
            _opus_cache[pair_key] = (model, tokenizer, now)
        else:
            model, tokenizer, _ = cached
            _opus_cache[pair_key] = (model, tokenizer, now)

    # Inference. Defer torch import for the same reason.
    import torch
    inputs = tokenizer([text], return_tensors="pt", truncation=True, max_length=512)
    with torch.no_grad():
        outputs = model.generate(**inputs, max_length=512, num_beams=4, early_stopping=True)
    return tokenizer.decode(outputs[0], skip_special_tokens=True)


# ---------------------------------------------------------------------------
# Provider adapters — DeepL
# ---------------------------------------------------------------------------


def _translate_deepl(text: str, source_lang: str, target_lang: str, api_key: str) -> str:
    """Translate via DeepL API."""
    url = os.environ.get("DEEPL_API_URL", DEFAULT_DEEPL_URL)
    payload = {"text": [text], "target_lang": target_lang.upper()}
    if source_lang:
        payload["source_lang"] = source_lang.upper()
    headers = {
        "Authorization": f"DeepL-Auth-Key {api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    data = response.json()
    translations = data.get("translations") or []
    if not translations:
        raise RuntimeError(f"Unexpected DeepL response shape: {data!r}")
    return str(translations[0].get("text") or "")


# ---------------------------------------------------------------------------
# CLI — useful for ad-hoc testing without going through the API
# ---------------------------------------------------------------------------


def _main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Translate text via the translate_row skill")
    parser.add_argument("--text", required=True, help="Text to translate")
    parser.add_argument("--source", default="", help="Source language (ISO 639-1). Auto-detect if empty.")
    parser.add_argument("--target", required=True, help="Target language (ISO 639-1)")
    args = parser.parse_args(argv)

    src = args.source or detect_source_lang(args.text)
    out, provider = translate(args.text, src, args.target)
    print(f"[{provider}] {src}→{args.target}: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
