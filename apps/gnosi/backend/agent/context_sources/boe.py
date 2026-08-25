"""BOE adapter: search the Spanish official gazette through its open API.

The BOE is not scraped. Its open-data API (`boe.es/datosabiertos`) exposes both
the consolidated legislation collection — with full-text search — and the daily
summary, which is what an agent actually needs: no crawl can keep up with a
gazette that changes every morning, and the API answers the exact question.

Endpoints used (documented in `APIconsolidada.pdf` / `APIsumarioBOE.pdf`):

- `GET /datosabiertos/api/legislacion-consolidada?query=<json>&limit=N`
  The query DSL is Elasticsearch-flavoured:
  `{"query":{"query_string":{"query":"texto:… and titulo:…"}}}`
  Searchable fields include `texto` (full text), `titulo`, `materia@codigo`,
  `fecha_publicacion`, `rango@codigo`.
- `GET /datosabiertos/api/legislacion-consolidada/id/{id}/texto/indice`
  Table of contents of one norm.
- `GET /datosabiertos/api/boe/sumario/{AAAAMMDD}` — one day's summary.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

log = logging.getLogger(__name__)

API_BASE = "https://www.boe.es/datosabiertos/api"
HTTP_TIMEOUT = 15
MAX_RESULTS = 5

ID = "boe"
LABEL = "BOE (Official State Gazette)"
DESCRIPTION = (
    "Consolidated legislation and daily BOE summaries from its open-data API. "
    "Provides full-text search over regulations. NOTE: the corpus is IN SPANISH, "
    "so always search it with Spanish terms."
)


def _get(path: str, params: Dict[str, Any], *, as_xml: bool = False) -> Any:
    """GET against the API. `as_xml` for the endpoints that only speak XML.

    The block endpoint (`/texto/bloque/{id}`) rejects `Accept: application/json`
    with a 400 — the norm's text is only served as XML.
    """
    import requests
    resp = requests.get(
        f"{API_BASE}{path}",
        params=params,
        headers={"Accept": "application/xml" if as_xml else "application/json"},
        timeout=HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    if as_xml:
        return resp.text
    payload = resp.json()
    # The API always answers 200 with a `status` envelope; a search error lands
    # there rather than in the HTTP code.
    status = (payload or {}).get("status") or {}
    if str(status.get("code")) != "200":
        raise RuntimeError(status.get("text") or "unknown BOE response")
    return (payload or {}).get("data")


# Function words carry no signal but, AND-ed into the query, they drag the
# result set to zero. Catalan and Spanish, since the user writes in either.
STOPWORDS = {
    "les", "els", "amb", "que", "per", "del", "dels", "una", "uns", "unes",
    "las", "los", "con", "que", "por", "para", "una", "unos", "unas", "sobre",
    "boe", "llei", "ley", "norma", "consolidada",
}


def _terms(user_query: str) -> List[str]:
    return [
        w for w in (user_query or "").replace(",", " ").split()
        if len(w) > 3 and w.lower() not in STOPWORDS
    ]


def build_query(user_query: str, *, operator: str = "and") -> str:
    """Turns free text into the API's query DSL, searching the full text.

    Terms are AND-ed by default: the BOE holds every Spanish law, so an OR
    search returns thousands of irrelevant norms. `search` falls back to OR
    when the strict query finds nothing.
    """
    words = _terms(user_query)
    condition = f" {operator} ".join(f"texto:{w}" for w in words) or f"texto:{user_query}"
    return json.dumps({"query": {"query_string": {"query": condition}}})


def format_hits(data: Any, limit: int) -> str:
    rows: List[dict] = data if isinstance(data, list) else []
    if not rows:
        return ""
    out = []
    for row in rows[:limit]:
        ident = row.get("identificador") or ""
        out.append(
            f"- {row.get('titulo') or ident}\n"
            f"  id: {ident} · published: {row.get('fecha_publicacion') or '?'}"
            f" · rank: {(row.get('rango') or {}).get('texto') or '?'}\n"
            f"  https://www.boe.es/buscar/act.php?id={ident}"
        )
    return "\n".join(out)


def search(query: str, limit: int = MAX_RESULTS) -> str:
    """Full-text search over the consolidated legislation.

    Strict (AND) first, then OR: one unlucky term — a synonym the law does not
    use — otherwise empties an otherwise good query.
    """
    hits = ""
    try:
        for operator in ("and", "or"):
            data = _get(
                "/legislacion-consolidada",
                {"query": build_query(query, operator=operator), "limit": limit},
            )
            hits = format_hits(data, limit)
            if hits:
                break
    except Exception as exc:  # noqa: BLE001
        log.warning("BOE search failed for %r: %s", query, exc)
        return f"Could not query the BOE: {exc}"
    if not hits:
        # Almost always a language mismatch: the corpus is in Spanish and the
        # user (and hence the agent) often writes Catalan.
        return (
            f"The BOE returned no regulations for «{query}». Regulation text is "
            "IN SPANISH: try again with Spanish terms "
            "(for example, «derechos personas discapacidad»)."
        )
    return f"BOE regulations for «{query}»:\n{hits}"


def read(reference: str) -> str:
    """Reads a BOE reference.

    Accepts a norm id (`BOE-A-…`) → its table of contents, `BOE-A-…#bloque`
    → the text of that block, or a date `AAAAMMDD` → that day's summary. The
    full text of a norm is not returned wholesale: the consolidated
    Constitution alone runs to 165 blocks.
    """
    ref = (reference or "").strip()
    try:
        if ref.isdigit() and len(ref) == 8:
            data = _get(f"/boe/sumario/{ref}", {})
            return json.dumps(data, ensure_ascii=False)[:12000]
        if "#" in ref:
            norm_id, block_id = ref.split("#", 1)
            xml = _get(
                f"/legislacion-consolidada/id/{norm_id}/texto/bloque/{block_id}",
                {}, as_xml=True,
            )
            from bs4 import BeautifulSoup
            # Only the <data> node: the envelope would otherwise prepend a bare
            # "200 / ok" to the text of every article.
            soup = BeautifulSoup(xml, "xml")
            return (soup.find("data") or soup).get_text("\n", strip=True)[:12000]
        data = _get(f"/legislacion-consolidada/id/{ref}/texto/indice", {})
        blocks = (data or [{}])[0].get("bloque", []) if isinstance(data, list) else []
        titles = [f"- {b.get('id')}: {b.get('titulo') or '(untitled)'}" for b in blocks]
        return (
            f"Index for regulation {ref} ({len(titles)} blocks). To read one, "
            f"call read_external_source('boe', '{ref}#<block_id>'):\n"
            + "\n".join(titles[:80])
            if titles else f"The BOE returned no content for «{ref}»."
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("BOE read failed for %r: %s", ref, exc)
        return f"Could not read «{ref}» from the BOE: {exc}"
