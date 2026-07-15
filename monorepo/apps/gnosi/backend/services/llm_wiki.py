"""LLM Wiki (Cervell) ingest engine.

Implements the "Ingest" operation of Karpathy's LLM Wiki pattern adapted to
Gnosi (directive `llm_wiki_cervell.md`): processing a row of the references
table (Recursos) reads its source content, asks the LLM to plan which Cervell
(knowledge) pages to create/update, and applies that plan deterministically —
each generated note carries ``note_type: lectura`` and links back to the source
resource (relation + NotebookLM-style anchored citations).

Design notes:
  * **Background job, single-flight per resource.** An ingest touches many pages
    and calls an LLM, so it runs in a daemon thread; the frontend polls status.
    Module-level dict keyed by resource page id (GIL-atomic; local single-user).
  * **LLM plans, code writes.** The model returns a JSON plan; the writing goes
    through `save_page_md` (frontmatter/sidecar split, OneDrive-safe names,
    wikilink decoration), never raw file writes.
  * **Only once.** The caller (action_rules guard + sidecar marker) enforces that
    a resource is processed a single time; re-processing is an explicit,
    lint-driven action (F3), never silent.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

# Phases a resource ingest goes through (for the progress UI).
PHASE_IDLE = "idle"
PHASE_READING = "reading"      # fetching + extracting the source content
PHASE_PLANNING = "planning"    # LLM deciding which pages to touch
PHASE_WRITING = "writing"      # applying the plan to the vault
PHASE_DONE = "done"
PHASE_ERROR = "error"

# Progress of ongoing ingests, keyed by the resource (Recursos row) page id.
# Reads/writes are atomic under the GIL; local single-user assumption, same as
# the Notion clone (`notion_routes._CLONE_PROGRESS`). Not persisted across
# restarts — an interrupted ingest is simply re-runnable (the sidecar marker is
# only written on success).
_INGEST_JOBS: Dict[str, Dict[str, Any]] = {}
_INGEST_LOCK = threading.Lock()

# Cap on the source text handed to the LLM. Long PDFs/articles are truncated;
# the ingest logs when it happens so coverage is never silently bounded.
_MAX_SOURCE_CHARS = 24000


def _new_job_state(page_id: str) -> Dict[str, Any]:
    return {
        "page_id": page_id,
        "running": True,
        "phase": PHASE_READING,
        "pages_touched": 0,
        "created": [],
        "updated": [],
        "model": None,
        "error": None,
        "started_at": time.time(),
        "finished_at": None,
    }


def get_job_status(page_id: str) -> Dict[str, Any]:
    """Non-blocking snapshot of a resource's ingest job (for polling)."""
    with _INGEST_LOCK:
        st = _INGEST_JOBS.get(page_id)
        return dict(st) if st else {"page_id": page_id, "running": False, "phase": PHASE_IDLE}


def _update_job(page_id: str, **fields: Any) -> None:
    with _INGEST_LOCK:
        st = _INGEST_JOBS.get(page_id)
        if st is not None:
            st.update(fields)


def is_running(page_id: str) -> bool:
    with _INGEST_LOCK:
        st = _INGEST_JOBS.get(page_id)
        return bool(st and st.get("running"))


# ---------------------------------------------------------------------------
# Source reading
# ---------------------------------------------------------------------------

