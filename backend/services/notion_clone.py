"""Orquestrador del CLON EXACTE de Notion → Gnosi (a carpeta nova, Notion = font de veritat).

Diferent del sync guardat: ids NAMESPACED (no toca ni col·lisiona amb el vault existent),
TOTES les pàgines, i el cos ve de l'MCP (fidelitat: columnes, vistes incrustades) en comptes
dels blocs REST. Cada `<!-- gnosi-notion-db:id -->` (de `notion_mcp_md`) es resol a una
`gnosi-view` de la taula CLONADA (via `notion_view_recreator`).

Esquema + valors de fila vénen de la REST (estructurat); el cos i les vistes, de l'MCP.
cf. directiva `notion_exact_clone.md`.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Callable, Dict, List, Optional

from backend.services.notion_importer import (
    map_database_schema, page_to_values, _page_title, _emoji_icon,
)
from backend.services import notion_view_recreator as nvr

_CLONE_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000003")
_MARKER_RE = re.compile(r"<!--\s*gnosi-notion-db:([0-9a-f]{32})\s*-->")


class CloneAborted(Exception):
    """L'usuari ha demanat avortar el clon (cancel·lació cooperativa entre passades)."""


def clone_table_id(notion_db_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "table:" + str(notion_db_id or "").replace("-", "")))


def clone_page_id(notion_page_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "page:" + str(notion_page_id or "").replace("-", "")))


# Emoji/símbols de prefix decoratiu (📀, 🗒️, variation selectors, ZWJ…) + espais inicials.
# NOMÉS treu el prefix: preserva majúscules i accents (≠ `nvr._strip_icon`, que és per comparar:
# minúscula + treu-ho tot). Els filtres de vistes igualment resolen perquè `resolve_filter_field`
# re-normalitza amb `_strip_icon` als dos costats.
_LEADING_ICON_RE = re.compile(
    r"^[\s\U0001F000-\U0001FAFF☀-➿←-⇿⬀-⯿️‍⃣™ℹ]+")


def _clean(name: Any) -> Any:
    """Nom de camp sense l'emoji de prefix (com el vault), preservant la resta del nom."""
    if not isinstance(name, str) or not name:
        return name
    return _LEADING_ICON_RE.sub("", name).strip() or name


def _child_page_ids(blocks: Any) -> List[str]:
    """ids de les sub-pàgines (blocs `child_page`) d'una pàgina."""
    return [b["id"] for b in (blocks or [])
            if isinstance(b, dict) and b.get("type") == "child_page" and b.get("id")]


def _icon_or_cover_url(obj: Any) -> Optional[str]:
    """URL d'una icona/portada de Notion de tipus file/external (None si és emoji o buit)."""
    if isinstance(obj, dict):
        t = obj.get("type")
        if t == "external":
            return (obj.get("external") or {}).get("url")
        if t == "file":
            return (obj.get("file") or {}).get("url")
    return None


def _apply_icon_cover(meta: Dict[str, Any], page: Dict[str, Any], table: Dict[str, Any],
                      save_asset) -> int:
    """Posa `icon` i `cover` a `meta`. Icona emoji → tal qual; icona/portada d'imatge → es baixa
    (si hi ha `save_asset`) a Assets i es desa la ruta. Torna el nombre d'imatges baixades."""
    n = 0
    emoji = _emoji_icon(page.get("icon"))
    if emoji:
        meta["icon"] = emoji
    elif save_asset is not None:
        u = _icon_or_cover_url(page.get("icon"))
        local = save_asset(u, "_icones", table) if u else None
        if local:
            meta["icon"] = local
            n += 1
    if save_asset is not None:
        u = _icon_or_cover_url(page.get("cover"))
        local = save_asset(u, "_portades", table) if u else None
        if local:
            meta["cover"] = local
            n += 1
    return n


