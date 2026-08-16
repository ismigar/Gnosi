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
import threading
import time
import unicodedata
from typing import Any, Dict, List, Optional

from backend.utils.safe_io import sanitize_rel_folder, sanitize_vault_title

MAX_PAGE_READ_CHARS = 16_000
MAX_PDF_READ_CHARS = 20_000
DEFAULT_PDF_READ_CHARS = 12_000
_WIKI_CACHE: dict[tuple[str, str, int], tuple[float, str]] = {}
_WIKI_CACHE_LOCK = threading.RLock()
_WIKI_CACHE_TTL_SECONDS = 30.0


def clear_wiki_search_cache(brain_id: str | None = None) -> None:
    """Invalidate rendered query results after a Brain index rebuild."""
    with _WIKI_CACHE_LOCK:
        if brain_id is None:
            _WIKI_CACHE.clear()
            return
        prefix = str(brain_id)
        for key in list(_WIKI_CACHE):
            if key[0] == prefix:
                _WIKI_CACHE.pop(key, None)


def _read_text_prefix(path, max_chars: int) -> tuple[str, bool]:
    """Read at most one character beyond a server-owned text ceiling."""
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        text = handle.read(max_chars + 1)
    return text[:max_chars], len(text) > max_chars

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


def _expanded_search_terms(query: str) -> set[str]:
    """Small multilingual expansion for intent, not a generative rewrite."""
    terms = _tokenize(query)
    synonyms = {
        "bibliografia": {"font", "fonts", "referencia", "referencies", "article"},
        "bibliografica": {"bibliografia", "font", "fonts", "referencia", "referencies"},
        "bibliografic": {"bibliografia", "font", "fonts", "referencia", "referencies"},
        "bibliograficas": {"bibliografia", "font", "fonts", "referencia", "referencies"},
        "bibliogràfiques": {"font", "fonts", "referencia", "referencies"},
        "fuentes": {"font", "fonts", "referencia", "referencies"},
        "fontes": {"font", "fonts", "referencia", "referencies"},
        "coaching": {"acompanyament", "lideratge", "formacio"},
        "sources": {"font", "fonts", "reference", "references"},
        "search": {"cerca", "recuperacio", "find", "query"},
        "cerca": {"search", "recuperacio", "find", "query"},
        "encontrar": {"cerca", "search", "find", "recuperacio"},
        "qualitat": {"calidad", "quality"},
        "calidad": {"qualitat", "quality"},
    }
    expanded = set(terms)
    for term in list(terms):
        plain = "".join(
            character
            for character in unicodedata.normalize("NFKD", term)
            if not unicodedata.combining(character)
        )
        expanded.add(plain)
        for suffix in ("ments", "ment", "aciones", "ación", "es", "s"):
            if len(plain) > len(suffix) + 3 and plain.endswith(suffix):
                expanded.add(plain[: -len(suffix)])
    for term in list(expanded):
        expanded.update(synonyms.get(term, ()))
    return expanded


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
    from backend.services.path_resolver import path_resolver
    indexed = path_resolver.find_path(needle, vault)
    if indexed:
        return indexed
    # Resolve titles over the shared cached file inventory.
    for p in path_resolver.list_all_files(vault):
        try:
            if p.stem.casefold() == needle.casefold():
                return p
            head, _truncated = _read_text_prefix(p, 2_000)
        except Exception:
            continue
        if re.search(rf'(^|\n)id:\s*["\']?{re.escape(needle)}["\']?\s*(\n|$)', head):
            return p
    return None


@tool
def read_page(page_id_or_title: str) -> str:
    """Reads a server-bounded prefix of a Vault page by id or title."""
    p = _resolve_page_path(page_id_or_title)
    if not p:
        return f"No page was found for '{page_id_or_title}'."
    try:
        bounded, truncated = _read_text_prefix(p, MAX_PAGE_READ_CHARS)
        if truncated:
            bounded += "\n\n[Page content truncated by Gnosi.]"
        return bounded
    except Exception as e:
        return f"Error reading the page: {e}"