def read_source(metadata: dict, body: str, vault_root) -> tuple[str, str]:
    """Extracts the readable content of a Recursos row.

    Priority: attached PDF (``files`` property) → URL (``URL`` property) →
    the row's own markdown body. Returns ``(text, source_kind)`` where
    ``source_kind`` ∈ {``pdf``, ``url``, ``body``, ``empty``}. Never raises:
    a failed fetch degrades to the next source so the ingest can still run on
    whatever content is available.
    """
    from pathlib import Path

    # 1) Attached PDF(s) in the `files` property. Values are vault-relative
    #    paths (Assets/...). Containment-checked like `read_pdf` — the path may
    #    ultimately derive from imported content.
    pdf_text = _read_attached_pdf(metadata, Path(vault_root))
    if pdf_text:
        return pdf_text[:_MAX_SOURCE_CHARS], "pdf"

    # 2) URL — fetch + readability extract (trafilatura, hard 8s timeout).
    url = _first_value(metadata, ("URL", "url"))
    if url and str(url).strip().lower().startswith(("http://", "https://")):
        try:
            from backend.services.article_extractor import extract_full_content

            extracted = extract_full_content(str(url).strip())
            if extracted and extracted.strip():
                return extracted[:_MAX_SOURCE_CHARS], "url"
        except Exception as exc:  # noqa: BLE001
            logger.warning("llm_wiki: URL extract failed for %s: %s", url, exc)

    # 3) Fallback: the resource row's own body.
    if body and body.strip():
        return body[:_MAX_SOURCE_CHARS], "body"
    return "", "empty"


def _read_attached_pdf(metadata: dict, vault_root) -> Optional[str]:
    """Reads the first attached PDF in the `files` property, if any.

    Containment: the resolved path must fall inside the active vault (same guard
    as `vault_tools.read_pdf`) — attachments can come from untrusted imports.
    """
    from pathlib import Path

    raw = _first_value(metadata, ("files", "Files", "Fitxers"))
    candidates: List[str] = []
    if isinstance(raw, list):
        candidates = [str(v) for v in raw if v]
    elif isinstance(raw, str) and raw.strip():
        candidates = [raw.strip()]

    root = Path(vault_root).resolve()
    for cand in candidates:
        # Attachment values may be `[[...]]`-decorated or plain relative paths.
        rel = cand.strip().strip("[]").split("|")[0].strip()
        if not rel.lower().endswith(".pdf"):
            continue
        p = Path(rel)
        target = (p if p.is_absolute() else (root / rel)).resolve()
        if target != root and root not in target.parents:
            logger.warning("llm_wiki: skipping out-of-vault attachment %s", cand)
            continue
        if not target.exists():
            continue
        try:
            from pypdf import PdfReader

            reader = PdfReader(str(target))
            text = "\n".join((pg.extract_text() or "") for pg in reader.pages)
            if text.strip():
                return text
        except Exception as exc:  # noqa: BLE001
            logger.warning("llm_wiki: PDF read failed for %s: %s", target, exc)
    return None


def _first_value(metadata: dict, keys: tuple[str, ...]) -> Any:
    for k in keys:
        v = (metadata or {}).get(k)
        if v not in (None, "", [], {}):
            return v
    return None


# ---------------------------------------------------------------------------
# LLM planning — the model returns a JSON plan; code applies it deterministically
# ---------------------------------------------------------------------------

# Visible system column added to the references (Recursos) table when the
# feature is on: holds the ingest date and is the "only once" guard + the
# feature signal the frontend derives the button from (mirrors the Drupal/XXSS
# system columns).
PROCESSED_COLUMN = "Processat pel Cervell"

NOTE_TYPES = ("entitat", "concepte", "resum", "síntesi")

# note_type stamped on every generated note (directive: reading notes → kind=reading).
GENERATED_NOTE_TYPE = "lectura"


def _fonts_ids(meta: dict) -> List[str]:
    """Resource ids referenced by a note's `Fonts` relation (`[[Title|id]]`)."""
    raw = meta.get("Fonts")
    vals = raw if isinstance(raw, list) else ([raw] if raw else [])
    out: List[str] = []
    for v in vals:
        s = str(v or "").strip().strip("[]")
        if "|" in s:
            out.append(s.rsplit("|", 1)[1].strip())
    return out


