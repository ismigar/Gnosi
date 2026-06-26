"""Motor de diff Notion ↔ Vault (dry-run, no destructiu).

El vault de Gnosi es va sembrar des d'aquest Notion i CONSERVA els ids de Notion al
frontmatter (`id`) → l'aparellament és per id (exacte), amb títol com a fallback. El
contingut, però, ha pogut divergir (p.ex. traduït ES→CA, relacions editades): per això el
diff compara el COS normalitzat i les VISTES INCRUSTADES, no només l'existència.

Representacions diferents de vista incrustada:
- Vault: comentari HTML `<!-- gnosi-view:def {"view_id":"..."} -->` (resol a una vista del registry).
- Notion (REST): bloc `child_database`; (connector): `<database url=".../<id>" inline="true">`.

Funcions PURES → testejables sense xarxa ni backend.
"""
from __future__ import annotations

import difflib
import json
import re
from typing import Any, Dict, List, Optional

_VAULT_VIEW_RE = re.compile(r"<!--\s*gnosi-view:def\s+(\{.*?\})\s*-->")
_NOTION_INLINE_DB_RE = re.compile(r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"')
_HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.MULTILINE)


# ---------------------------------------------------------------------------
# Extracció de vistes incrustades
# ---------------------------------------------------------------------------
def extract_vault_views(markdown: str) -> List[str]:
    """view_ids de les tanques `<!-- gnosi-view:def {...} -->` del cos del vault."""
    out = []
    for m in _VAULT_VIEW_RE.finditer(markdown or ""):
        try:
            vid = json.loads(m.group(1)).get("view_id")
            if vid:
                out.append(vid)
        except Exception:
            pass
    return out


def extract_notion_inline_dbs(notion_md: str) -> List[str]:
    """ids (32-hex) de les BD incrustades `<database ... inline="true">` (forma connector)."""
    return _NOTION_INLINE_DB_RE.findall(notion_md or "")


def extract_notion_child_databases(blocks: List[Dict[str, Any]]) -> List[str]:
    """ids de `child_database` d'un arbre de blocs (forma REST). Recursiu via `_children`."""
    out: List[str] = []

    def walk(bl):
        for b in bl or []:
            if b.get("type") == "child_database":
                out.append(str(b.get("id", "")).replace("-", ""))
            walk(b.get("_children"))
    walk(blocks)
    return [x for x in out if x]


# ---------------------------------------------------------------------------
# Normalització del cos + similitud
# ---------------------------------------------------------------------------
def strip_frontmatter(md: str) -> str:
    if md.startswith("---"):
        end = md.find("\n---", 3)
        if end != -1:
            return md[end + 4:]
    return md


def normalize_body(md: str) -> str:
    """Treu frontmatter, vistes, tags i anotacions de color → text comparable."""
    md = strip_frontmatter(md or "")
    md = _VAULT_VIEW_RE.sub("", md)
    md = re.sub(r"<database[^>]*>.*?</database>", "", md, flags=re.DOTALL)
    md = re.sub(r"<database[^>]*/?>", "", md)
    md = re.sub(r"\{color=[^}]*\}", "", md)            # anotacions de color Notion
    md = re.sub(r"<mention-page[^>]*>(.*?)</mention-page>", r"\1", md)
    md = re.sub(r"<[^>]+>", "", md)                     # qualsevol altra etiqueta
    lines = [ln.strip() for ln in md.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def body_similarity(a: str, b: str) -> float:
    na, nb = normalize_body(a), normalize_body(b)
    if not na and not nb:
        return 1.0
    return round(difflib.SequenceMatcher(None, na, nb).ratio(), 3)


def headings(md: str) -> List[str]:
    return [h.strip() for h in _HEADING_RE.findall(normalize_body(md))]


def unified_diff(notion_md: str, vault_md: str, n: int = 2) -> str:
    """Diff unificat (per a inspecció humana) dels cossos normalitzats."""
    a = normalize_body(notion_md).splitlines()
    b = normalize_body(vault_md).splitlines()
    return "\n".join(difflib.unified_diff(a, b, "notion", "vault", lineterm="", n=n))


# ---------------------------------------------------------------------------
# Diff d'una pàgina
# ---------------------------------------------------------------------------
def diff_page(notion_md: str, vault_md: str,
              notion_child_dbs: Optional[List[str]] = None) -> Dict[str, Any]:
    """Compara una pàgina Notion ↔ vault. Retorna un veredicte estructurat (no destructiu)."""
    n_embeds = list(notion_child_dbs) if notion_child_dbs is not None else extract_notion_inline_dbs(notion_md)
    v_embeds = extract_vault_views(vault_md)
    n_body = normalize_body(notion_md)
    v_body = normalize_body(vault_md)
    n_has_embeds = len(n_embeds) > 0
    v_has_embeds = len(v_embeds) > 0

    # Classificació tenint en compte cossos buits (un projecte de Notion sovint NO té cos:
    # només propietats + relacions → `<blank-page>`). Comparar buit vs no-buit donava 0%
    # i ho marcava "divergit", que era soroll, no un conflicte real.
    sim = body_similarity(notion_md, vault_md)
    notion_empty = not n_body and not n_has_embeds
    vault_empty = not v_body and not v_has_embeds
    if notion_empty and vault_empty:
        status = "identical"
    elif notion_empty:
        status = "notion_blank"   # Notion no té res a portar
    elif vault_empty:
        status = "vault_blank"    # el vault no té cos i Notion sí → es podria enriquir
    else:
        status = "identical" if sim >= 0.98 else ("similar" if sim >= 0.6 else "diverged")

    safe_action = {
        "identical": "none", "notion_blank": "none",
        "vault_blank": "review", "similar": "review", "diverged": "skip",
    }[status]
    return {
        "body_similarity": sim,
        "body_status": status,   # identical | similar | diverged | notion_blank | vault_blank
        "notion_embeds": len(n_embeds),
        "vault_embeds": len(v_embeds),
        "embeds_match": len(n_embeds) == len(v_embeds),
        "notion_headings": headings(notion_md),
        "vault_headings": headings(vault_md),
        "safe_action": safe_action,
    }


# ---------------------------------------------------------------------------
# Aparellament de pàgines (per id de Notion conservat al vault, fallback títol)
# ---------------------------------------------------------------------------
def _norm_id(x: str) -> str:
    return str(x or "").replace("-", "").lower()


def match_pages(notion_rows: List[Dict[str, Any]], vault_pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aparella per id (Notion id == vault metadata.id) i, si no, per títol normalitzat.

    `notion_rows`: [{id, title}]; `vault_pages`: [{id, title}] (id = metadata.id del frontmatter).
    Retorna {matched:[(n,v)], notion_only:[...], vault_only:[...]}.
    """
    v_by_id = {_norm_id(p.get("id")): p for p in vault_pages}
    v_by_title = {}
    for p in vault_pages:
        v_by_title.setdefault(str(p.get("title", "")).strip().lower(), p)

    matched, notion_only, used = [], [], set()
    for n in notion_rows:
        v = v_by_id.get(_norm_id(n.get("id")))
        if not v:
            v = v_by_title.get(str(n.get("title", "")).strip().lower())
        if v and id(v) not in used:
            matched.append((n, v))
            used.add(id(v))
        else:
            notion_only.append(n)
    vault_only = [p for p in vault_pages if id(p) not in used]
    return {"matched": matched, "notion_only": notion_only, "vault_only": vault_only}
