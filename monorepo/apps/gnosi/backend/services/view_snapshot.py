"""Snapshot de resultats d'una vista embeguda al cos markdown.

Cada bloc ```gnosi-view``` del cos pot anar seguit d'una llista de wikilinks
``[[Títol|id]]`` cap a les pàgines que la vista RETORNA. Serveix per a
portabilitat: Obsidian (graf, backlinks, navegació), lectors plans i el sync a
Drupal veuen els enllaços encara que no executin la vista. La llista va
delimitada per comentaris HTML sentinella perquè sigui un artefacte DERIVAT,
no contingut autoral:

    ```gnosi-view
    { "view_id": "…", "heading": "", "heading_level": 1 }
    ```

    <!-- gnosi-view:result view_id=… -->
    - [[Títol A|id-a]]
    - [[Títol B|id-b]]
    <!-- /gnosi-view:result -->

Mateixa filosofia que els wikilinks de relació (``relation_links.py``):
- **Escriptura** (``inject_view_snapshots``, a ``save_page_md``): autocurativa,
  re-resol files i títols a cada desada. Idempotent (treu el bloc anterior i el
  torna a posar).
- **Lectura** (``strip_view_snapshots``, a ``parse_frontmatter``): treu la
  llista perquè ni l'editor ni el domini la vegin mai. El round-trip de
  l'editor no la duplica.

El format del wikilink (``[[Títol|id]]``, id a l'àlies) i la seguretat del
títol es reusen de ``relation_links``.

Mòdul deliberadament lleuger (re + json + typing): la resolució de files i de
títols arriba per callbacks injectats des de ``vault_routes`` (cap dependència
pesada ni d'estat global aquí).
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Sequence

from backend.services.relation_links import _decorate_item

# --- Sentinelles del bloc snapshot -----------------------------------------
SNAPSHOT_OPEN_PREFIX = "<!-- gnosi-view:result"
_SNAPSHOT_BLOCK_RE = re.compile(
    r"[ \t]*<!--\s*gnosi-view:result\b[^>]*-->\n"  # obertura (amb view_id opcional)
    r".*?"                                            # ítems (no-greedy)
    r"\n[ \t]*<!--\s*/gnosi-view:result\s*-->[ \t]*",  # tancament
    re.DOTALL,
)

# Fence ```gnosi-view ... ``` (JSON al mig). El frontend l'emet amb 3 backticks
# i etiqueta `gnosi-view`; tolerem espais finals a la línia de tancament.
_FENCE_RE = re.compile(
    r"```gnosi-view[ \t]*\n(?P<json>.*?)\n```[ \t]*",
    re.DOTALL,
)

# Límit defensiu: una vista sense filtres pot retornar tota la taula. Evitem
# escriure llistes desmesurades a cada desada. Si es supera, es trunca i es
# DEIXA CONSTÀNCIA explícita (mai un tall silenciós).
DEFAULT_MAX_ITEMS = 500


def strip_view_snapshots(body: Any) -> Any:
    """Treu TOTS els blocs snapshot del cos. Idempotent; no-op si no n'hi ha.

    És la frontera de LECTURA: a partir d'aquí l'editor i el domini veuen el
    cos sense la llista derivada. Conserva la resta del document intacta i
    col·lapsa la línia en blanc que precedia el bloc per no acumular buits.
    """
    if not isinstance(body, str) or SNAPSHOT_OPEN_PREFIX not in body:
        return body
    # Treu també una (només una) línia en blanc immediatament anterior, que és
    # la que afegeix `inject_view_snapshots` com a separador.
    cleaned = re.sub(r"\n?\n" + _SNAPSHOT_BLOCK_RE.pattern, "", body, flags=re.DOTALL)
    # Per si algun bloc no anava precedit de línia en blanc (edició manual):
    cleaned = _SNAPSHOT_BLOCK_RE.sub("", cleaned)
    return cleaned


def _build_block(view_id: str, items: Sequence[str], truncated: int = 0) -> str:
    open_tag = f"<!-- gnosi-view:result view_id={view_id} -->" if view_id else "<!-- gnosi-view:result -->"
    lines = [open_tag]
    lines.extend(f"- {it}" for it in items)
    if truncated > 0:
        lines.append(f"<!-- gnosi-view:result-truncated {truncated} -->")
    lines.append("<!-- /gnosi-view:result -->")
    return "\n".join(lines)


def inject_view_snapshots(
    body: Any,
    resolve_ids: Callable[[str, Optional[str]], Optional[List[str]]],
    id_to_title: Optional[Callable[[str], Optional[str]]] = None,
    host_page_id: Optional[str] = None,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> Any:
    """Després de cada fence ```gnosi-view```, escriu la llista de wikilinks de
    les pàgines que la vista retorna. Idempotent i autocuratiu.

    - ``resolve_ids(view_id, host_page_id)`` retorna els ids de pàgina ordenats
      de la vista (o ``None``/buit si no es pot resoldre → no s'escriu llista).
    - ``id_to_title`` resol l'id al títol ACTUAL (per al wikilink). Si no resol,
      ``_decorate_item`` degrada a id nu (mai bloqueja).
    - ``host_page_id`` substitueix el valor de filtre ``this``.

    Mai llança: davant de qualsevol error torna el cos sense tocar (defensiu,
    com la decoració de relacions).
    """
    if not isinstance(body, str) or "```gnosi-view" not in body:
        return body
    try:
        clean = strip_view_snapshots(body)

        out: List[str] = []
        last = 0
        for m in _FENCE_RE.finditer(clean):
            out.append(clean[last:m.end()])
            last = m.end()
            view_id = ""
            try:
                payload = json.loads(m.group("json"))
                view_id = str(payload.get("view_id") or "")
            except Exception:
                view_id = ""
            if not view_id:
                continue
            try:
                ids = resolve_ids(view_id, host_page_id) or []
            except Exception:
                ids = []
            if not ids:
                continue
            truncated = 0
            if max_items and len(ids) > max_items:
                truncated = len(ids) - max_items
                ids = ids[:max_items]
            items = [_decorate_item(rid, id_to_title, None) for rid in ids]
            items = [it for it in items if isinstance(it, str) and it.strip()]
            if not items:
                continue
            block = _build_block(view_id, items, truncated)
            out.append(f"\n\n{block}")
        out.append(clean[last:])
        return "".join(out)
    except Exception:
        return body


# --- Resolució de files (port fidel del frontend DbViewEmbed) ---------------
# sortKey: treu puntuació/símbols/espais inicials perquè «¿Què és?» ordeni com
# «Què és». \W (no-paraula) + _ ≈ \p{P}\p{S}\s del frontend.
_SORTKEY_LEAD_RE = re.compile(r"^[\W_]+", re.UNICODE)


def sort_key(value: Any) -> str:
    return _SORTKEY_LEAD_RE.sub("", str("" if value is None else value))


def apply_filter(meta: Dict[str, Any], page_id: Optional[str], f: Dict[str, Any]) -> bool:
    """Port 1:1 de ``applyFilter`` (DbViewEmbed.jsx). ``value == 'this'`` →
    ``page_id``. Valors de metadata: llista → conjunt de strings; escalar →
    [str]; buit/None → []."""
    field = f.get("field") if isinstance(f, dict) else None
    if not field:
        return True
    op = str(f.get("operator") or "equals").lower()
    raw = page_id if f.get("value") == "this" else f.get("value")
    target = None if raw is None else str(raw)
    v = (meta or {}).get(field)
    if isinstance(v, list):
        arr = [str(x) for x in v]
    elif v is None or v == "":
        arr = []
    else:
        arr = [str(v)]
    if op == "is_empty":
        return len(arr) == 0
    if op == "is_not_empty":
        return len(arr) > 0
    if target is None:
        return True
    if op == "equals":
        return target in arr
    if op == "not_equals":
        return target not in arr
    if op == "contains":
        return any(target in x for x in arr)
    if op == "not_contains":
        return not any(target in x for x in arr)
    if op in ("greater_than", "less_than"):
        try:
            t = float(target)
        except (TypeError, ValueError):
            return False
        for x in arr:
            try:
                n = float(x)
            except (TypeError, ValueError):
                continue
            if (n > t) if op == "greater_than" else (n < t):
                return True
        return False
    return True


def multi_key_sort(rows: List[Dict[str, Any]], sorts: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Port de ``multiKeySort``: sense sorts, per títol; si no, multi-clau
    estable aplicant les claus de l'última a la primera."""
    if not sorts:
        return sorted(rows, key=lambda r: sort_key(r.get("title")).lower())
    result = list(rows)
    for s in reversed(list(sorts)):
        field = s.get("field") if isinstance(s, dict) else None
        if not field:
            continue
        reverse = str((s or {}).get("direction") or "asc") == "desc"
        result.sort(
            key=lambda r, _f=field: sort_key((r.get("metadata") or {}).get(_f)).lower(),
            reverse=reverse,
        )
    return result


def resolve_row_ids(
    rows: List[Dict[str, Any]],
    view: Dict[str, Any],
    host_page_id: Optional[str],
) -> List[str]:
    """Donades les files candidates (``{id, title, metadata}``, metadata ja en
    noms de RESPOSTA i ids de relació nets) i una vista del registry, retorna
    els ids ordenats que la vista mostra. Replica filtre + ordre del frontend.

    Els templates s'han d'haver exclòs abans (com fa el frontend amb
    ``is_template``)."""
    filters = view.get("filters") or ([view["filter"]] if view.get("filter") else [])
    filtered = [
        r for r in rows
        if all(apply_filter(r.get("metadata") or {}, host_page_id, f) for f in filters)
    ]
    sorts = view.get("sorts") or ([view["sort"]] if view.get("sort") else [])
    ordered = multi_key_sort(filtered, sorts)
    return [str(r.get("id")) for r in ordered if r.get("id")]
