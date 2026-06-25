"""Cinturó d'eines de coneixement: dona a l'agent MANS sobre el vault (no només cerca).

Segueix el patró de `system_tools.py`: funcions `@tool` amb imports mandrosos. Les tools
d'I/O operen DIRECTE sobre el vault + índex (com el handler `/import`), via
`get_active_vault_path()` + `register_page_in_index()` — sense HTTP-to-self ni auth.

La SUBSTÀNCIA de coneixement (construir fitxa Cornell, rànquing de connexions, modelar el
frontmatter) està en funcions PURES al capdamunt, testejables sense backend (cf. directiva
`vault_knowledge_agents.md`).

⚠️ Seguretat QA: l'autosave/collab persisteix per WebSocket; per provar, fer servir pàgines
d'usar i llençar o un vault a /tmp, MAI notes reals (cf. memòries vault_editor_qa_safety i
collab_ws_bypasses_fetch_block).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

try:
    from langchain_core.tools import tool
except Exception:  # permet importar els helpers purs sense langchain (per a tests)
    def tool(fn=None, **_kw):
        return fn if fn else (lambda f: f)


# ===========================================================================
# HELPERS PURS (sense backend) — la "intel·ligència" de coneixement
# ===========================================================================
def build_page_frontmatter(title: str, metadata: Optional[Dict[str, Any]] = None) -> str:
    """Modela el frontmatter YAML d'una pàgina nova (title + metadata + id si cal)."""
    import yaml
    import uuid
    meta = dict(metadata or {})
    meta.setdefault("title", title)
    if not meta.get("id"):
        meta["id"] = str(uuid.uuid4())
    return yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()


def build_cornell_note(title: str, *, cues: List[str], notes: str, summary: str) -> str:
    """Construeix una fitxa d'estudi mètode Cornell en Markdown (pur).

    Estructura: Notes (cos) | Pistes/preguntes (columna esquerra com a llista) | Resum (peu).
    """
    cue_block = "\n".join(f"- {c.strip()}" for c in cues if c.strip()) or "_—_"
    return (
        f"# {title}\n\n"
        f"## 📝 Notes\n\n{notes.strip()}\n\n"
        f"## 🔑 Pistes / preguntes\n\n{cue_block}\n\n"
        f"## 🧭 Resum\n\n{summary.strip()}\n"
    )


def _tokenize(text: str) -> set:
    return set(re.findall(r"[\wàèéíòóúïüçñ]{4,}", (text or "").lower()))


def rank_link_candidates(page_text: str, candidates: List[Dict[str, Any]],
                         top_k: int = 8) -> List[Dict[str, Any]]:
    """Ordena candidates {title,id,content} per solapament de vocabulari amb la pàgina (pur).

    Heurística barata (Jaccard de paraules ≥4 lletres) per a `propose_links`. La decisió
    final la pren l'LLM; això només prioritza què li ensenyem.
    """
    base = _tokenize(page_text)
    if not base:
        return []
    scored = []
    for c in candidates:
        toks = _tokenize(f"{c.get('title','')} {c.get('content','')}")
        if not toks:
            continue
        inter = len(base & toks)
        if inter == 0:
            continue
        union = len(base | toks) or 1
        scored.append({**c, "score": round(inter / union, 4)})
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


# ===========================================================================
# TOOLS D'I/O (operen sobre el vault del context actiu)
# ===========================================================================
def _resolve_page_path(page_id_or_title: str):
    """Resol id o títol → Path del .md dins el vault actiu (via índex de pàgines)."""
    from backend.services.context_vars import get_active_vault_path
    vault = get_active_vault_path()
    if not vault:
        return None
    needle = str(page_id_or_title).strip()
    # 1) per id al frontmatter / 2) per nom de fitxer (títol)
    for p in vault.rglob("*.md"):
        try:
            head = p.read_text(encoding="utf-8")[:2000]
        except Exception:
            continue
        if re.search(rf'(^|\n)id:\s*["\']?{re.escape(needle)}["\']?\s*(\n|$)', head):
            return p
    cand = list(vault.rglob(f"{needle}.md"))
    return cand[0] if cand else None


@tool
def read_page(page_id_or_title: str) -> str:
    """Llegeix el contingut i metadata d'una pàgina del Vault per id o títol."""
    p = _resolve_page_path(page_id_or_title)
    if not p:
        return f"No s'ha trobat cap pàgina per '{page_id_or_title}'."
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        return f"Error llegint la pàgina: {e}"


