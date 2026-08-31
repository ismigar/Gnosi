"""Vault-backed readers for attached context references."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, cast

from backend.domains.agent.context_matching import (
    INVENTORY_TYPE_ALIASES,
    _normalized_phrase,
    _normalized_words,
)
from backend.domains.agent.context_refs import (
    MAX_INVENTORY_ROWS,
    MAX_SOURCE_CHARS,
    dashboard_view_ids,
    normalize_refs,
)
from backend.domains.vault.registry.state import RegistryData
from backend.utils.open_values import get_value

log = logging.getLogger(__name__)


def _vault_root() -> Optional[Path]:
    from backend.services.context_vars import get_active_vault_path

    vault = get_active_vault_path()
    return Path(vault).resolve() if vault else None


def _registry() -> Dict[str, Any]:
    from backend.api.vault_routes import load_registry

    try:
        typed_load_registry = cast(Callable[[], Dict[str, Any]], load_registry)
        return typed_load_registry() or {}
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not load the vault registry for agent context: %s", exc)
        return {}


def _table_pages(table_id: str) -> List[Any]:
    from backend.api.vault_routes import _get_pages_for_table

    try:
        list_pages = cast(Callable[[str], List[Any]], _get_pages_for_table)
        return list_pages(table_id) or []
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not list the pages of table %s: %s", table_id, exc)
        return []


def _page_body(page: Any) -> str:
    """Markdown body of a page, frontmatter stripped."""
    path = getattr(page, "path", None) or (page.get("path") if isinstance(page, dict) else None)
    if not path:
        return ""
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except Exception:  # noqa: BLE001
        return ""
    return raw.split("---", 2)[2] if raw.startswith("---") else raw


def _page_title(page: Any) -> str:
    if isinstance(page, dict):
        return str(page.get("title") or "")
    return str(getattr(page, "title", "") or "")


def _read_file_source(rel_path: str) -> str:
    """Reads an attached file. Attached files always live inside the vault."""
    root = _vault_root()
    if not root:
        return "Error: there is no active vault."
    # `rel_path` comes from the stored configuration, but the resolve+containment
    # check stays: a ref could have been hand-edited into `../../secrets`.
    target = (root / rel_path).resolve()
    if target != root and root not in target.parents:
        return f"Access denied: the file must be inside the active vault ({rel_path})."
    if not target.exists():
        return f"The attached file no longer exists: {rel_path}"
    if target.suffix.lower() == ".pdf":
        from backend.agent.vault_tools import read_pdf

        return cast(str, read_pdf.invoke({"path": rel_path, "max_chars": MAX_SOURCE_CHARS}))
    try:
        with target.open("r", encoding="utf-8", errors="replace") as handle:
            return handle.read(MAX_SOURCE_CHARS)
    except Exception as exc:  # noqa: BLE001
        return f"Error reading file {rel_path}: {exc}"


def _table_entry(table_id: str) -> Optional[Dict[str, Any]]:
    return next((t for t in _registry().get("tables", []) if t.get("id") == table_id), None)


def _tables_of_database(database_id: str) -> List[Dict[str, Any]]:
    return [t for t in _registry().get("tables", []) if t.get("database_id") == database_id]


def _table_view(table_id: str, scope: Any) -> Optional[RegistryData]:
    """Resolve an attached active view only inside its declared table."""
    scope = scope if isinstance(scope, dict) else {}
    view_id = str(scope.get("view_id") or "").strip()
    if not view_id:
        return None
    return next(
        (
            view
            for view in _registry().get("views", [])
            if str(view.get("id") or "") == view_id and str(view.get("table_id") or "") == table_id
        ),
        None,
    )


def _page_row(page: Any) -> RegistryData:
    metadata = (
        page.get("metadata") if isinstance(page, dict) else getattr(page, "metadata", None)
    ) or {}
    page_id = page.get("id") if isinstance(page, dict) else getattr(page, "id", "")
    return {
        "id": str(page_id or ""),
        "title": _page_title(page),
        "metadata": dict(metadata),
    }


def _table_rows(
    table_id: str, scope: Any = None
) -> Tuple[List[RegistryData], Optional[RegistryData]]:
    rows = []
    for page in _table_pages(table_id):
        row = _page_row(page)
        if not get_value(row.get("metadata") or {}, "is_template"):
            rows.append(row)
    view = _table_view(table_id, scope)
    if view:
        from backend.services.view_snapshot import resolve_rows

        rows = resolve_rows(rows, view, None)
    return rows, view


def _describe_table(
    table: Dict[str, Any],
    *,
    with_rows: bool = True,
    scope: Any = None,
) -> str:
    props = [p.get("name") for p in table.get("properties", []) if p.get("name")]
    rows, view = _table_rows(str(table.get("id")), scope)
    out = [
        f"Database «{table.get('name')}» (id: {table.get('id')})",
        f"Fields: {', '.join(props) if props else '(none)'}",
        f"Rows: {len(rows)}",
    ]
    if view:
        out.insert(
            1,
            f"Active view: {view.get('name') or view.get('id')} (id: {view.get('id')})",
        )
    if with_rows and rows:
        shown = rows[:MAX_INVENTORY_ROWS]
        out.append("Rows (title — id):")
        out += [f"- {row['title']} — {row['id']}" for row in shown]
        if len(rows) > len(shown):
            out.append(
                f"… and {len(rows) - len(shown)} more rows. Use `query_context_table` "
                "with pagination to enumerate the exact attached view."
            )
    return "\n".join(out)


def _read_page_ref(ref: Dict[str, Any]) -> str:
    from backend.agent.vault_tools import read_page

    return str(read_page.invoke({"page_id_or_title": ref["ref"]}))[:MAX_SOURCE_CHARS]


def _read_table_ref(ref: Dict[str, Any]) -> str:
    target = ref["ref"]
    table = _table_entry(target)
    return (
        _describe_table(table, scope=ref.get("scope"))
        if table
        else f"Database {target} no longer exists."
    )


def _read_database_ref(ref: Dict[str, Any]) -> str:
    target = ref["ref"]
    tables = _tables_of_database(target)
    if not tables:
        return f"Group {target} has no databases."
    return "\n\n".join(_describe_table(table, with_rows=False) for table in tables)


def _read_vault_ref(ref: Dict[str, Any]) -> str:
    del ref
    registry = _registry()
    databases = registry.get("databases", [])
    tables = registry.get("tables", [])
    lines = ["Attached vault content:", "", "Groups:"]
    lines += [f"- {item.get('name')} (id: {item.get('id')})" for item in databases] or ["(none)"]
    lines += ["", "Databases:"]
    lines += [f"- {item.get('name')} (id: {item.get('id')})" for item in tables] or ["(none)"]
    return "\n".join(lines)


def _read_url_ref(ref: Dict[str, Any]) -> str:
    from backend.agent.web_context import fetch_url_text, wrap_untrusted

    return wrap_untrusted(ref["ref"], fetch_url_text(ref["ref"]))


def _read_external_ref(ref: Dict[str, Any]) -> str:
    from backend.agent.context_sources import get_source

    target = ref["ref"]
    source = get_source(target)
    if not source:
        return f"External source «{target}» is no longer available."
    return (
        f"{source.LABEL}: {source.DESCRIPTION}\n"
        f"Search it with `search_context`, or read a specific reference "
        f"with `read_external_source('{target}', '<reference>')`."
    )


def _read_internal_ref(ref: Dict[str, Any]) -> str:
    from backend.agent.internal_sources import describe_internal_source
    from backend.agent.web_context import wrap_untrusted

    return wrap_untrusted(
        f"Gnosi {ref['label']} inventory",
        describe_internal_source(ref["ref"], ref.get("scope") or {}),
    )


def _read_notebook_ref(ref: Dict[str, Any]) -> str:
    from backend.services.notebook_service import inspect_notebook

    payload = inspect_notebook(
        ref["ref"],
        revision=int((ref.get("scope") or {}).get("revision") or 0),
    )
    return json.dumps(payload, ensure_ascii=False, default=str)


def _read_source(ref: Dict[str, Any]) -> str:
    readers = {
        "file": lambda value: _read_file_source(value["ref"]),
        "page": _read_page_ref,
        "table": _read_table_ref,
        "database": _read_database_ref,
        "vault": _read_vault_ref,
        "url": _read_url_ref,
        "source": _read_external_ref,
        "internal": _read_internal_ref,
        "notebook": _read_notebook_ref,
    }
    reader = readers.get(ref["type"])
    if reader is None:
        return f"Unknown source type: {ref['type']}"
    return reader(ref)


def expand_dashboard_context_refs(raw_refs: Any) -> List[Dict[str, Any]]:
    """Attach the one exact table view embedded by a dashboard page."""
    refs = normalize_refs(raw_refs)
    registry = _registry()
    views_by_id = {
        str(view.get("id") or ""): view
        for view in registry.get("views", [])
        if isinstance(view, dict) and view.get("id")
    }
    tables_by_id = {
        str(table.get("id") or ""): table
        for table in registry.get("tables", [])
        if isinstance(table, dict) and table.get("id")
    }
    expanded: List[Dict[str, Any]] = []
    for ref in refs:
        if ref.get("type") == "page":
            matching_views = [
                views_by_id[view_id]
                for view_id in dashboard_view_ids(_read_source(ref))
                if view_id in views_by_id
            ]
            if len(matching_views) == 1:
                view = matching_views[0]
                table_id = str(view.get("table_id") or "").strip()
                table = tables_by_id.get(table_id)
                if table:
                    expanded.append(
                        {
                            "id": f"dashboard-table:{ref['ref']}:{table_id}",
                            "type": "table",
                            "ref": table_id,
                            "label": str(table.get("name") or table.get("title") or table_id),
                            "scope": {
                                "view_id": str(view.get("id") or ""),
                                "view_name": str(view.get("name") or view.get("id") or ""),
                            },
                        }
                    )
        expanded.append(ref)
    return normalize_refs(expanded)


def _authorized_inventory_tables(refs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Resolve attached refs to unique authorized table scopes."""
    tables_by_id = {
        str(table.get("id") or ""): table
        for table in _registry().get("tables", [])
        if isinstance(table, dict) and table.get("id")
    }
    table_scopes: List[Tuple[str, Any, str]] = []
    for ref in refs:
        if ref["type"] == "table":
            table_scopes.append((ref["ref"], ref.get("scope"), ref["id"]))
        elif ref["type"] == "database":
            table_scopes += [
                (str(table.get("id")), None, ref["id"]) for table in _tables_of_database(ref["ref"])
            ]
        elif ref["type"] == "vault":
            table_scopes += [
                (str(table.get("id")), None, ref["id"]) for table in tables_by_id.values()
            ]
    authorized = []
    seen_tables = set()
    for table_id, scope, source_id in table_scopes:
        table_key = (table_id, json.dumps(scope or {}, sort_keys=True, default=str))
        if table_key in seen_tables:
            continue
        seen_tables.add(table_key)
        table = tables_by_id.get(table_id) or _table_entry(table_id) or {}
        authorized.append(
            {
                "table": table,
                "table_id": table_id,
                "scope": scope,
                "source_id": source_id,
            }
        )
    return authorized