def _load_brain_index(brain_table_id: str, source_page_id: str = "") -> List[Dict[str, Any]]:
    """Compact index of the existing Cervell pages (bounded context packet).

    Returns ``[{id, title, type, same_source}]`` — never full bodies. A reading
    note belongs to EXACTLY ONE resource, so `same_source` tells the planner
    which notes it may update (this source's) vs. only wikilink (the rest).
    """
    from backend.api.vault_routes import _get_pages_for_table

    out: List[Dict[str, Any]] = []
    try:
        for p in _get_pages_for_table(brain_table_id) or []:
            meta = getattr(p, "metadata", None) or {}
            if meta.get("is_template"):
                continue
            out.append({
                "id": str(getattr(p, "id", "") or meta.get("id") or ""),
                "title": str(getattr(p, "title", "") or meta.get("title") or ""),
                "type": str(meta.get("Tipus") or meta.get("note_type") or ""),
                "same_source": bool(source_page_id) and source_page_id in _fonts_ids(meta),
            })
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki: could not load brain index: %s", exc)
    return out[:200]


def _build_prompt(source_text: str, source_title: str,
                  brain_index: List[Dict[str, str]], language: str) -> str:
    """Builds the ingest prompt: source content + the existing wiki index +
    strict JSON output contract."""
    index_lines = "\n".join(
        f"- {e['title']} ({e['type']}){' [d’AQUESTA font]' if e.get('same_source') else ''}"
        for e in brain_index if e["title"]
    ) or "(el Cervell encara és buit)"
    return f"""Ets el mantenidor d'un wiki de coneixement personal (un «Cervell» estil Karpathy).
A partir d'una FONT, has de crear NOTES DE LECTURA: cada nota pertany EXCLUSIVAMENT a
aquesta font (Zettelkasten). Extreu entitats, conceptes, un resum i síntesis. Regles:
- action "update" NOMÉS per a notes marcades [d'AQUESTA font] a l'índex (re-lectura).
- Les notes d'altres fonts NO es toquen: si una idea hi està relacionada, crea la TEVA
  nota de lectura i enllaça-la amb [[wikilink]] a l'existent.

Escriu tot el contingut en {language}. Cada nota ha d'anar enllaçada a d'altres amb wikilinks
[[Títol]] quan sigui rellevant. Per cada afirmació important, inclou una CITA amb el fragment
textual verbatim de la font i un localitzador (pàgina, secció o marcador) si el pots inferir.

IMPORTANT: llista les notes en l'ORDRE D'APARICIÓ de cada idea dins la font (no per
importància): la primera idea que apareix, primera de la llista. Un mateix capítol pot
contenir diverses idees; separa-les com a notes diferents mantenint-ne l'ordre.

FONT: «{source_title}»
---
{source_text}
---

ÍNDEX ACTUAL DEL CERVELL (títol i tipus; enriqueix els existents en comptes de duplicar):
{index_lines}

Retorna NOMÉS un objecte JSON vàlid amb aquesta forma exacta (sense text fora del JSON):
{{
  "summary": "resum d'un paràgraf de la font",
  "notes": [
    {{
      "title": "Títol de la nota",
      "type": "entitat|concepte|resum|síntesi",
      "action": "create|update",
      "body_md": "cos en markdown amb [[wikilinks]] a altres notes",
      "tags": ["etiqueta1", "etiqueta2"],
      "citations": [
        {{"quote": "fragment textual verbatim", "locator": "p. 12 / secció X / (buit si no aplica)"}}
      ]
    }}
  ]
}}"""


def _parse_plan(text: str) -> Dict[str, Any]:
    """Tolerant JSON extraction from the LLM output. Returns a dict with at least
    ``notes`` (possibly empty). Never raises."""
    import json
    import re

    if not text:
        return {"summary": "", "notes": []}
    # Strip ```json fences if present, then grab the outermost { ... }.
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    candidate = cleaned[start:end + 1] if (start != -1 and end > start) else cleaned
    try:
        data = json.loads(candidate)
    except Exception:  # noqa: BLE001
        logger.warning("llm_wiki: could not parse plan JSON")
        return {"summary": "", "notes": []}
    if not isinstance(data, dict):
        return {"summary": "", "notes": []}
    notes = data.get("notes")
    data["notes"] = [n for n in notes if isinstance(n, dict) and n.get("title")] if isinstance(notes, list) else []
    return data


