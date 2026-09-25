"""Translate through the shared agent executor, preserving the historic callable API."""
from __future__ import annotations

import argparse
import re
import sys
from typing import Optional

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

    Defaults to ``"en"`` when nothing matches, matching Gnosi's default language.
    """
    if not text:
        return "en"
    sample = text.lower()[:500]
    scores: dict[str, int] = {}
    for code, (words_re, chars_re) in _LANG_HINTS.items():
        score = len(re.findall(words_re, sample))
        if chars_re:
            score += len(re.findall(chars_re, sample))
        scores[code] = score
    best = max(scores, key=lambda code: scores[code])
    return best if scores[best] > 0 else "en"


def translate(
    text: str,
    source_lang: str,
    target_lang: str,
    *,
    deepl_api_key: Optional[str] = None,
    softcatala_url: Optional[str] = None,
) -> tuple[str, str]:
    """Compatibility entrypoint; legacy provider arguments are accepted but ignored."""
    if not text or source_lang == target_lang:
        return text, "noop"
    from backend.services.agent_behavior import task_input
    from backend.services.agent_execution import generate_for

    translated, _model = generate_for(
        "translation",
        task_input("translation.text", text=text, source_language=source_lang, language=target_lang),
    )
    return translated, "principal_agent"


def _main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Translate text via the translate_row skill")
    parser.add_argument("--text", required=True, help="Text to translate")
    parser.add_argument(
        "--source", default="", help="Source language (ISO 639-1). Auto-detect if empty."
    )
    parser.add_argument("--target", required=True, help="Target language (ISO 639-1)")
    args = parser.parse_args(argv)

    src = args.source or detect_source_lang(args.text)
    out, provider = translate(args.text, src, args.target)
    print(f"[{provider}] {src}→{args.target}: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
