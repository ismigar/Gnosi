"""Orchestrator for the EXACT CLONE of Notion → Gnosi (into a new folder, Notion = source of truth).

Different from the saved sync: NAMESPACED ids (doesn't touch or collide with the existing vault),
ALL pages, and the body comes from the MCP (fidelity: columns, embedded views) instead
of REST blocks. Each `<!-- gnosi-notion-db:id -->` (from `notion_mcp_md`) resolves to a
`gnosi-view` of the CLONED table (via `notion_view_recreator`).

Schema + row values come from REST (structured); the body and views, from the MCP.
cf. directive `notion_exact_clone.md`.
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from backend.services.notion_importer import (
    map_database_schema, page_to_values, _page_title, _emoji_icon,
)
from backend.utils.safe_io import sanitize_vault_title
from backend.services import notion_view_recreator as nvr

_CLONE_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000003")
_MARKER_RE = re.compile(r"<!--\s*gnosi-notion-db:([0-9a-f]{32})\s*-->")


class CloneAborted(Exception):
    """The user has requested to abort the clone (cooperative cancellation between passes)."""


def clone_table_id(notion_db_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "table:" + str(notion_db_id or "").replace("-", "")))


def clone_page_id(notion_page_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "page:" + str(notion_page_id or "").replace("-", "")))


# Decorative prefix emoji/symbols (📀, 🗒️, variation selectors, ZWJ…) + leading spaces.
# ONLY strips the prefix: preserves uppercase letters and accents (≠ `nvr._strip_icon`, which is for comparing:
# lowercase + strips everything). View filters still resolve because `resolve_filter_field`
# re-normalize with `_strip_icon` on both sides.
_LEADING_ICON_RE = re.compile(
    r"^[\s\U0001F000-\U0001FAFF☀-➿←-⇿⬀-⯿️‍⃣™ℹ]+")


def _clean(name: Any) -> Any:
    """Field name without the prefix emoji (like the vault), preserving the rest of the name."""
    if not isinstance(name, str) or not name:
        return name
    return _LEADING_ICON_RE.sub("", name).strip() or name


def _child_page_ids(blocks: Any) -> List[str]:
    """ids of a page's sub-pages (`child_page` blocks), including those nested inside
    container blocks (toggle, column, callout…) via `_children`. Does NOT descend into
    found `child_page` blocks: their children belong to the sub-page (the BFS visits it later
    as the parent); descending into them would attribute them to the grandparent."""
    out: List[str] = []
    for b in (blocks or []):
        if not isinstance(b, dict):
            continue
        if b.get("type") == "child_page" and b.get("id"):
            out.append(b["id"])
            continue
        out.extend(_child_page_ids(b.get("_children")))
    return out


def block_file_url(block: Dict[str, Any]) -> Optional[str]:
    """Fresh signed/external URL of a REST media block (`file`/`pdf`/`video`/`audio`/`image`
    have `{type: {"type": "file"|"external", ...: {"url": ...}}}`; `embed` has a flat
    `{"embed": {"url": ...}}`). None for any other block shape."""
    if not isinstance(block, dict):
        return None
    payload = block.get(str(block.get("type") or "")) or {}
    if not isinstance(payload, dict):
        return None
    inner = payload.get(str(payload.get("type") or "")) or {}
    url = inner.get("url") if isinstance(inner, dict) else None
    url = url or payload.get("url")
    return url if isinstance(url, str) and url.strip() else None


def _icon_or_cover_url(obj: Any) -> Optional[str]:
    """URL of a Notion icon/cover of type file/external (None if it's emoji or empty)."""
    if isinstance(obj, dict):
        t = obj.get("type")
        if t == "external":
            return (obj.get("external") or {}).get("url")
        if t == "file":
            return (obj.get("file") or {}).get("url")
    return None


def _apply_icon_cover(meta: Dict[str, Any], page: Dict[str, Any], table: Dict[str, Any],
                      save_asset) -> int:
    """Sets `icon` and `cover` on `meta`. Emoji icon → as-is; image icon/cover → downloaded
    (if `save_asset` is available) to Assets and the path is saved. Returns the number of images downloaded."""
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
    """Cloned table schema: field names WITHOUT emoji (like the vault), id and relations
    namespaced to the clone."""
    t = map_database_schema(notion_db)
    t["id"] = clone_table_id(notion_db.get("id"))
    for p in t.get("properties", []):
        p["name"] = _clean(p.get("name"))
        if p.get("type") == "relation" and p.get("relation_database_id"):
            p["relation_database_id"] = clone_table_id(p["relation_database_id"])
    return t


def clone_values(values: Dict[str, Any], schema: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Re-keys the values to CLEAN names (without emoji) and remaps relations to the clone's
    page ids. Dates are left AS-IS (Notion's granularity is preserved: date or date+time).
    Decorating relations as `[[Títol|id]]` is done in write_page (needs the title map).

    Only fields present in the effective table schema are returned. A schema override can
    intentionally omit a Notion property; persisting that property's value anyway would turn
    it into undeclared per-page metadata, which the table editor exposes as a page-specific
    property. It also prevents relation IDs in omitted fields from leaking through unconverted.
    """
    by_clean = {p.get("name"): p for p in (schema or [])}
    out: Dict[str, Any] = {}
    for k, v in values.items():
        ck = _clean(k)
        field = by_clean.get(ck)
        if field is None:
            continue
        t = field.get("type")
        if t == "relation" and isinstance(v, list):
            out[ck] = [clone_page_id(x) for x in v if x]
        else:
            out[ck] = v
    return out


def _clean_view_fields(gv: Dict[str, Any]) -> Dict[str, Any]:
    """Fields WITHOUT emoji (cloned fields are also without emoji) → match: visible columns,
    filters, sort, grouping, and per-type config fields (chart/timeline/calendar)."""
    gv["visibleProperties"] = [_clean(x) for x in (gv.get("visibleProperties") or [])]
    for _f in gv.get("filters") or []:
        if _f.get("field"):
            _f["field"] = _clean(_f["field"])
    for _s in gv.get("sorts") or []:
        if _s.get("field"):
            _s["field"] = _clean(_s["field"])
    for key in ("groupBy", "xField", "yField", "dateField", "endDateField"):
        if gv.get(key):
            gv[key] = _clean(gv[key])
    return gv


# Notion's MCP also lists CHART views "suggested" by Notion that the user hasn't
# sees them as real tabs of the block (verified 2026-07-08: «Recursos» returned 3 charts
# nonexistent in the UI). There's no flag in the JSON to tell them apart → they're omitted by default.
SKIP_VIEW_TYPES = ("chart",)


def build_clone_views(notion_host_page_id: str, clone_host_table_id: str, view_block_id: str,
                      view_md: str,
                      resolve_clone_table: Callable[[str], Optional[Dict[str, Any]]],
                      skip_types: tuple = SKIP_VIEW_TYPES) -> List[Dict[str, Any]]:
    """ALL the gnosi-views (tabs) of a cloned `<database>` block, in Notion order.
    The FIRST is the block's anchor (the only one with an embed in the body) and carries the others in the
    `tabs` field — the frontend (DbViewEmbed) shows them as tabs, like Notion.

    Namespaced ids in the clone: the 1st tab keeps the legacy id
    `uuid5(view:{host}:{block})` (embeds from previous clones keep resolving);
    the following ones add Notion's `view_url` to it. Reused by the clone
    (resolve_view_markers) and by the INCREMENTAL import of missing views."""
    out: List[Dict[str, Any]] = []
    for j, meta in enumerate(nvr.parse_mcp_views(view_md or "")):
        if meta.get("view_type") in (skip_types or ()):
            continue
        ct = resolve_clone_table(meta.get("data_source_name"))
        if not ct:
            continue  # the target table hasn't been cloned → this tab can't be recreated
        name = meta.get("name") or meta.get("data_source_name") or ct.get("name") or "Vista"
        gv = nvr.build_gnosi_view(notion_host_page_id, ct, clone_host_table_id, meta, name)
        seed = f"view:{notion_host_page_id}:{view_block_id}"
        if j:
            seed += f":{meta.get('view_url') or j}"
        gv["id"] = str(uuid.uuid5(_CLONE_NS, seed))
        out.append(_clean_view_fields(gv))
    if out:
        out[0]["tabs"] = [gv["id"] for gv in out[1:]]
    return out


def resolve_view_markers(body_md: str, notion_host_page_id: str, clone_host_table_id: str,
                         *, fetch_view: Callable[[str], str],
                         resolve_clone_table: Callable[[str], Optional[Dict[str, Any]]]):
    """Replaces each `<!-- gnosi-notion-db:id -->` with the embed of the block's ANCHOR view;
    the rest of the tabs are created in the registry and hang off the anchor's `tabs`
    field (previously only the first one was created: «Cervell digital» lost 9 out of 10).

    `fetch_view(view_block_id)` → the view's MCP markdown. `resolve_clone_table(data_source_name)`
    → cloned table (dict with clone id) or None. Returns (body_with_embeds, [views_to_create]).
    
    """
    views: List[Dict[str, Any]] = []

    def repl(m):
        vid = m.group(1)
        try:
            gvs = build_clone_views(notion_host_page_id, clone_host_table_id, vid,
                                    fetch_view(vid), resolve_clone_table)
            if not gvs:
                return ""  # nothing resolvable → removes the marker
            views.extend(gvs)
            return nvr.view_embed(gvs[0]["id"])
        except Exception:
            return ""

    return _MARKER_RE.sub(repl, body_md), views


def clone_workspace(
    rest_client,                       # NotionClient (REST): schema + rows + values
    *,
    fetch_page: Callable[[str], str],  # MCP: page id → Notion markdown (body + views)
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
    registry_tables: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Clones the selected DBs into `target_folder` with clone ids and a fidelity body (MCP).

    `save_asset(url, prop_or_None, table) -> local_path|None`: downloads an attachment (file field or
    body image) and returns the `Assets/...` path; if None, no attachments are downloaded
    (Notion's URLs are left, which expire).
    `loose_page_types`: {notion_page_id: "wiki"|"dashboard"} of pages OUTSIDE a DB to clone with
    the corresponding is_dashboard label.
    
    """
    # `tables_total`/`pages_total`: denominators for the panel («processed/total»).
    # They get fixed when they're truly KNOWN: tables at startup (selected DBs),
    # pages once collection finishes (+ loose ones + sub-pages as the BFS
    # discover). Views and attachments don't have a known total upfront → no denominator.
    report = {"tables": 0, "pages": 0, "views": 0, "attachments": 0, "collected": 0,
              "tables_total": len(database_ids), "pages_total": 0,
              "errors": [], "warnings": [], "truncated": False}

    def _emit(phase: str, done: int, total: int) -> None:
        """Reports progress and checks for cancellation. Called at the start of each item in each
        pass → cooperative checkpoint for aborting. An error in the callback doesn't stop the clone,
        but a cancellation DOES (CloneAborted, propagated upward)."""
        if should_cancel is not None and should_cancel():
            raise CloneAborted()
        if progress_cb is None:
            return
        try:
            progress_cb(phase, done, total, report)
        except Exception:  # noqa: BLE001
            pass

    users = rest_client.list_users()

    # Map of data-source name (without icon) → cloned table, to resolve views.
    # SEED with the tables from the existing registry (`registry_tables`): in an INCREMENTAL clone
    # (e.g. only loose pages on top of an already-cloned vault) embedded views need to
    # resolve against the already-cloned tables; without the seed, the marker was discarded and the
    # dashboards were left without views. Pass 1 overwrites with the fresh tables.
    clone_tables_by_name: Dict[str, Dict[str, Any]] = {}
    for t in (registry_tables or []):
        key = nvr._strip_icon(t.get("name"))
        if key:
            clone_tables_by_name[key] = t

    # PASS 1: clone ALL table schemas before the pages, because a view might
    # reference a table that's cloned later (complete marker resolution).
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
                # The override comes from the MODAL (schema from /databases/{id}/schema): names WITH emoji and
                # relation_database_id from NOTION. Since it replaces the already-normalized props
                # from clone_table_schema, they need to be re-normalized: without this, relation fields
                # stopped matching clone_values/decorate and the values were left as ids of
                # raw Notion (real bug in the Recursos clone, 2026-07-02).
                _sel_clone_ids = {clone_table_id(d) for d in database_ids}
                for p in table.get("properties", []):
                    p["name"] = _clean(p.get("name"))
                    tgt = p.get("relation_database_id")
                    if p.get("type") == "relation" and tgt and tgt not in _sel_clone_ids:
                        p["relation_database_id"] = clone_table_id(tgt)
            # The folder is a REAL path segment: the raw Notion DB title can carry
            # OneDrive-forbidden chars (`<>:"/\|?*`), trailing dots/spaces or even
            # `/`/`..` (path traversal via mkdir). The registry keeps the raw name in
            # table["name"]; only the folder is sanitized.
            _tname = sanitize_vault_title(table.get('name'), fallback='Taula')
            # Without a subfolder (empty target_folder) → the table hangs directly from the vault root.
            table["folder"] = f"{target_folder}/{_tname}" if target_folder else _tname
            write_table(table)
            report["tables"] += 1
            clone_tables_by_name[nvr._strip_icon(table.get("name"))] = table
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"database": db_id, "stage": "schema", "error": str(e)})

    # WARNING: relation fields pointing to a NOT selected DB → will be left orphaned (must flag
    # all DBs for a complete clone). Guard-rail for the "one-shot" clone.
    cloned_ids = {t.get("id") for t in clone_tables_by_name.values()}
    for t in clone_tables_by_name.values():
        for p in t.get("properties", []):
            tgt = p.get("relation_database_id")
            if p.get("type") == "relation" and tgt and tgt not in cloned_ids:
                report["warnings"].append(
                    f"Table “{t.get('name')}” has relation field “{p.get('name')}” pointing "
                    "to an unselected database. These relations will have no destination; "
                    "select every database.")

    # PASS 2a: COLLECT rows + titles from ALL the DBs before writing, to have the map
    # Complete clone_id → title (needed to decorate relations as `[[Title|id]]`, even when
    # they point to a page that's cloned later or from another DB). Doesn't query Notion again
    # in pass 2b (reuses the collected rows).
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
                # Emission PER ROW (not just per DB): the collection downloads attachments and is the
                # long phase of the clone (up to 90s per slow attachment). Without this the panel
                # would stay at «collect 0/N, 0 pages» for whole minutes (it looked frozen) and
                # «Abort» didn't respond until switching DBs (the checkpoint is _emit).
                _emit("collect", di, len(db_by_id))
                try:
                    values = clone_values(page_to_values(row, users), table.get("properties", []))
                    # Downloads file-field attachments NOW while Notion's signed URL is
                    # FRESH. If left for pass 2b (as before), in long clones (>1h)
                    # S3 URLs expire (X-Amz-Expires=3600) and return 403 → lost attachments.
                    if save_asset is not None:
                        values, na = localize_values(
                            values, table.get("properties", []),
                            lambda u, p, _t=table: save_asset(u, p, _t))
                        report["attachments"] += na
                    title = _page_title(row) or "Untitled"
                    clone_titles[clone_page_id(row["id"])] = title
                    collected.append((table, row, values, title, rel_keys))
                    report["collected"] = len(collected)
                except Exception as e:  # noqa: BLE001
                    report["errors"].append({"page": row.get("id"), "error": str(e)})
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"database": db_id, "error": str(e)})

    def _id_to_title(rid):
        return clone_titles.get(rid)

    def _localize_file_markers(body: str, title: str, table: Dict[str, Any]) -> str:
        """Resolves the body's `gnosi-notion-file` markers (Notion-hosted attachment blocks).
        Always runs — even with downloads disabled the marker degrades to readable text so
        no raw marker reaches the editor. The signed URL is fetched per file at WRITE time
        (REST `get_block`): S3 URLs expire in ~1h, so URLs captured earlier would rot."""
        if not body or "gnosi-notion-file:" not in body:
            return body
        from backend.services.notion_attachments import resolve_file_markers

        def _fresh_url(block_id: str) -> Optional[str]:
            try:
                return block_file_url(rest_client.get_block(block_id))
            except Exception:  # noqa: BLE001 — deleted block / no permission → fallback text
                return None

        body, n_ok, n_fail = resolve_file_markers(
            body,
            _fresh_url if save_asset is not None else (lambda _bid: None),
            (lambda u, p, _t=table: save_asset(u, p, _t)) if save_asset is not None else None)
        report["attachments"] += n_ok
        if n_fail and save_asset is not None:
            report["warnings"].append(
                f"“{title}”: {n_fail} Notion attachment(s) could not be downloaded; "
                "the file name is retained as text.")
        return body

    def _fetch_page_checked(pid) -> str:
        """fetch_page with retries: the MCP returns '' on error (silently) and an empty fetch means
        LOST BODY (even an empty Notion page returns the <page> wrapper). If after
        3 attempts it's still empty, it's logged as an ERROR in the report (previously this went unnoticed:
        120 lost bodies in the clone from 2026-07-01)."""
        md = fetch_page(pid)
        for backoff in (2, 4):
            if md:
                return md
            time.sleep(backoff)
            md = fetch_page(pid)
        if not md:
            report["errors"].append({"page": pid, "stage": "mcp_empty",
                                     "error": "empty MCP fetch after three attempts (body not cloned)"})
        return md

    # Mentions/sub-pages WITHOUT a title in the MCP's markdown → the (pure) converter emits `[[<id
    # notion 32-hex>]]`. Here (where we DO have context) we resolve it to `[[Títol]]` (the renderer of the
    # body resolves wikilinks by title): first via clone_titles; if the id isn't from this clone,
    # fallback to REST (get_page, memoized). If it can't be resolved, it's left as-is.
    _wiki_id_re = re.compile(r"\[\[([0-9a-f]{32})\]\]")
    _missing_title_cache: Dict[str, Optional[str]] = {}

    def _resolve_body_links(body: str) -> str:
        if not body or "[[" not in body:
            return body
        def repl(m):
            nid = m.group(1)
            t = clone_titles.get(clone_page_id(nid))
            if not t:
                if nid not in _missing_title_cache:
                    try:
                        _missing_title_cache[nid] = _page_title(rest_client.get_page(nid)) or None
                    except Exception:  # noqa: BLE001
                        _missing_title_cache[nid] = None
                t = _missing_title_cache[nid]
            if not t:
                return m.group(0)
            safe = re.sub(r"[\[\]|#]", "", t)
            return f"[[{safe}]]"
        return _wiki_id_re.sub(repl, body)

    # Relation INVERSES: Notion shows both sides (dual relation). Since we already have all
    # the collected rows, we populate the inverse field of each target (best-effort and ONLY when it's
    # unambiguous, via relation_sync.resolve_inverse_relation). This way relations appear complete
    # without depending on any later synchronization.
    from backend.services import relation_sync
    table_by_id = {t.get("id"): t for t in clone_tables_by_name.values()}
    inverse_adds: Dict[str, Dict[str, set]] = {}   # target_clone_id → {inverse_field: {source_ids}}
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
            for tgt in v:    # tgt = clone id (already remapped by clone_values)
                inverse_adds.setdefault(tgt, {}).setdefault(inv_field, set()).add(src)

    # PASS 2b: write (body + views via MCP, attachments, relations decorated as `[[Title|id]]`)
    report["pages_total"] = len(collected)
    for pi, (table, row, values, title, rel_keys) in enumerate(collected):
        _emit("pages", pi, len(collected))
        try:
            props = table.get("properties", [])
            # (Attachments from file fields were already downloaded in pass 2a with fresh URLs.)
            body = ""
            try:
                page_md = _fetch_page_checked(row["id"])
                body = mcp_to_markdown(page_md) if page_md else ""
                host_pid = str(row["id"]).replace("-", "")
                body, gviews = resolve_view_markers(
                    body, host_pid, table["id"],
                    fetch_view=fetch_page,
                    resolve_clone_table=lambda n: clone_tables_by_name.get(nvr._strip_icon(n)))
                for gv in gviews:
                    write_view(gv)
                    report["views"] += 1
                # Download body images (remote ![alt](url) → local Assets/)
                if save_asset is not None and body:
                    from backend.services.notion_attachments import localize_body
                    body, nb = localize_body(body, lambda u, p: save_asset(u, p, table))
                    report["attachments"] += nb
                # Notion-hosted attachment blocks (markers): download + local link
                body = _localize_file_markers(body, title, table)
            except Exception as e:  # noqa: BLE001
                report["errors"].append({"page": row.get("id"), "stage": "mcp", "error": str(e)})
            # Merge the inverses that point to THIS page (dedup, preserving the direct ones)
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
            decorate_relation_wikilinks(meta, rel_keys, id_to_title=_id_to_title)  # id → [[Title|id]]
            report["attachments"] += _apply_icon_cover(meta, row, table, save_asset)  # icon + cover
            write_page({
                "id": clone_page_id(row["id"]),
                "title": title,
                "content": _resolve_body_links(body),
                "metadata": meta,
            })
            report["pages"] += 1
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"page": row.get("id"), "error": str(e)})

    def _clone_standalone(pid, page, extra_meta):
        """Clone a standalone page (loose or sub-page): body+views via MCP, attachments, icon+cover.
        The type (wiki/dashboard) comes ONLY from `extra_meta` (the user's explicit choice at the
        import). It is NOT inferred from having embedded views: Wiki articles (a card
        with a "Notes" toggle that embeds views) and DB container pages (just the
        view of the same-named table) also carry them, and inferring it would incorrectly send them to
        Dashboards (.Dashboards) instead of the Wiki / the DB section."""
        title = _page_title(page) or "Sense títol"
        clone_titles[clone_page_id(pid)] = title   # so that mentions between loose pages resolve
        body = ""
        try:
            page_md = _fetch_page_checked(pid)
            body = mcp_to_markdown(page_md) if page_md else ""
            host_pid = str(pid).replace("-", "")
            body, gviews = resolve_view_markers(
                body, host_pid, "",
                fetch_view=fetch_page,
                resolve_clone_table=lambda n: clone_tables_by_name.get(nvr._strip_icon(n)))
            for gv in gviews:
                write_view(gv)
                report["views"] += 1
            if save_asset is not None and body:
                from backend.services.notion_attachments import localize_body
                body, nb = localize_body(body, lambda u, p: save_asset(u, p, {"name": "Pàgines"}))
                report["attachments"] += nb
            body = _localize_file_markers(body, title, {"name": "Pàgines"})
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"page": pid, "stage": "mcp", "error": str(e)})
        meta = dict(extra_meta or {})
        report["attachments"] += _apply_icon_cover(meta, page, {"name": "Pàgines"}, save_asset)
        write_page({"id": clone_page_id(pid), "title": title,
                    "content": _resolve_body_links(body), "metadata": meta})
        report["pages"] += 1

    # PASS 3: pages OUTSIDE a DB (wiki/dashboard per the user's choice)
    _loose = list((loose_page_types or {}).items())
    report["pages_total"] += len(_loose)
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

    # PASS 4: SUB—PAGES (child_page blocks) - clone them as their own pages so nothing is left
    # orphaned. Cycle-safe (visited set) and bounded by max_pages. For one-shot migration.
    if follow_subpages:
        from collections import deque
        seed = [r["id"] for _, r, _, _, _ in collected] + list(loose_page_types or {})
        seen = {str(x).replace("-", "") for x in seed}
        to_scan = deque(seed)
        sub_done = 0
        # SCAN counters (parents queried / parents known): the total grows as
        # the BFS discovers sub-pages. They go into the report so the panel shows «scanning X/Y».
        report["scan_done"] = 0
        report["scan_total"] = len(to_scan)
        while to_scan and report["pages"] < max_pages:
            parent = to_scan.popleft()
            # Emitting PER PARENT (not just per discovered sub-page): scanning thousands of parents
            # with no new children (one REST call per parent) used to take 30-60 min, with the progress and the
            # frozen heartbeats — the user and the watchdog thought it was hung (2026-07-04 incident).
            # This also makes «Abort» responsive during the scan (the checkpoint is _emit).
            report["scan_done"] += 1
            _emit("subpages", sub_done, 0)
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
                # Unknown total (discovered via BFS): total=0 → indeterminate bar.
                # The global page denominator does grow with each discovery.
                report["pages_total"] += 1
                _emit("subpages", sub_done, 0)
                try:
                    page = rest_client.get_page(cid)
                    # The hierarchy is preserved ONLY via `parent_id` metadata (the file lives in
                    # Wiki/ all the same): the sidebar nests by parent_id, and table membership goes
                    # by folder — cf. directive `vault_subpages_hierarchy.md`. Without this,
                    # all sub-pages used to be flattened as loose Wiki pages.
                    _clone_standalone(cid, page, {"parent_id": clone_page_id(parent)})
                    sub_done += 1
                    to_scan.append(cid)   # recurse: sub-pages of the sub-page
                    report["scan_total"] += 1
                except Exception as e:  # noqa: BLE001
                    report["errors"].append({"page": cid, "stage": "subpage", "error": str(e)})

    _emit("done", report["pages"], report["pages"])
    return report