@tool
def read_pdf(path: str, max_chars: int = DEFAULT_PDF_READ_CHARS) -> str:
    """Extracts text from a PDF (from Assets/Library). Materializes it if online-only."""
    from pathlib import Path
    from backend.services.context_vars import get_active_vault_path
    vault = get_active_vault_path()
    if not vault:
        return "Error: there is no active vault."
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
        return f"Access denied: the PDF must be inside the active vault ({path})."
    if not target.exists():
        return f"PDF does not exist: {target}"
    try:
        from pypdf import PdfReader  # dep present in the backend
        reader = PdfReader(str(target))
        requested_chars = max(1, min(int(max_chars or DEFAULT_PDF_READ_CHARS), MAX_PDF_READ_CHARS))
        chunks = []
        extracted = 0
        for page in reader.pages:
            if extracted >= requested_chars:
                break
            chunk = page.extract_text() or ""
            chunks.append(chunk[:requested_chars - extracted])
            extracted += len(chunks[-1])
        text = "\n".join(chunks)
        return text[:requested_chars] if text.strip() else "(PDF has no extractable text; it may be scanned)"
    except Exception as e:
        return f"Error reading the PDF: {e}"


@tool
def create_page(title: str, content: str = "", folder: str = "Imported",
                metadata: Optional[Dict[str, Any]] = None) -> str:
    """Creates a new page in the Vault (folder `folder`) and registers it in the index. Returns the id."""
    from pathlib import Path
    from backend.services.context_vars import get_active_vault_path
    from backend.api.vault_routes import register_page_in_index
    vault = get_active_vault_path()
    if not vault:
        return "Error: there is no active vault."
    fm_str = build_page_frontmatter(title, metadata)
    page_id = re.search(r'(^|\n)id:\s*["\']?([\w-]+)', fm_str)
    page_id = page_id.group(2) if page_id else ""
    safe = sanitize_vault_title(title)
    folder_safe = sanitize_rel_folder(folder, fallback="Imported")
    # `folder` comes from the LLM (prompt-injectable). `sanitize_rel_folder` already
    # drops `..`/empty segments, but keep the belt-and-braces containment check: if the
    # resolved destination escapes the vault, it falls back to the default folder
    # (same pattern as read_pdf/_safe_directive_path).
    vault_root = vault.resolve()
    target_dir = (vault / folder_safe).resolve()
    if target_dir != vault_root and vault_root not in target_dir.parents:
        target_dir = vault_root / "Imported"
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{safe}.md"
    try:
        from backend.agent.gnosi_tools import _page_lock
        from backend.utils.safe_io import safe_write_text
        with _page_lock(path):
            if path.exists():
                path = target_dir / f"{safe} {page_id[:8]}.md"
            safe_write_text(
                path,
                f"---\n{fm_str}\n---\n\n{content.strip()}\n",
            )
        register_page_in_index(path)
        return f"Page created: {path.name} (id: {page_id})"
    except Exception as e:
        return f"Error creating the page: {e}"


@tool
def propose_links(page_id_or_title: str, k: int = 8) -> str:
    """Proposes `[[...]]` connections for a page: searches for related ones and ranks them."""
    from .memory import vault_store
    page = read_page.func(page_id_or_title) if hasattr(read_page, "func") else read_page(page_id_or_title)
    if page.startswith("No page was found"):
        return page
    results = vault_store.search_vault(page[:1500], k=max(k * 2, 12)) or []
    candidates = [{"title": (r.get("metadata") or {}).get("source", "?"),
                   "content": r.get("content", "")} for r in results]
    ranked = rank_link_candidates(page, candidates, top_k=k)
    if not ranked:
        return "No clear connections were found for this page."
    lines = [f"Suggested connections for «{page_id_or_title}»:"]
    for c in ranked:
        lines.append(f"- [[{c['title']}]]  (affinity {c['score']})")
    return "\n".join(lines)