def _searchable_page_records(
    refs: List[Dict[str, Any]],
    requested_types: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Return canonical pages plus their authorized table provenance."""
    records: List[Dict[str, Any]] = []
    seen = set()
    for authorized in _authorized_inventory_tables(refs):
        table = authorized["table"]
        table_id = authorized["table_id"]
        scope = authorized["scope"]
        source_id = authorized["source_id"]
        if requested_types and not _inventory_table_matches(table, requested_types):
            continue
        table_pages = _table_pages(table_id)
        view = _table_view(table_id, scope)
        if view:
            allowed_ids = {row["id"] for row in _table_rows(table_id, scope)[0]}
            table_pages = [page for page in table_pages if _page_row(page)["id"] in allowed_ids]
        for page in table_pages:
            row = _page_row(page)
            if get_value(row.get("metadata") or {}, "is_template"):
                continue
            path = getattr(page, "path", None) or (
                page.get("path") if isinstance(page, dict) else None
            )
            canonical_id = str(row.get("id") or "").strip()
            key = (
                canonical_id or str(path or "").strip() or (f"{table_id}:{row.get('title') or ''}")
            )
            if not key or key in seen:
                continue
            seen.add(key)
            records.append(
                {
                    "page": page,
                    "id": canonical_id,
                    "title": row.get("title") or "",
                    "metadata": row.get("metadata") or {},
                    "path": str(path or ""),
                    "source_id": source_id,
                    "table": {
                        "id": table_id,
                        "name": str(table.get("name") or table.get("title") or table_id),
                    },
                }
            )
    return records


def _searchable_pages(refs: List[Dict[str, Any]]) -> List[Any]:
    """Every page reachable from the attached refs, de-duplicated canonically."""
    return [record["page"] for record in _searchable_page_records(refs)]


def _inventory_table_matches(table: Dict[str, Any], requested_types: List[str]) -> bool:
    """Resolve user-facing type labels against canonical registry tables."""
    if not requested_types:
        return True
    table_words = set(
        _normalized_words(
            f"{table.get('id') or ''} {table.get('name') or ''}",
            minimum_length=1,
        )
    )
    table_phrase = " ".join(sorted(table_words))
    for requested in requested_types:
        requested_phrase = _normalized_phrase(requested)
        requested_words = set(_normalized_words(requested, minimum_length=1))
        if requested_phrase and (
            requested_words.issubset(table_words) or requested_phrase in table_phrase
        ):
            return True
        for category, aliases in INVENTORY_TYPE_ALIASES.items():
            normalized_aliases = {_normalized_phrase(alias) for alias in aliases}
            if requested_phrase not in normalized_aliases:
                continue
            if category == "source" and table_words.intersection(
                {
                    "font",
                    "fonts",
                    "fuente",
                    "fuentes",
                    "source",
                    "sources",
                    "ressource",
                    "ressources",
                    "recurs",
                    "recursos",
                    "resource",
                    "resources",
                }
            ):
                return True
            if category == "note" and (
                table_words.intersection({"nota", "notas", "note", "notes"})
                or {"cervell", "digital"}.issubset(table_words)
            ):
                return True
            if (
                category != "source"
                and category != "note"
                and any(
                    alias_words.issubset(table_words)
                    for alias_words in (
                        set(_normalized_words(alias, minimum_length=1)) for alias in aliases
                    )
                )
            ):
                return True
    return False
