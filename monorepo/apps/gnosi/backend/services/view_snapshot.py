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

# --- Definició de la vista: fence visible ↔ comentari HTML amagat -----------
# A disc, la definició es guarda com un comentari HTML
# (`<!-- gnosi-view:def {json} -->`) perquè Obsidian i els lectors plans
# l'AMAGUIN (un bloc de codi ```gnosi-view``` es veuria sempre). L'editor de
# Gnosi treballa SEMPRE amb el fence: el backend reconverteix comentari→fence en
# llegir i fence→comentari en desar. Així el frontend no canvia i el round-trip
# de l'editor és idèntic. JSON en una sola línia (el match s'atura a `-->`).
_DEF_COMMENT_RE = re.compile(r"[ \t]*<!--\s*gnosi-view:def\s+(?P<json>.*?)\s*-->[ \t]*")


def compact_view_fences(body: Any) -> Any:
    """Frontera d'ESCRIPTURA: ```gnosi-view {json}``` → `<!-- gnosi-view:def {json} -->`.
    Compacta el JSON en una línia. Si el JSON no és vàlid, deixa el fence intacte
    (mai trencar la definició)."""
    if not isinstance(body, str) or "```gnosi-view" not in body:
        return body

    def _repl(m):
        try:
            payload = json.loads(m.group("json"))
        except Exception:
            return m.group(0)
        compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return f"<!-- gnosi-view:def {compact} -->"

    return _FENCE_RE.sub(_repl, body)


_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)


def rematerialize_md(
    raw: Any,
    host_page_id: Optional[str],
    resolve_ids: Callable[[str, Optional[str]], Optional[List[str]]],
    id_to_title: Optional[Callable[[str], Optional[str]]] = None,
    config_for: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
    resolve_table: Optional[Callable[[str, Optional[str]], Optional[Dict[str, Any]]]] = None,
) -> Any:
    """Regenera el snapshot de vista d'un document .md COMPLET (frontmatter +
    cos) a partir de les dades ACTUALS. Deixa el frontmatter byte a byte i només
    toca la regió del snapshot del cos. Retorna el .md nou — IDÈNTIC a l'entrada
    si res no ha canviat (per no escriure en va). Pur: sense I/O. És la unitat
    que fa servir la tasca de materialització del vault.
    """
    if not isinstance(raw, str) or "gnosi-view" not in raw:
        return raw
    m = _FRONTMATTER_RE.match(raw)
    prefix = raw[:m.end()] if m else ""
    body = raw[m.end():] if m else raw
    new_body = restore_view_fences(body)
    new_body = strip_view_snapshots(new_body)
    new_body = inject_view_snapshots(
        new_body,
        resolve_ids,
        id_to_title=id_to_title,
        host_page_id=host_page_id,
        config_for=config_for,
        resolve_table=resolve_table,
    )
    new_body = compact_view_fences(new_body)
    return prefix + new_body


def restore_view_fences(body: Any) -> Any:
    """Frontera de LECTURA: `<!-- gnosi-view:def {json} -->` → ```gnosi-view {json}```,
    amb el mateix format que produeix l'editor (JSON indentat a 2 espais) perquè
    el round-trip sigui idèntic. Comentari amb JSON invàlid es deixa tal qual."""
    if not isinstance(body, str) or "gnosi-view:def" not in body:
        return body

    def _repl(m):
        try:
            payload = json.loads((m.group("json") or "").strip())
        except Exception:
            return m.group(0)
        pretty = json.dumps(payload, ensure_ascii=False, indent=2)
        return f"```gnosi-view\n{pretty}\n```"

    return _DEF_COMMENT_RE.sub(_repl, body)


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


# Render del snapshot per a la PREVISUALITZACIÓ: a diferència de
# `strip_view_snapshots` (que el treu per a l'editor), aquí el DEIXEM visible
# com a Markdown (taula/llista) i amaguem la definició. NO resol cap vista —
# usa el contingut ja materialitzat a disc. Per al pop-up i el feed.
_RESULT_RENDER_RE = re.compile(
    r"[ \t]*<!--\s*gnosi-view:result\b[^>]*-->\n(?P<content>.*?)\n[ \t]*<!--\s*/gnosi-view:result\s*-->[ \t]*",
    re.DOTALL,
)
_RESULT_TRUNC_RE = re.compile(r"\n?[ \t]*<!--\s*gnosi-view:result-truncated\s+\d+\s*-->[ \t]*")
# Wikilink de snapshot `[[Títol\|id]]` (id a l'àlies, pipe escapat dins taules).
# Per al preview el reduïm a `[[Títol]]`: el renderer del frontend tracta
# l'àlies com a TEXT visible, així que sense això es veuria l'uuid.
_SNAPSHOT_WIKILINK_RE = re.compile(r"\[\[([^\[\]|\\]+)\\?\|[^\[\]]+\]\]")


