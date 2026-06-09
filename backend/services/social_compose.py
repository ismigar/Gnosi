"""Capa d'IA per compondre publicacions de xarxes socials.

Donat un contingut origen (títol + cos + URL opcional) i una llista de xarxes,
genera UNA proposta de text adaptada a cada xarxa: respecta el límit de
caràcters, el to configurat i els hashtags per defecte, i —important— escriu
SEMPRE en el MATEIX IDIOMA que el contingut original (mai tradueix).

No publica res: només genera propostes perquè l'usuari les revisi/editi.
La publicació efectiva la fa `social_clients` via l'endpoint `/api/social/publish`.
"""
import re
import logging
from typing import Dict, List, Optional, Any

log = logging.getLogger(__name__)

# Nom de l'idioma EN EL PROPI IDIOMA perquè el model l'ancori bé.
LANG_NAMES = {
    "ca": "català",
    "es": "español",
    "en": "English",
    "fr": "français",
    "de": "Deutsch",
    "it": "italiano",
    "pt": "português",
    "nl": "Nederlands",
    "eu": "euskara",
    "gl": "galego",
}


def detect_lang(text: str) -> str:
    """Detecta l'idioma ISO 639-1 del contingut origen (defecte: 'ca').

    Reaprofita la heurística de la skill translate_row (funció pura, sense
    dependència del backend). Degrada a 'ca' si no és importable.
    """
    try:
        from pipeline.skills.translate_row.scripts.translate_text import detect_source_lang
        return detect_source_lang(text or "")
    except Exception as exc:  # pragma: no cover - degradació
        log.warning(f"social_compose: detect_source_lang no disponible ({exc}); assumeixo 'ca'")
        return "ca"


def build_prompt(
    *,
    content: str,
    title: str,
    url: str,
    network: str,
    char_limit: int,
    tone: str,
    hashtags_default: str,
    source_lang: str,
    hint: str,
    variation: int = 0,
) -> str:
    """Construeix el prompt per a una xarxa concreta."""
    lang_name = LANG_NAMES.get(source_lang, source_lang)
    parts: List[str] = [
        f"Ets un community manager expert. Redacta UNA sola publicació per a {network}.",
        f"IDIOMA OBLIGATORI del text: {lang_name} ({source_lang}). NO tradueixis a cap altre idioma; "
        f"escriu en el mateix idioma que el contingut original.",
        f"Límit estricte: màxim {char_limit} caràcters en total (inclosos hashtags i enllaç).",
    ]
    if tone:
        parts.append(f"To i veu: {tone}.")
    if hashtags_default:
        parts.append(f"Inclou 1-3 hashtags rellevants al final; prioritza aquests si encaixen: {hashtags_default}.")
    else:
        parts.append("Inclou 1-3 hashtags rellevants al final.")
    if url:
        parts.append(f"Pots acabar amb aquest enllaç: {url}")
    if hint:
        parts.append(f"Instrucció addicional de l'usuari: {hint}")
    if variation:
        parts.append(f"Proposa una alternativa CLARAMENT DIFERENT de les anteriors (variació #{variation}).")
    parts.append("Retorna NOMÉS el text final de la publicació, sense cometes, sense títols i sense explicacions.")
    parts.append("")
    parts.append(f"TÍTOL: {title}".strip())
    parts.append(f"CONTINGUT:\n{content}".strip())
    return "\n".join(p for p in parts if p is not None)


def _clean_output(raw: str) -> str:
    """Neteja la sortida del model: espais i cometes embolcall habituals."""
    text = (raw or "").strip()
    # Treu un embolcall complet de cometes (" ... " o ' ... ' o ``` ... ```).
    for fence in ("```", '"""', "'''"):
        if text.startswith(fence) and text.endswith(fence) and len(text) > 2 * len(fence):
            text = text[len(fence):-len(fence)].strip()
    if len(text) >= 2 and text[0] in "\"'“”" and text[-1] in "\"'“”":
        text = text[1:-1].strip()
    return text


def _extract_hashtags(text: str) -> List[str]:
    """Extreu els hashtags del text (per mostrar-los a part a la UI)."""
    return re.findall(r"#\w+", text or "")


def compose_one(
    *,
    network: str,
    char_limit: int,
    content: str,
    title: str,
    url: str,
    source_lang: str,
    tone: str = "",
    hashtags_default: str = "",
    hint: str = "",
    variation: int = 0,
) -> Dict[str, Any]:
    """Genera la proposta per a UNA xarxa. Síncron (l'endpoint l'envolta en to_thread).

    Retorna {text, hashtags, char_count, over_limit, provider}.
    """
    from pipeline.ai_client import call_ai_with_fallback

    prompt = build_prompt(
        content=content,
        title=title,
        url=url,
        network=network,
        char_limit=char_limit,
        tone=tone,
        hashtags_default=hashtags_default,
        source_lang=source_lang,
        hint=hint,
        variation=variation,
    )
    raw, provider = call_ai_with_fallback(prompt)
    text = _clean_output(raw)
    return {
        "text": text,
        "hashtags": _extract_hashtags(text),
        "char_count": len(text),
        "over_limit": len(text) > char_limit,
        "provider": provider,
    }