def _today() -> str:
    import datetime
    return datetime.date.today().isoformat()


def _parse_page(locator: str) -> Optional[int]:
    """Extracts a 1-based page number from a locator string ("p. 12", "pàg 3",
    "page 7", or a bare "12"). Returns None if none found."""
    import re

    if not locator:
        return None
    m = re.search(r"(?:p{1,2}\.?|p[àa]g\.?|page|pl?\.?)\s*(\d{1,5})", locator, re.IGNORECASE)
    if not m:
        m = re.search(r"\b(\d{1,5})\b", locator)
    if m:
        try:
            n = int(m.group(1))
            return n if n > 0 else None
        except ValueError:
            return None
    return None


def _render_citations(citations: Any, source_title: str, source_id: str) -> str:
    """Renders a note's citations as a markdown block linking back to the source.

    NotebookLM-style: each cite shows the verbatim quote and, when a page can be
    parsed from the locator, a `gnosi-cite:` deep link that opens the source
    document at that exact page (handled by VaultMarkdown → the Zotero reader).
    Always keeps a `[[Font|id]]` wikilink to the resource as a fallback.
    """
    if not isinstance(citations, list) or not citations:
        return ""
    src_link = f"[[{source_title}|{source_id}]]"
    lines = ["", "### Cites", ""]
    for c in citations:
        if not isinstance(c, dict):
            continue
        quote = str(c.get("quote") or "").strip()
        locator = str(c.get("locator") or "").strip()
        if not quote:
            continue
        page = _parse_page(locator)
        if page:
            jump = f"[p. {page}](gnosi-cite:?res={source_id}&page={page})"
            tail = f" — {jump} · {src_link}"
        elif locator:
            tail = f" — {locator} · {src_link}"
        else:
            tail = f" — {src_link}"
        lines.append(f"> {quote}{tail}")
        lines.append("")
    return "\n".join(lines) if len(lines) > 3 else ""


def _base_note_metadata(note: dict, source_title: str, source_id: str,
                        position: Optional[int] = None) -> dict:
    """Frontmatter for a generated Cervell note (before id/table are set).

    ``position`` is the 1-based order of appearance of the idea within the
    source (the plan lists notes in appearance order): sorting by it, filtered
    by the source, reads the resource sequentially — finer than a chapter,
    since one chapter can yield several ideas.
    """
    ntype = str(note.get("type") or "").strip().lower()
    if ntype not in NOTE_TYPES:
        ntype = "concepte"
    tags = note.get("tags")
    tags = [str(t).strip() for t in tags if str(t).strip()] if isinstance(tags, list) else []
    meta = {
        "title": str(note.get("title")).strip(),
        "note_type": GENERATED_NOTE_TYPE,
        "Tipus": ntype,
        "Estat de verificació": "provisional",
        "Última revisió": _today(),
        "Tags": tags,
        # Relation → the source resource, stored in the on-disk `[[Title|id]]`
        # format (save_page_md leaves already-decorated values intact).
        "Fonts": [f"[[{source_title}|{source_id}]]"],
    }
    if position is not None:
        meta["Posició"] = position
    return meta


