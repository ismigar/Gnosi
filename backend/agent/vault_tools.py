"""Knowledge tool belt: gives the agent HANDS on the vault (not just search).

Follows the `system_tools.py` pattern: `@tool` functions with lazy imports. The I/O
tools operate DIRECTLY on the vault + index (like the `/import` handler), via
`get_active_vault_path()` + `register_page_in_index()` — no HTTP-to-self or auth.

The knowledge SUBSTANCE (building a Cornell note, ranking connections, modeling the
frontmatter) is in PURE functions at the top, testable without a backend (cf. directive
`vault_knowledge_agents.md`).

⚠️ QA safety: autosave/collab persists over WebSocket; to test, use disposable
pages or a vault in /tmp, NEVER real notes (cf. memories vault_editor_qa_safety and
collab_ws_bypasses_fetch_block).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

try:
    from langchain_core.tools import tool
except Exception:  # allows importing the pure helpers without langchain (for tests)
    def tool(fn=None, **_kw):
        return fn if fn else (lambda f: f)


# ===========================================================================
# PURE HELPERS (no backend) — the knowledge "intelligence"
# ===========================================================================
def build_page_frontmatter(title: str, metadata: Optional[Dict[str, Any]] = None) -> str:
    """Models the YAML frontmatter of a new page (title + metadata + id if needed)."""
    import yaml
    import uuid
    meta = dict(metadata or {})
    meta.setdefault("title", title)
    if not meta.get("id"):
        meta["id"] = str(uuid.uuid4())
    return yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()


def build_cornell_note(title: str, *, cues: List[str], notes: str, summary: str) -> str:
    """Builds a Cornell-method study note in Markdown (pure).

    Structure: Notes (body) | Cues/questions (left column as a list) | Summary (footer).
    
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
    """Ranks {title,id,content} candidates by vocabulary overlap with the page (pure).

    Cheap heuristic (Jaccard of words ≥4 letters) for `propose_links`. The final
    decision is made by the LLM; this only prioritizes what we show it.
    
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
# I/O TOOLS (operate on the active context's vault)
# ===========================================================================
def _resolve_page_path(page_id_or_title: str):
    """Resolves id or title → Path of the .md within the active vault (via page index)."""
    from backend.services.context_vars import get_active_vault_path
    vault = get_active_vault_path()
    if not vault:
        return None
    needle = str(page_id_or_title).strip()
    # 1) by id in the frontmatter / 2) by filename (title)
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
    """Reads the content and metadata of a Vault page by id or title."""
    p = _resolve_page_path(page_id_or_title)
    if not p:
        return f"No s'ha trobat cap pàgina per '{page_id_or_title}'."
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        return f"Error llegint la pàgina: {e}"


@tool
def read_pdf(path: str, max_chars: int = 12000) -> str:
    """Extracts text from a PDF (from Assets/Library). Materializes it if online-only."""
    from pathlib import Path
    from backend.services.context_vars import get_active_vault_path
    vault = get_active_vault_path()
    if not vault:
        return "Error: no hi ha cap vault actiu."
    vault_root = Path(vault).resolve()
    # `path` comes from the LLM and may be influenced by UNTRUSTED content that
    # the agent reads (pages, emails, other PDFs) → prompt-injectable.
    # MANDATORY containment (same pattern as `_safe_directive_path`): resolve and
    # checks that the file falls INSIDE the active vault. Without this, a path
    # absolute (`/Users/…/extracte.pdf`) or a `../` would read any PDF in the
    # system and would return its text into the conversation (exfiltration).
    raw = Path(path)
    target = (raw if raw.is_absolute() else (vault_root / path)).resolve()
    if target != vault_root and vault_root not in target.parents:
        return f"Accés denegat: el PDF ha d'estar dins del vault actiu ({path})."
    if not target.exists():
        return f"No existeix el PDF: {target}"
    try:
        from pypdf import PdfReader  # dep present in the backend
        reader = PdfReader(str(target))
        text = "\n".join((pg.extract_text() or "") for pg in reader.pages)
        return text[:max_chars] if text.strip() else "(PDF sense text extraïble — potser escanejat)"
    except Exception as e:
        return f"Error llegint el PDF: {e}"


@tool
def create_page(title: str, content: str = "", folder: str = "Importades",
                metadata: Optional[Dict[str, Any]] = None) -> str:
    """Creates a new page in the Vault (folder `folder`) and registers it in the index. Returns the id."""
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
    # `folder` comes from the LLM (prompt-injectable). The sanitization strips dots but
    # KEEPS the slashes: a "../../etc" becomes "///etc", and `vault / "///etc"`
    # becomes ABSOLUTE (/etc) by discarding the vault prefix → the .md gets written
    # OUTSIDE the vault. Containment: if the resolved destination escapes the vault, it falls back to the
    # default folder (same pattern as read_pdf/_safe_directive_path).
    vault_root = vault.resolve()
    target_dir = (vault / folder_safe).resolve()
    if target_dir != vault_root and vault_root not in target_dir.parents:
        target_dir = vault_root / "Importades"
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
    """Proposes `[[...]]` connections for a page: searches for related ones and ranks them."""
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
    """Summarizes a page or PDF into a Cornell note and saves it as a new Vault page."""
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
    """Tolerant: extracts notes/cues/summary from a JSON (or degrades to plain text)."""
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


# Exportable list for registering with the "brain" agent (factory.py)
VAULT_KNOWLEDGE_TOOLS = [
    read_page, read_pdf, create_page, propose_links, summarize_to_cornell,
]