def render_view_snapshots(body: Any) -> Any:
    """Frontera de PREVISUALITZACIÓ: deixa visible el snapshot desat (la taula o
    llista del bloc `:result`) com a Markdown i elimina la definició amagada
    (`:def`). És el contrari de `strip_view_snapshots`. Per a vistes sense
    snapshot a disc, la definició simplement desapareix (cap JSON cru)."""
    if not isinstance(body, str) or "gnosi-view" not in body:
        return body

    def _show(m):
        content = _RESULT_TRUNC_RE.sub("", m.group("content"))
        content = _SNAPSHOT_WIKILINK_RE.sub(r"[[\1]]", content)
        return content.strip("\n")

    out = _RESULT_RENDER_RE.sub(_show, body)
    out = _DEF_COMMENT_RE.sub("", out)
    return out


def flatten_view_columns(body: Any) -> Any:
    """Aplana les directives de columnes (`:::column-list` / `:::column` / `:::`)
    a contingut lineal per a la previsualització: treu els marcadors i
    desindenta el contingut (4 espais) perquè headings i llistes no es vegin com
    a blocs de codi. Pensat per al pop-up (no per a l'editor)."""
    if not isinstance(body, str) or ":::" not in body:
        return body
    out: List[str] = []
    in_cols = False
    for line in body.split("\n"):
        st = line.strip()
        if st.startswith(":::column-list"):
            in_cols = True
            continue
        if st.startswith(":::column") or st == ":::":
            continue
        # Una línia de contingut SENSE indentació tanca la regió de columnes.
        if in_cols and line and not line[:1].isspace():
            in_cols = False
        if in_cols and line.startswith("    "):
            line = line[4:]
        out.append(line)
    return "\n".join(out)


def _build_block(view_id: str, items: Sequence[str], truncated: int = 0) -> str:
    open_tag = f"<!-- gnosi-view:result view_id={view_id} -->" if view_id else "<!-- gnosi-view:result -->"
    lines = [open_tag]
    lines.extend(f"- {it}" for it in items)
    if truncated > 0:
        lines.append(f"<!-- gnosi-view:result-truncated {truncated} -->")
    lines.append("<!-- /gnosi-view:result -->")
    return "\n".join(lines)


def _md_cell(value: Any) -> str:
    """Escapa un valor per a una cel·la de taula markdown: `|`→`\\|` (preserva els
    wikilinks amb àlies dins de taules — Obsidian entén `[[T\\|id]]`) i aplana
    salts de línia."""
    s = "" if value is None else str(value)
    return (
        s.replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ").strip()
    )