@tool
def read_pdf(path: str, max_chars: int = 12000) -> str:
    """Extreu el text d'un PDF (d'Assets/Biblioteca). Materialitza si és online-only."""
    from pathlib import Path
    from backend.services.context_vars import get_active_vault_path
    target = Path(path)
    if not target.is_absolute():
        vault = get_active_vault_path()
        if vault:
            target = (vault / path)
    if not target.exists():
        return f"No existeix el PDF: {target}"
    try:
        from pypdf import PdfReader  # dep present al backend
        reader = PdfReader(str(target))
        text = "\n".join((pg.extract_text() or "") for pg in reader.pages)
        return text[:max_chars] if text.strip() else "(PDF sense text extraïble — potser escanejat)"
    except Exception as e:
        return f"Error llegint el PDF: {e}"


@tool
def create_page(title: str, content: str = "", folder: str = "Importades",
                metadata: Optional[Dict[str, Any]] = None) -> str:
    """Crea una pàgina nova al Vault (carpeta `folder`) i la registra a l'índex. Retorna l'id."""
    from pathlib import Path
    from backend.services.context_vars import get_active_vault_path
    from backend.api.vault_routes import register_page_in_index
    vault = get_active_vault_path()
    if not vault:
        return "Error: no hi ha cap vault actiu."
    fm_str = build_page_frontmatter(title, metadata)
    page_id = re.search(r'(^|\n)id:\s*["\']?([\w-]+)', fm_str)
    page_id = page_id.group(2) if page_id else ""
    safe = re.sub(r"[^\w\s\-.,()À-ÿ]", "", title).strip()[:120] or "Sense títol"
    folder_safe = re.sub(r"[^\w\s\-/À-ÿ]", "", folder).strip() or "Importades"
    target_dir = vault / folder_safe
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{safe}.md"
    if path.exists():
        path = target_dir / f"{safe} {page_id[:8]}.md"
    try:
        path.write_text(f"---\n{fm_str}\n---\n\n{content.strip()}\n", encoding="utf-8")
        register_page_in_index(path)
        return f"Pàgina creada: {path.name} (id: {page_id})"
    except Exception as e:
        return f"Error creant la pàgina: {e}"


@tool
def propose_links(page_id_or_title: str, k: int = 8) -> str:
    """Proposa connexions `[[...]]` per a una pàgina: cerca relacionades i les prioritza."""
    from .memory import vault_store
    page = read_page.func(page_id_or_title) if hasattr(read_page, "func") else read_page(page_id_or_title)
    if page.startswith("No s'ha trobat"):
        return page
    results = vault_store.search_vault(page[:1500], k=max(k * 2, 12)) or []
    candidates = [{"title": (r.get("metadata") or {}).get("source", "?"),
                   "content": r.get("content", "")} for r in results]
    ranked = rank_link_candidates(page, candidates, top_k=k)
    if not ranked:
        return "No he trobat connexions clares per a aquesta pàgina."
    lines = [f"Connexions proposades per a «{page_id_or_title}»:"]
    for c in ranked:
        lines.append(f"- [[{c['title']}]]  (afinitat {c['score']})")
    return "\n".join(lines)


@tool
def summarize_to_cornell(source: str, title: str = "", folder: str = "Resums") -> str:
    """Resumeix una pàgina o PDF en una fitxa Cornell i la desa com a pàgina nova del Vault."""
    from .factory import generate_text
    is_pdf = str(source).lower().endswith(".pdf")
    raw = (read_pdf.func(source) if hasattr(read_pdf, "func") else read_pdf(source)) if is_pdf \
        else (read_page.func(source) if hasattr(read_page, "func") else read_page(source))
    if raw.startswith("No ") or raw.startswith("Error"):
        return raw
    prompt = (
        "Ets un assistent d'estudi. A partir del següent material, genera una fitxa Cornell "
        "en català amb TRES parts ben diferenciades, retornant NOMÉS un JSON amb claus "
        "'notes' (resum estructurat del cos), 'cues' (llista de 4-7 pistes/preguntes clau) i "
        "'summary' (3-4 frases). Material:\n\n" + raw[:8000]
    )
    text, _model = generate_text(prompt)
    notes, cues, summary = _parse_cornell_json(text)
    note_title = title or (f"Resum: {source}")
    md = build_cornell_note(note_title, cues=cues, notes=notes, summary=summary)
    return (create_page.func(note_title, md, folder) if hasattr(create_page, "func")
            else create_page(note_title, md, folder))


def _parse_cornell_json(text: str):
    """Tolerant: extreu notes/cues/summary d'un JSON (o degrada a text pla)."""
    import json
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if m:
        try:
            d = json.loads(m.group(0))
            cues = d.get("cues") or []
            if isinstance(cues, str):
                cues = [c for c in re.split(r"[\n;]", cues) if c.strip()]
            return str(d.get("notes", "")).strip(), cues, str(d.get("summary", "")).strip()
        except Exception:
            pass
    return (text or "").strip(), [], ""


# Llista exportable per registrar a l'agent "brain" (factory.py)
VAULT_KNOWLEDGE_TOOLS = [
    read_page, read_pdf, create_page, propose_links, summarize_to_cornell,
]
