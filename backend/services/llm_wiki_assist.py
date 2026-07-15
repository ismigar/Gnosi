"""Accessible editing for the Bústia del Cervell (F6).

Designed for a user with reduced mobility and dysarthria (variable
pronunciation — conventional ASR alone does not understand them reliably).
Three levels, none of which ever applies input raw:

  * ``reformulate()`` — the LLM generates labeled variants of a suggestion's
    draft to PICK with one click (no typing, no voice needed).
  * ``correct_dictation()`` — raw ASR text (faster-whisper) + the suggestion's
    context + the personal glossary → the LLM reconstructs the INTENT and the
    user confirms («Volies dir…?»). The narrow domain of a suggestion makes
    noisy ASR usable where free-form dictation fails.
  * glossary — per-vault (heard → meant) pairs confirmed by the user, injected
    into the corrector: the "intuition component" that grows over time.
"""
from __future__ import annotations

import json
import re
import threading
from typing import Any, Dict, List

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

_glossary_lock = threading.Lock()

GLOSSARY_FILENAME = "llm_wiki_glossary.json"
GLOSSARY_MAX_PAIRS = 100

# Variant labels are DATA (like column names), not UI chrome: they travel to
# the frontend as-is and describe the editorial angle of each variant.
VARIANT_LABELS = ("Més concisa", "Més matisada", "Amb contraargument")


# ---------------------------------------------------------------------------
# Personal glossary (heard → meant)
# ---------------------------------------------------------------------------

def _glossary_path():
    from backend.api.vault_routes import get_p

    return get_p("GNOSI_CONFIG") / GLOSSARY_FILENAME


def load_glossary() -> List[Dict[str, str]]:
    """Confirmed (heard → meant) pairs, oldest first. Malformed → empty."""
    try:
        data = json.loads(_glossary_path().read_text(encoding="utf-8"))
        pairs = data.get("pairs") if isinstance(data, dict) else None
        if not isinstance(pairs, list):
            return []
        return [p for p in pairs if isinstance(p, dict) and p.get("heard") and p.get("meant")]
    except Exception:  # noqa: BLE001
        return []


def learn_pair(heard: str, meant: str) -> int:
    """Stores a confirmed correction pair. Dedupes by `heard` (last wins),
    skips trivial pairs, caps the list. Returns the glossary size."""
    heard = " ".join(str(heard or "").split()).strip()
    meant = " ".join(str(meant or "").split()).strip()
    with _glossary_lock:
        pairs = load_glossary()
        if heard and meant and heard.lower() != meant.lower():
            pairs = [p for p in pairs if p["heard"].lower() != heard.lower()]
            pairs.append({"heard": heard, "meant": meant})
            pairs = pairs[-GLOSSARY_MAX_PAIRS:]
            from backend.utils.safe_io import safe_write_json

            path = _glossary_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            safe_write_json(path, {"pairs": pairs}, indent=2, ensure_ascii=False)
        return len(pairs)


# ---------------------------------------------------------------------------
# Level 1 — draft variants to pick (no typing, no voice)
# ---------------------------------------------------------------------------

def _suggestion_context(sug: Dict[str, Any]) -> str:
    members = ", ".join(sug.get("member_titles") or [])
    return (
        f"PREGUNTA que la nota respon: {sug.get('question') or '(cap)'}\n"
        f"PER QUÈ connecten les notes: {sug.get('why') or '(no indicat)'}\n"
        f"NOTES DE LECTURA implicades: {members or '(cap)'}\n"
        f"ESBORRANY ACTUAL:\n{sug.get('draft_md') or '(buit)'}"
    )