def _apply_plan(plan: dict, source_page_id: str, source_title: str,
                brain_table_id: str) -> Dict[str, List[str]]:
    """Applies the plan: creates new Cervell notes and enriches existing ones.

    Writing goes through `save_page_md` (frontmatter/sidecar split, relation
    wikilink decoration, OneDrive-safe names). Returns ``{created, updated}``
    lists of note titles.
    """
    import uuid as _uuid

    from backend.api.vault_routes import (
        _get_unique_filepath, _resolve_table_folder_from_metadata,
        find_page_path, parse_frontmatter, register_page_in_index, save_page_md,
    )

    brain_dir = _resolve_table_folder_from_metadata({"table_id": brain_table_id})
    if not brain_dir:
        raise RuntimeError("No s'ha pogut resoldre la carpeta de la taula Cervell")
    brain_dir.mkdir(parents=True, exist_ok=True)

    # title(lower) → {id, same_source}, for the create-vs-update decision. The
    # prompt already restricts "update" to this source's notes, but the model is
    # untrusted: the CODE enforces it too (a reading note belongs to exactly one
    # resource — Zettelkasten — so notes from other sources are never touched).
    existing = {
        e["title"].strip().lower(): {"id": e["id"], "same_source": bool(e.get("same_source"))}
        for e in _load_brain_index(brain_table_id, source_page_id) if e["title"]
    }

    created: List[str] = []
    created_ids: List[str] = []
    updated: List[str] = []

    # `position` = 1-based appearance index in the plan (the prompt requires the
    # plan to follow the source's order). Updates keep the Posició of the source
    # that created them (a note enriched by a second resource is ordered within
    # its ORIGINAL source; per-source edge positions would need relation
    # attributes, which tables don't have — documented in the directive).
    for position, note in enumerate(plan.get("notes", []), start=1):
        title = str(note.get("title")).strip()
        if not title:
            continue
        body = str(note.get("body_md") or "").strip()
        cites = _render_citations(note.get("citations"), source_title, source_page_id)
        prior = existing.get(title.lower())
        # HARD GUARD: only this source's own notes can be updated (a re-read).
        # An "update" aimed at another source's note falls through to create —
        # `_get_unique_filepath` disambiguates the title collision — and the
        # two notes stay linkable via wikilinks / a future permanent note.
        want_update = (
            str(note.get("action") or "").lower() == "update"
            and prior is not None and prior["same_source"]
        )

        try:
            if want_update:
                path = find_page_path(prior["id"])
                if not path or not path.exists():
                    want_update = False
                else:
                    raw = path.read_text(encoding="utf-8")
                    meta, old_body = parse_frontmatter(raw, path)
                    # Re-read of the SAME source: refresh the review date and
                    # tags, append the new pass. Fonts stays untouched — it is
                    # fixed to this note's single resource.
                    meta["Última revisió"] = _today()
                    tags = note.get("tags") if isinstance(note.get("tags"), list) else []
                    merged_tags = list(dict.fromkeys(
                        [str(t) for t in (meta.get("Tags") or []) if t] + [str(t) for t in tags if t]
                    ))
                    if merged_tags:
                        meta["Tags"] = merged_tags
                    section = f"\n\n## Relectura ({_today()})\n\n{body}\n{cites}".rstrip() + "\n"
                    save_page_md(path, meta, (old_body.rstrip() + section))
                    register_page_in_index(path)
                    updated.append(title)
                    continue

            # create
            meta = _base_note_metadata(note, source_title, source_page_id, position)
            meta["id"] = str(_uuid.uuid4())
            meta["table_id"] = brain_table_id
            full_body = (body + ("\n" + cites if cites else "")).strip() + "\n"
            path = _get_unique_filepath(brain_dir, title, ".md")
            save_page_md(path, meta, full_body)
            register_page_in_index(path)
            created.append(title)
            created_ids.append(meta["id"])
            existing[title.lower()] = {"id": meta["id"], "same_source": True}
        except Exception as exc:  # noqa: BLE001
            logger.warning("llm_wiki: failed to apply note '%s': %s", title, exc)

    return {"created": created, "created_ids": created_ids, "updated": updated}


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def process_resource(source_page_id: str, source_title: str, metadata: dict,
                     body: str, brain_table_id: str, vault_root,
                     language: str = "català") -> Dict[str, Any]:
    """Runs a full ingest of one resource (blocking; call from a worker thread).

    Reads the source, asks the LLM for a plan, applies it, and returns a report.
    Updates the module job-status dict as it progresses. Raises on hard failure
    (no AI provider, empty source) so the caller records the error.
    """
    _update_job(source_page_id, phase=PHASE_READING)
    text, kind = read_source(metadata, body, vault_root)
    if not text.strip():
        raise RuntimeError("La font no té contingut llegible (ni PDF, ni URL, ni cos)")
    logger.info("llm_wiki: source '%s' read as %s (%d chars)", source_title, kind, len(text))

    _update_job(source_page_id, phase=PHASE_PLANNING)
    from backend.agent.factory import generate_text

    brain_index = _load_brain_index(brain_table_id, source_page_id)
    prompt = _build_prompt(text, source_title, brain_index, language)
    # Ingest is quality-sensitive and the source can be long → generous timeout.
    raw, model = generate_text(prompt, user_message=source_title, timeout=180)
    _update_job(source_page_id, model=model)
    plan = _parse_plan(raw)
    if not plan.get("notes"):
        raise RuntimeError("El model no ha proposat cap nota per a aquesta font")

    _update_job(source_page_id, phase=PHASE_WRITING)
    result = _apply_plan(plan, source_page_id, source_title, brain_table_id)

    report = {
        "source_kind": kind,
        "created": result["created"],
        "created_ids": result.get("created_ids", []),
        "updated": result["updated"],
        "pages_touched": len(result["created"]) + len(result["updated"]),
        "model": model,
        "summary": str(plan.get("summary") or ""),
    }
    return report