def clone_table_schema(notion_db: Dict[str, Any]) -> Dict[str, Any]:
    """Esquema de taula clonat: noms de camp SENSE emoji (com el vault), id i relacions
    namespaced al clon."""
    t = map_database_schema(notion_db)
    t["id"] = clone_table_id(notion_db.get("id"))
    for p in t.get("properties", []):
        p["name"] = _clean(p.get("name"))
        if p.get("type") == "relation" and p.get("relation_database_id"):
            p["relation_database_id"] = clone_table_id(p["relation_database_id"])
    return t


def clone_values(values: Dict[str, Any], schema: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Re-keya els valors a noms NETS (sense emoji) i remapa les relacions a ids de pàgina del
    clon. Les dates es deixen TAL QUAL (es preserva la granularitat de Notion: data o data+hora).
    La decoració de relacions a `[[Títol|id]]` es fa al write_page (cal el mapa de títols)."""
    by_clean = {p.get("name"): p for p in (schema or [])}
    out: Dict[str, Any] = {}
    for k, v in values.items():
        ck = _clean(k)
        t = (by_clean.get(ck) or {}).get("type")
        if t == "relation" and isinstance(v, list):
            out[ck] = [clone_page_id(x) for x in v if x]
        else:
            out[ck] = v
    return out


def resolve_view_markers(body_md: str, notion_host_page_id: str, clone_host_table_id: str,
                         *, fetch_view: Callable[[str], str],
                         resolve_clone_table: Callable[[str], Optional[Dict[str, Any]]]):
    """Substitueix els `<!-- gnosi-notion-db:id -->` per `gnosi-view` de la taula clonada.

    `fetch_view(view_block_id)` → markdown MCP de la vista. `resolve_clone_table(data_source_name)`
    → taula clonada (dict amb id de clon) o None. Retorna (cos_amb_embeds, [vistes_a_crear]).
    """
    views: List[Dict[str, Any]] = []

    def repl(m):
        vid = m.group(1)
        try:
            meta = nvr.parse_mcp_view(fetch_view(vid))
            ct = resolve_clone_table(meta.get("data_source_name"))
            if not ct:
                return ""  # la taula destí no s'ha clonat → treu el marcador
            gv = nvr.build_gnosi_view(notion_host_page_id, ct, clone_host_table_id, meta,
                                      meta.get("data_source_name") or ct.get("name") or "Vista")
            gv["id"] = str(uuid.uuid5(_CLONE_NS, f"view:{notion_host_page_id}:{vid}"))
            # Columnes visibles SENSE emoji (els camps clonats també ho estan) → casen
            gv["visibleProperties"] = [_clean(x) for x in (gv.get("visibleProperties") or [])]
            views.append(gv)
            return nvr.view_embed(gv["id"])
        except Exception:
            return ""

    return _MARKER_RE.sub(repl, body_md), views


def clone_workspace(
    rest_client,                       # NotionClient (REST): esquema + files + valors
    *,
    fetch_page: Callable[[str], str],  # MCP: id pàgina → markdown Notion (cos + vistes)
    mcp_to_markdown: Callable[[str], str],
    write_table: Callable[[Dict[str, Any]], None],
    write_page: Callable[[Dict[str, Any]], None],
    write_view: Callable[[Dict[str, Any]], None],
    database_ids: List[str],
    target_folder: str = "Clon Notion",
    max_pages: int = 5000,
    schema_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
    save_asset: Optional[Callable[[str, Optional[str], Dict[str, Any]], Optional[str]]] = None,
    loose_page_types: Optional[Dict[str, str]] = None,
    follow_subpages: bool = True,
    progress_cb: Optional[Callable[[str, int, int, Dict[str, Any]], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """Clona les BD seleccionades a `target_folder` amb ids del clon i cos de fidelitat (MCP).

    `save_asset(url, prop_or_None, table) -> ruta_local|None`: baixa un adjunt (camp d'arxiu o
    imatge del cos) i torna la ruta `Assets/...`; si és None, no es baixen adjunts (es deixen
    les URLs de Notion, que caduquen).
    `loose_page_types`: {notion_page_id: "wiki"|"dashboard"} de pàgines FORA de BD a clonar amb
    l'etiqueta is_dashboard corresponent.
    """
    report = {"tables": 0, "pages": 0, "views": 0, "attachments": 0,
              "errors": [], "warnings": [], "truncated": False}

    def _emit(phase: str, done: int, total: int) -> None:
        """Reporta progrés i comprova la cancel·lació. Es crida a l'inici de cada element de cada
        passada → punt de control cooperatiu per avortar. Un error al callback no atura el clon,
        però una cancel·lació SÍ (CloneAborted, propagada amunt)."""
        if should_cancel is not None and should_cancel():
            raise CloneAborted()
        if progress_cb is None:
            return
        try:
            progress_cb(phase, done, total, report)
        except Exception:  # noqa: BLE001
            pass

    users = rest_client.list_users()

    # Mapa nom-de-data-source (sense icona) → taula clonada, per resoldre vistes
    clone_tables_by_name: Dict[str, Dict[str, Any]] = {}

    # PASSADA 1: clonar TOTS els esquemes de taula abans de les pàgines, perquè una vista pot
    # referenciar una taula que es clona més tard (resolució de marcadors completa).
    db_by_id: Dict[str, Dict[str, Any]] = {}
    for i, db_id in enumerate(database_ids):
        _emit("schema", i, len(database_ids))
        try:
            db = rest_client.get_database(db_id)
            db_by_id[db_id] = db
            table = clone_table_schema(db)
            if schema_overrides and db_id in schema_overrides:
                from backend.services.notion_schema_config import apply_override
                table = apply_override(table, schema_overrides[db_id])
            _tname = table.get('name') or 'Taula'
            # Sense subcarpeta (target_folder buit) → la taula penja directament de l'arrel del vault.
            table["folder"] = f"{target_folder}/{_tname}" if target_folder else _tname
            write_table(table)
            report["tables"] += 1
            clone_tables_by_name[nvr._strip_icon(table.get("name"))] = table
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"database": db_id, "stage": "schema", "error": str(e)})

    # AVÍS: camps de relació que apunten a una BD NO seleccionada → quedaran orfes (cal marcar
    # totes les BD per a un clon complet). Guard-rail per al clon "d'un sol tret".
    cloned_ids = {t.get("id") for t in clone_tables_by_name.values()}
    for t in clone_tables_by_name.values():
        for p in t.get("properties", []):
            tgt = p.get("relation_database_id")
            if p.get("type") == "relation" and tgt and tgt not in cloned_ids:
                report["warnings"].append(
                    f"La taula «{t.get('name')}» té el camp de relació «{p.get('name')}» cap a una "
                    f"BD no seleccionada: aquestes relacions quedaran sense destí. Marca totes les BD.")

    # PASSADA 2a: RECOLLIR files + títols de TOTES les BD abans d'escriure, per tenir el mapa
    # complet id_clon → títol (cal per decorar les relacions a `[[Títol|id]]`, fins i tot quan
    # apunten a una pàgina que es clona més tard o d'una altra BD). No torna a consultar Notion
    # a la passada 2b (reusa les files recollides).
    from backend.services.notion_importer import _plain_title
    from backend.services.relation_links import decorate_relation_wikilinks, relation_keys_from_table
    from backend.services.notion_attachments import localize_values
    collected: List[tuple] = []          # (table, row, values, title, rel_keys)
    clone_titles: Dict[str, str] = {}
    for di, (db_id, db) in enumerate(db_by_id.items()):
        _emit("collect", di, len(db_by_id))
        try:
            table = clone_tables_by_name.get(nvr._strip_icon(_plain_title(db.get("title"))))
            if not table:
                continue
            rel_keys = relation_keys_from_table(table)
            for row in rest_client.query_database(db_id):
                if len(collected) >= max_pages:
                    report["truncated"] = True
                    break
                try:
                    values = clone_values(page_to_values(row, users), table.get("properties", []))
                    # Baixa els adjunts dels camps d'arxiu ARA que la URL signada de Notion és
                    # FRESCA. Si es deixés per a la passada 2b (com abans), en clons llargs (>1h)
                    # les URLs S3 caduquen (X-Amz-Expires=3600) i donen 403 → adjunts perduts.
                    if save_asset is not None:
                        values, na = localize_values(
                            values, table.get("properties", []),
                            lambda u, p, _t=table: save_asset(u, p, _t))
                        report["attachments"] += na
                    title = _page_title(row) or "Sense títol"
                    clone_titles[clone_page_id(row["id"])] = title
                    collected.append((table, row, values, title, rel_keys))
                except Exception as e:  # noqa: BLE001
                    report["errors"].append({"page": row.get("id"), "error": str(e)})
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"database": db_id, "error": str(e)})

    def _id_to_title(rid):
        return clone_titles.get(rid)

    # INVERSOS de relació: Notion mostra les dues bandes (dual relation). Com que ja tenim totes
    # les files recollides, poblem el camp invers de cada destí (best-effort i NOMÉS quan és no
    # ambigu, via relation_sync.resolve_inverse_relation). Així les relacions es veuen completes
    # sense dependre de cap sincronització posterior.
    from backend.services import relation_sync
    table_by_id = {t.get("id"): t for t in clone_tables_by_name.values()}
    inverse_adds: Dict[str, Dict[str, set]] = {}   # target_clone_id → {camp_invers: {source_ids}}
    for table, row, values, title, rel_keys in collected:
        src = clone_page_id(row["id"])
        for key in rel_keys:
            v = values.get(key)
            if not isinstance(v, list) or not v:
                continue
            pair = relation_sync.resolve_inverse_relation(table, key, lambda tid: table_by_id.get(tid))
            if not pair:
                continue
            inv_field = pair[1]
            for tgt in v:    # tgt = id de clon (ja remapat per clone_values)
                inverse_adds.setdefault(tgt, {}).setdefault(inv_field, set()).add(src)

    # PASSADA 2b: escriure (cos + vistes via MCP, adjunts, relacions decorades a `[[Títol|id]]`)
    for pi, (table, row, values, title, rel_keys) in enumerate(collected):
        _emit("pages", pi, len(collected))
        try:
            props = table.get("properties", [])
            # (Els adjunts dels camps d'arxiu ja s'han baixat a la passada 2a amb URLs fresques.)
            body = ""
            try:
                page_md = fetch_page(row["id"])
                body = mcp_to_markdown(page_md) if page_md else ""
                host_pid = str(row["id"]).replace("-", "")
                body, gviews = resolve_view_markers(
                    body, host_pid, table["id"],
                    fetch_view=fetch_page,
                    resolve_clone_table=lambda n: clone_tables_by_name.get(nvr._strip_icon(n)))
                for gv in gviews:
                    write_view(gv)
                    report["views"] += 1
                # Baixa les imatges del cos (![alt](url) remotes → Assets/ locals)
                if save_asset is not None and body:
                    from backend.services.notion_attachments import localize_body
                    body, nb = localize_body(body, lambda u, p: save_asset(u, p, table))
                    report["attachments"] += nb
            except Exception as e:  # noqa: BLE001
                report["errors"].append({"page": row.get("id"), "stage": "mcp", "error": str(e)})
            # Fusiona els inversos que apunten a AQUESTA pàgina (dedup, preservant els directes)
            adds = inverse_adds.get(clone_page_id(row["id"]))
            if adds:
                for f, ids in adds.items():
                    cur = values.get(f)
                    cur = list(cur) if isinstance(cur, list) else ([cur] if cur else [])
                    for i in ids:
                        if i not in cur:
                            cur.append(i)
                    values[f] = cur
            meta = {"table_id": table["id"], **values}
            decorate_relation_wikilinks(meta, rel_keys, id_to_title=_id_to_title)  # id → [[Títol|id]]
            report["attachments"] += _apply_icon_cover(meta, row, table, save_asset)  # icona+portada
            write_page({
                "id": clone_page_id(row["id"]),
                "title": title,
                "content": body,
                "metadata": meta,
            })
            report["pages"] += 1
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"page": row.get("id"), "error": str(e)})

    def _clone_standalone(pid, page, extra_meta):
        """Clona una pàgina autònoma (solta o sub-pàgina): cos+vistes via MCP, adjunts, icona+portada.
        Si té vistes incrustades (linked database views) → és un DASHBOARD."""
        title = _page_title(page) or "Sense títol"
        body = ""
        has_views = False
        try:
            page_md = fetch_page(pid)
            body = mcp_to_markdown(page_md) if page_md else ""
            has_views = "gnosi-notion-db:" in body   # marcadors d'embedded db abans de resoldre
            host_pid = str(pid).replace("-", "")
            body, gviews = resolve_view_markers(
                body, host_pid, "",
                fetch_view=fetch_page,
                resolve_clone_table=lambda n: clone_tables_by_name.get(nvr._strip_icon(n)))
            has_views = has_views or bool(gviews)
            for gv in gviews:
                write_view(gv)
                report["views"] += 1
            if save_asset is not None and body:
                from backend.services.notion_attachments import localize_body
                body, nb = localize_body(body, lambda u, p: save_asset(u, p, {"name": "Pàgines"}))
                report["attachments"] += nb
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"page": pid, "stage": "mcp", "error": str(e)})
        meta = dict(extra_meta or {})
        if has_views:
            meta["is_dashboard"] = True   # pàgina solta amb vistes incrustades = dashboard
        report["attachments"] += _apply_icon_cover(meta, page, {"name": "Pàgines"}, save_asset)
        write_page({"id": clone_page_id(pid), "title": title, "content": body, "metadata": meta})
        report["pages"] += 1

    # PASSADA 3: pàgines FORA de BD (wiki/dashboard segons tria de l'usuari)
    _loose = list((loose_page_types or {}).items())
    for li, (pid, ptype) in enumerate(_loose):
        _emit("loose", li, len(_loose))
        if report["pages"] >= max_pages:
            report["truncated"] = True
            break
        try:
            page = rest_client.get_page(pid)
            _clone_standalone(pid, page, {"is_dashboard": True} if str(ptype).lower() == "dashboard" else {})
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"page": pid, "stage": "loose", "error": str(e)})

    # PASSADA 4: SUB-PÀGINES (blocs child_page) — clona-les com a pàgines pròpies perquè res quedi
    # orfe. Cicle-segur (conjunt de vistos) i acotat per max_pages. Per a la migració d'un sol tret.
    if follow_subpages:
        from collections import deque
        seed = [r["id"] for _, r, _, _, _ in collected] + list(loose_page_types or {})
        seen = {str(x).replace("-", "") for x in seed}
        to_scan = deque(seed)
        sub_done = 0
        while to_scan and report["pages"] < max_pages:
            parent = to_scan.popleft()
            try:
                blocks = rest_client.get_block_children(parent)
            except Exception:  # noqa: BLE001
                continue
            for cid in _child_page_ids(blocks):
                if str(cid).replace("-", "") in seen:
                    continue
                seen.add(str(cid).replace("-", ""))
                if report["pages"] >= max_pages:
                    report["truncated"] = True
                    break
                # Total desconegut (es descobreix amb el BFS): total=0 → barra indeterminada.
                _emit("subpages", sub_done, 0)
                try:
                    page = rest_client.get_page(cid)
                    _clone_standalone(cid, page, {})
                    sub_done += 1
                    to_scan.append(cid)   # recursa: sub-pàgines de la sub-pàgina
                except Exception as e:  # noqa: BLE001
                    report["errors"].append({"page": cid, "stage": "subpage", "error": str(e)})

    _emit("done", report["pages"], report["pages"])
    return report
