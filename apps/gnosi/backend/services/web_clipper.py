"""Web Clipper as a configurable plugin: destination table and field mapping.

The clipper used to be hardwired: every clip became a note in `Clips/`. It is now
an internal plugin (`web-clipper` in `frontend/src/plugins/registry.js`) whose
state lives in `.gnosi/plugins.json`:

    disabled: ["web-clipper"]            → the endpoint refuses to clip (403)
    settings["web-clipper"] = {
        "table_id": "resources",         # empty → legacy `Clips/` note
        "url_property": "fld_…",         # column that receives the page URL
        "tags_property": "fld_…",        # column that receives the tags
        "content_property": "fld_…",     # column that receives the note/selection
        "fields": ["fld_…", …],          # columns the extension prompts for
    }

The three role columns accept "" (auto-detect from the schema) or `NO_MAPPING`
(explicitly unmapped).

This module is PURE (data in, data out): no FastAPI, no file I/O, no registry
loading — so the mapping rules are testable with pytest without booting the app.
The router (`backend/api/public_routes.py`) supplies the table and persists the
resulting record through the normal page-creation pipeline.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from backend.services import option_catalogs

PLUGIN_ID = "web-clipper"

# Explicit "leave this role unmapped" marker. Distinguishes «the user has not
# chosen» (empty → auto-detect) from «the user does not want this column fed».
NO_MAPPING = "__none__"

# Property types the browser extension can render as a form control. Computed
# columns (formula/rollup/virtual) are excluded because they are derived, and
# the pickers-driven ones (relation, files, image, autoria, zotero) because they
# need the app's own UI to produce a valid value.
PROMPTABLE_TYPES = (
    "text", "rich_text", "number", "select", "multi_select",
    "status", "date", "datetime", "checkbox", "url",
)

# Roles auto-detected when the user picks a destination table, so the common
# case ("Recursos") needs no manual mapping.
_URL_NAME_HINTS = {"url", "enllac", "enllaç", "link", "font", "fuente", "source", "web"}
_CONTENT_NAME_HINTS = {"nota", "notes", "note", "resum", "resumen", "summary", "descripcio",
                       "descripció", "descripcion", "description", "comentari", "comment"}


def _props(table: Optional[dict]) -> List[dict]:
    return [p for p in ((table or {}).get("properties") or []) if isinstance(p, dict)]


def _norm(name: Any) -> str:
    return str(name or "").strip().lower()


def find_property(table: Optional[dict], key: Any) -> Optional[dict]:
    """Resolves a property by id, current name or alias (never by position)."""
    k = str(key or "").strip()
    if not k:
        return None
    props = _props(table)
    for p in props:
        if p.get("id") == k:
            return p
    for p in props:
        if _norm(p.get("name")) == _norm(k):
            return p
    for p in props:
        if any(_norm(a) == _norm(k) for a in (p.get("aliases") or [])):
            return p
    return None


def is_promptable(prop: dict) -> bool:
    return str(prop.get("type") or "") in PROMPTABLE_TYPES


def suggest_mapping(table: Optional[dict]) -> Dict[str, str]:
    """Best-guess `url`/`tags`/`content` columns for a freshly picked table.

    The tags column reuses the semantic role from `option_catalogs` (explicit
    `config.role` first, name heuristics second) so it agrees with the rest of
    the app instead of inventing its own synonym list.
    """
    url_id = content_id = ""
    tags_prop = option_catalogs.find_role_prop(table or {}, option_catalogs.ROLE_TAGS)
    tags_id = str((tags_prop or {}).get("id") or "")
    for p in _props(table):
        ptype = str(p.get("type") or "")
        name = _norm(p.get("name"))
        if not url_id and ptype == "url":
            url_id = str(p.get("id") or "")
        if not content_id and ptype in ("rich_text", "text") and name in _CONTENT_NAME_HINTS:
            content_id = str(p.get("id") or "")
    if not url_id:
        for p in _props(table):
            if str(p.get("type") or "") == "text" and _norm(p.get("name")) in _URL_NAME_HINTS:
                url_id = str(p.get("id") or "")
                break
    return {"url_property": url_id, "tags_property": tags_id, "content_property": content_id}


def effective_mapping(table: Optional[dict], cfg: Optional[dict]) -> Dict[str, Optional[dict]]:
    """Resolves the url/tags/content roles to actual properties.

    An empty setting means "auto" (the heuristic above), NOT "unmapped": the
    common case must work with no manual mapping. `NO_MAPPING` is the explicit
    opt-out — e.g. tags that should stay in the frontmatter instead of going
    into a column.
    """
    cfg = cfg if isinstance(cfg, dict) else {}
    suggested = suggest_mapping(table)
    out: Dict[str, Optional[dict]] = {}
    for key in ("url_property", "tags_property", "content_property"):
        raw = str(cfg.get(key) or "").strip()
        if raw == NO_MAPPING:
            out[key] = None
        else:
            out[key] = find_property(table, raw or suggested.get(key))
    return out


def form_fields(
    table: Optional[dict],
    cfg: Optional[dict],
    catalogs: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    """Descriptors of the columns the extension must render, in schema order.

    Only the columns whitelisted in `settings.fields` are returned, minus the
    ones already fed automatically (url/tags/content) so the popup never asks
    twice for the same value. `catalogs` is the registry-level
    `option_catalogs` block, needed to resolve `config.catalog_ref` columns.
    """
    cfg = cfg if isinstance(cfg, dict) else {}
    wanted = [str(f) for f in (cfg.get("fields") or []) if str(f).strip()]
    if not wanted:
        return []
    auto = {
        str((p or {}).get("id") or "")
        for p in effective_mapping(table, cfg).values()
    }
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for key in wanted:
        prop = find_property(table, key)
        if not prop or not is_promptable(prop):
            continue
        pid = str(prop.get("id") or prop.get("name") or "")
        if not pid or pid in seen or pid in auto:
            continue
        seen.add(pid)
        entry: Dict[str, Any] = {
            "id": pid,
            "name": prop.get("name") or pid,
            "type": str(prop.get("type") or "text"),
        }
        if entry["type"] in option_catalogs.OPTION_TYPES:
            entry["options"] = option_catalogs.option_names(
                option_catalogs.get_prop_options(prop, catalogs)
            )
        out.append(entry)
    return out


def coerce_value(prop: dict, value: Any) -> Any:
    """Normalizes a value coming from the extension to what the column stores.

    The extension can only send strings (HTML inputs), so multi_select arrives
    comma-separated, checkbox as "true"/"false" and number as text. Unparseable
    numbers are dropped rather than persisted as text, which would break sorting
    and formulas downstream.
    """
    ptype = str(prop.get("type") or "text")
    if ptype == "multi_select":
        if isinstance(value, list):
            items = [str(v).strip() for v in value]
        else:
            items = [v.strip() for v in str(value or "").split(",")]
        return [v for v in items if v]
    if ptype == "checkbox":
        if isinstance(value, bool):
            return value
        return str(value or "").strip().lower() in ("1", "true", "yes", "on", "sí", "si")
    if ptype == "number":
        raw = str(value if value is not None else "").strip().replace(",", ".")
        if not raw:
            return None
        try:
            num = float(raw)
        except ValueError:
            return None
        return int(num) if num.is_integer() else num
    text = value if isinstance(value, str) else ("" if value is None else str(value))
    return text.strip()


def build_record(
    table: dict,
    cfg: Optional[dict],
    *,
    url: str,
    content: str = "",
    tags: Optional[List[str]] = None,
    fields: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], str]:
    """Builds the (metadata, body) of the record to create in `table`.

    The page title is NOT part of this: the caller passes it to `create_page`,
    which is what names the record. Keys are emitted as property **ids**;
    `create_page` rewrites them to the column's current name
    (`to_storage_names`), which is the canonical write boundary. Values whose
    column no longer exists are ignored instead of landing on disk as orphan
    frontmatter.
    """
    cfg = cfg if isinstance(cfg, dict) else {}
    metadata: Dict[str, Any] = {"table_id": str(table.get("id") or "")}
    tags = [t for t in (tags or []) if str(t).strip()]

    for key, value in (fields or {}).items():
        prop = find_property(table, key)
        if not prop or not is_promptable(prop):
            continue
        coerced = coerce_value(prop, value)
        if coerced in (None, "", []):
            continue
        metadata[str(prop.get("id") or prop.get("name"))] = coerced

    mapping = effective_mapping(table, cfg)

    url_prop = mapping.get("url_property")
    if url_prop and url:
        metadata[str(url_prop.get("id") or url_prop.get("name"))] = url

    tags_prop = mapping.get("tags_property")
    if tags_prop and tags:
        existing = metadata.get(str(tags_prop.get("id") or tags_prop.get("name"))) or []
        merged = list(dict.fromkeys([*(existing if isinstance(existing, list) else []), *tags]))
        metadata[str(tags_prop.get("id") or tags_prop.get("name"))] = merged
    elif tags:
        # No tags column: keep them as plain frontmatter, where the tag index
        # picks them up just like on a regular page.
        metadata["tags"] = tags

    content_prop = mapping.get("content_property")
    body = ""
    if content_prop and content:
        metadata[str(content_prop.get("id") or content_prop.get("name"))] = content
    else:
        body = content or ""
    if url and not (content_prop and content):
        body = f"[Font]({url})\n\n{body}".rstrip() + "\n"
    return metadata, body