def start_ingest(source_page_id: str, source_title: str, metadata: dict, body: str,
                 brain_table_id: str, vault_root, language: str = "català") -> None:
    """Launches a resource ingest in a daemon thread (single-flight per resource).

    Captures the active-vault contextvar and re-sets it inside the thread, since
    contextvars don't propagate to threads started with `threading.Thread`.
    """
    from backend.services import context_vars as cv

    active_vault = cv.get_active_vault_path()

    with _INGEST_LOCK:
        _INGEST_JOBS[source_page_id] = _new_job_state(source_page_id)

    def _worker() -> None:
        token = None
        try:
            if active_vault is not None:
                token = cv.active_vault_path.set(active_vault)
            report = process_resource(
                source_page_id, source_title, metadata, body,
                brain_table_id, vault_root, language,
            )
            _update_job(
                source_page_id, running=False, phase=PHASE_DONE,
                pages_touched=report["pages_touched"], created=report["created"],
                updated=report["updated"], finished_at=time.time(),
            )
            _on_ingest_success(source_page_id, report)
            # Zettelkasten layer 3: propose permanent notes connecting this
            # ingest's fresh reading notes with other sources'. Best-effort —
            # a failed pass never taints the finished ingest.
            try:
                from backend.services import llm_wiki_suggestions

                queued = llm_wiki_suggestions.generate_suggestions(
                    brain_table_id, language, focus_ids=report.get("created_ids") or None,
                )
                if queued:
                    logger.info("llm_wiki: %d permanent-note suggestions queued", queued)
            except Exception as exc:  # noqa: BLE001
                logger.warning("llm_wiki: post-ingest suggestion pass failed: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.error("llm_wiki: ingest failed for %s: %s", source_page_id, exc)
            _update_job(source_page_id, running=False, phase=PHASE_ERROR,
                        error=str(exc), finished_at=time.time())
        finally:
            if token is not None:
                cv.active_vault_path.reset(token)

    threading.Thread(target=_worker, name=f"llm-wiki-{source_page_id[:8]}", daemon=True).start()


def _on_ingest_success(source_page_id: str, report: Dict[str, Any]) -> None:
    """Post-ingest side effects: mark the resource processed (visible date column)
    and notify data plugins via the events bus."""
    try:
        from backend.api.vault_routes import mark_resource_processed

        mark_resource_processed(source_page_id, _today())
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki: could not mark resource processed: %s", exc)
    try:
        from backend.services import plugin_events

        plugin_events.emit("llm-wiki:ingested", {
            "page_id": source_page_id,
            "pages_touched": report.get("pages_touched", 0),
            "created": len(report.get("created", [])),
            "updated": len(report.get("updated", [])),
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki: could not emit event: %s", exc)