@tool
def summarize_to_cornell(source: str, title: str = "", folder: str = "Summaries") -> str:
    """Summarizes a page or PDF into a Cornell note and saves it as a new Vault page."""
    from .factory import generate_text
    is_pdf = str(source).lower().endswith(".pdf")
    raw = (read_pdf.func(source) if hasattr(read_pdf, "func") else read_pdf(source)) if is_pdf \
        else (read_page.func(source) if hasattr(read_page, "func") else read_page(source))
    if raw.startswith("No ") or raw.startswith("Error"):
        return raw
    prompt = (
        "You are a study assistant. From the following material, create a Cornell note "
        "in English with THREE clearly separated parts. Return ONLY JSON with the keys "
        "'notes' (structured body summary), 'cues' (a list of 4–7 key prompts or questions), "
        "and 'summary' (3–4 sentences). Material:\n\n" + raw[:8000]
    )
    text, _model = generate_text(prompt)
    notes, cues, summary = _parse_cornell_json(text)
    note_title = title or (f"Summary: {source}")
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
@tool
def query_wiki(query: str, k: int = 5) -> str:
    """Query the compiled Brain before consulting raw source material.

    Managed content indexes are ranked first, followed by matching reading and
    manual permanent notes from the rebuildable Brain-only search cache.
    Returned excerpts retain their provenance/citation links.
    """
    from backend.services import llm_wiki_config, llm_wiki_indices

    brain_id = llm_wiki_config.get_brain_table_id()
    if not brain_id:
        return ("No Brain table is assigned (Settings → Plugins → Brain). "
                "The knowledge wiki cannot be queried.")

    normalized_query = " ".join(str(query or "").casefold().split())
    base = _expanded_search_terms(normalized_query)
    if not base:
        return "The query is too short to search the Brain."

    cache_key = (str(brain_id), normalized_query, max(1, min(int(k or 5), 20)))
    with _WIKI_CACHE_LOCK:
        cached = _WIKI_CACHE.get(cache_key)
        if cached and time.monotonic() - cached[0] < _WIKI_CACHE_TTL_SECONDS:
            return cached[1] + "\n[Search metadata: mode=hybrid; cache_hit=true]"

    records = llm_wiki_indices.load_search_cache(brain_id)
    if not records:
        try:
            llm_wiki_indices.rebuild_search_cache(brain_id)
            records = llm_wiki_indices.load_search_cache(brain_id)
        except Exception:
            records = []
    query_vector = llm_wiki_indices.search_vector(query)
    scored: List[Dict[str, Any]] = []
    for record in records:
        title = str(record.get("title") or "")
        body = str(record.get("excerpt") or "")
        toks = _tokenize(f"{title} {body}")
        inter = len(base & toks)
        lexical_ratio = inter / max(1, len(base))
        vector_score = llm_wiki_indices.vector_similarity(
            record.get("vector") or [],
            query_vector,
        )
        if inter == 0 and vector_score < 0.08:
            continue
        role = str(record.get("managed_role") or "")
        index_boost = 3 if role in {"general-index", "dimension-index", "resource-index"} else 0
        normalized_title = " ".join(title.casefold().split())
        exact_title_boost = 4 if normalized_query and normalized_query in normalized_title else 0
        scored.append({
            "title": title,
            "type": str(record.get("note_type") or ""),
            "excerpt": body.strip()[:800],
            "source_table_id": str(record.get("source_table_id") or ""),
            "resource_id": str(record.get("resource_id") or ""),
            "role": role,
            "score": (lexical_ratio * 4) + exact_title_boost + index_boost + (vector_score * 2),
        })

    if not scored:
        return f"No Brain note related to «{query}» was found."
    scored.sort(key=lambda x: x["score"], reverse=True)

    out = [f"Relevant Brain notes for «{query}»:\n"]
    injection_count = 0
    for n in scored[:max(1, k)]:
        head = f"## {n['title']}" + (f" ({n['type']})" if n["type"] else "")
        out.append(head)
        if n["excerpt"]:
            from backend.agent.context_safety import sanitize_untrusted_context
            safe_excerpt, flags = sanitize_untrusted_context(n["excerpt"], max_chars=800)
            injection_count += len(flags)
            out.append(safe_excerpt)
        if n["resource_id"]:
            out.append(
                f"Provenance: resource {n['resource_id']}"
                + (f" · table {n['source_table_id']}" if n["source_table_id"] else "")
            )
        out.append("")
    out.append(
        "[Search metadata: mode=hybrid; cache_hit=false; "
        f"injection_flags={injection_count}]"
    )
    rendered = "\n".join(out)
    with _WIKI_CACHE_LOCK:
        _WIKI_CACHE[cache_key] = (time.monotonic(), rendered)
        if len(_WIKI_CACHE) > 128:
            oldest = min(_WIKI_CACHE, key=lambda key: _WIKI_CACHE[key][0])
            _WIKI_CACHE.pop(oldest, None)
    return rendered


VAULT_KNOWLEDGE_TOOLS = [
    read_page, read_pdf, create_page, propose_links, summarize_to_cornell, query_wiki,
]