def _build_table_block(view_id: str, headers: Sequence[str], rows: Sequence[Sequence[Any]], truncated: int = 0) -> str:
    open_tag = f"<!-- gnosi-view:result view_id={view_id} -->" if view_id else "<!-- gnosi-view:result -->"
    lines = [open_tag]
    lines.append("| " + " | ".join(_md_cell(h) for h in headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        lines.append("| " + " | ".join(_md_cell(c) for c in row) + " |")
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
    config_for: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
    resolve_table: Optional[Callable[[str, Optional[str]], Optional[Dict[str, Any]]]] = None,
) -> Any:
    """Després de cada fence ```gnosi-view```, escriu la llista de wikilinks de
    les pàgines que la vista retorna. Idempotent i autocuratiu.

    - ``resolve_ids(view_id, host_page_id)`` retorna els ids de pàgina ordenats
      de la vista (o ``None``/buit si no es pot resoldre → no s'escriu llista).
    - ``id_to_title`` resol l'id al títol ACTUAL (per al wikilink). Si no resol,
      ``_decorate_item`` degrada a id nu (mai bloqueja).
    - ``host_page_id`` substitueix el valor de filtre ``this``.
    - ``config_for(view_id)`` (opcional) retorna la config PER VISTA del
      snapshot: ``{"enabled": bool, "limit": int}``. Si ``enabled`` és fals, la
      vista NO escriu llista (s'omet, ni tan sols es resol). ``limit`` (>0)
      acota els ítems amb marca de truncament; ``0`` = sense límit. Si no es
      passa, s'aplica ``max_items`` a totes.

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
            # Config per vista (activació + límit) ABANS de resoldre: una vista
            # desactivada no paga la resolució.
            enabled, limit = True, max_items
            if config_for is not None:
                try:
                    cfg = config_for(view_id) or {}
                    enabled = cfg.get("enabled", True)
                    if cfg.get("limit") is not None:
                        limit = cfg.get("limit")
                except Exception:
                    enabled, limit = True, max_items
            if not enabled:
                continue
            block = None
            # 1) Vistes que el markdown sap representar (table/list): taula amb
            #    les dades reals (capçaleres + cel·les), via resolve_table.
            if resolve_table is not None:
                try:
                    tbl = resolve_table(view_id, host_page_id)
                except Exception:
                    tbl = None
                if tbl and tbl.get("headers") and tbl.get("rows"):
                    trows = list(tbl["rows"])
                    truncated = 0
                    if limit and limit > 0 and len(trows) > limit:
                        truncated = len(trows) - limit
                        trows = trows[:limit]
                    if trows:
                        block = _build_table_block(view_id, tbl["headers"], trows, truncated)
            # 2) Fallback (qualsevol altre tipus): llista de wikilinks.
            if block is None:
                try:
                    ids = resolve_ids(view_id, host_page_id) or []
                except Exception:
                    ids = []
                if not ids:
                    continue
                truncated = 0
                if limit and limit > 0 and len(ids) > limit:
                    truncated = len(ids) - limit
                    ids = ids[:limit]
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


_TRUTHY = {"true", "1", "yes", "si", "sí", "done", "checked", "completat"}


def _as_bool(value: Any) -> bool:
    """Paritat amb ``rule_engine._is_truthy_checkbox`` i el front (``asBool``):
    camp absent/""/0/"false" = no marcat; ``True``/1/"yes"/"sí"… = marcat."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in _TRUTHY


def _normalize_field_key(name: Any) -> str:
    """Nom de camp sense prefix decoratiu (emoji/espais) i en minúscules.

    Permet que un filtre guardat amb el nom ANTIC d'una columna (p.ex. amb un
    prefix decoratiu) casi amb la metadata canonicalitzada al nom NOU
    (``Àrees``) després de renomenar la columna. Mateixa normalització que
    ``relation_sync._norm``."""
    return re.sub(r"^[^\w]+", "", str(name or ""), flags=re.UNICODE).strip().lower()


def _meta_value_for_field(meta: Dict[str, Any], field: str) -> Any:
    """Valor de ``field`` a ``meta``, tolerant a renames de prefix: prova la clau
    EXACTA i, si no hi és, casa per nom normalitzat (emoji↔sense). Així un filtre
    no es trenca quan es renomena la columna a què apunta."""
    if field in meta:
        return meta[field]
    nf = _normalize_field_key(field)
    if nf:
        for k, v in meta.items():
            if _normalize_field_key(k) == nf:
                return v
    return None


def apply_filter(meta: Dict[str, Any], page_id: Optional[str], f: Dict[str, Any]) -> bool:
    """Port 1:1 de ``applyFilter`` (DbViewEmbed.jsx). ``value == 'this'`` →
    ``page_id``. Valors de metadata: llista → conjunt de strings; escalar →
    [str]; buit/None → []. El field es resol per nom O àlies (tolera renames)."""
    field = f.get("field") if isinstance(f, dict) else None
    if not field:
        return True
    op = str(f.get("operator") or "equals").lower()
    raw = page_id if f.get("value") == "this" else f.get("value")
    target = None if raw is None else str(raw)
    v = _meta_value_for_field(meta or {}, field)
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
    # Valor booleà (checkbox: "true"/"false"): comparem per veritat, no per
    # cadena, perquè un camp absent compti com a "no marcat" i casi amb "false"
    # (i evitem el desajust str(True)=="True" vs "true").
    if op in ("equals", "not_equals") and target.lower() in ("true", "false"):
        want = target.lower() == "true"
        cur = _as_bool(v)
        return (cur == want) if op == "equals" else (cur != want)
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
    return [str(r.get("id")) for r in resolve_rows(rows, view, host_page_id) if r.get("id")]


def resolve_rows(
    rows: List[Dict[str, Any]],
    view: Dict[str, Any],
    host_page_id: Optional[str],
) -> List[Dict[str, Any]]:
    """Com ``resolve_row_ids`` però retorna les FILES ordenades (``{id, title,
    metadata}``), no només els ids — per a la taula markdown."""
    filters = view.get("filters") or ([view["filter"]] if view.get("filter") else [])
    filtered = [
        r for r in rows
        if all(apply_filter(r.get("metadata") or {}, host_page_id, f) for f in filters)
    ]
    sorts = view.get("sorts") or ([view["sort"]] if view.get("sort") else [])
    return multi_key_sort(filtered, sorts)