def reformulate(sug: Dict[str, Any], language: str = "català") -> List[Dict[str, str]]:
    """LLM variants of a suggestion's draft, one per editorial angle.

    Raises RuntimeError when no AI provider is available (endpoint → 503)."""
    from backend.agent.factory import generate_text

    labels = "\n".join(f"- \"{lb}\"" for lb in VARIANT_LABELS)
    prompt = f"""Ets l'editor d'una nota permanent d'un Zettelkasten. L'usuari tria entre
variants amb un clic (no tecleja): reescriu l'ESBORRANY en {language} en {len(VARIANT_LABELS)}
variants, una per cada angle editorial següent, mantenint els [[wikilinks]] existents:
{labels}

{_suggestion_context(sug)}

Retorna NOMÉS un JSON: {{"variants": [{{"label": "…", "text": "…"}}]}} amb exactament
aquests labels."""
    raw, _model = generate_text(prompt, timeout=90)
    variants = _parse_variants(raw)
    if not variants:
        raise RuntimeError("El model no ha retornat variants vàlides")
    return variants


def _parse_variants(raw: str) -> List[Dict[str, str]]:
    cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start:end + 1] if (start != -1 and end > start) else cleaned)
    except Exception:  # noqa: BLE001
        return []
    items = data.get("variants") if isinstance(data, dict) else None
    out: List[Dict[str, str]] = []
    for v in items if isinstance(items, list) else []:
        if not isinstance(v, dict):
            continue
        text = str(v.get("text") or "").strip()
        if not text:
            continue
        out.append({"label": str(v.get("label") or "").strip() or "Variant", "text": text})
    return out[:len(VARIANT_LABELS)]


# ---------------------------------------------------------------------------
# Level 2 — dictation with intent reconstruction
# ---------------------------------------------------------------------------

def correct_dictation(sug: Dict[str, Any], transcript: str,
                      language: str = "català") -> Dict[str, Any]:
    """Reconstructs what the user MEANT from a noisy ASR transcript.

    The corrector is context-first: it gets the suggestion being edited plus
    the personal glossary of past confirmed corrections, and must return the
    intended text — not a phonetic cleanup. Degrades gracefully: with no AI
    provider it returns the raw transcript flagged ``corrected: False`` so the
    user still sees something actionable.
    """
    transcript = " ".join(str(transcript or "").split()).strip()
    if not transcript:
        return {"transcript": "", "proposed": "", "corrected": False}

    glossary = load_glossary()
    glossary_block = ""
    if glossary:
        pairs = "\n".join(f'- si sents «{p["heard"]}» sol voler dir «{p["meant"]}»'
                          for p in glossary[-30:])
        glossary_block = f"""
GLOSSARI PERSONAL (correccions que l'usuari ha confirmat abans; el seu patró de parla):
{pairs}
"""
    prompt = f"""L'usuari té disàrtria: la transcripció automàtica del seu dictat és SOROLLOSA
i la seva pronúncia varia. La teva feina NO és netejar fonemes sinó reconstruir LA INTENCIÓ:
què volia dir, en {language}, com a edició o afegit a l'esborrany d'una nota permanent.
Recolza't en el context (la pregunta, l'esborrany, les notes) per resoldre ambigüitats.
{glossary_block}
CONTEXT DE LA NOTA QUE S'ESTÀ EDITANT:
{_suggestion_context(sug)}

TRANSCRIPCIÓ EN BRUT DEL DICTAT:
«{transcript}»

Retorna NOMÉS un JSON: {{"proposed": "el text que probablement volia dir, llest per inserir"}}"""
    try:
        from backend.agent.factory import generate_text

        raw, _model = generate_text(prompt, timeout=60)
        cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
        start, end = cleaned.find("{"), cleaned.rfind("}")
        data = json.loads(cleaned[start:end + 1] if (start != -1 and end > start) else cleaned)
        proposed = " ".join(str(data.get("proposed") or "").split()).strip()
        if proposed:
            return {"transcript": transcript, "proposed": proposed, "corrected": True}
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki_assist: dictation correction degraded to raw: %s", exc)
    return {"transcript": transcript, "proposed": transcript, "corrected": False}
