"""Despatxador: uneix el bus d'esdeveniments amb el sandbox de dades (fase 3).

Registra un dispatcher a `plugin_events` que, per cada esdeveniment emès, busca
els plugins de tercers instal·lats que (a) tenen entry `backend`, (b) declaren
l'esdeveniment a `manifest.events`, (c) estan actius i (d) tenen algun permís
concedit — i els executa al sandbox Node (`plugin_sandbox.run_event`).

També implementa els HANDLERS del host (vault.readPage/writePage, network.fetch)
que el sandbox exposa als plugins, cadascun ja gated per permís al sandbox. Els
imports de vault són mandrosos per evitar cicles (vault_routes importa serveis).

S'activa cridant `wire()` a l'arrencada del backend (server.py).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from backend.config.logger_config import get_logger
from backend.services import plugin_events, plugin_sandbox
from backend.services import plugin_system as ps

logger = get_logger(__name__)


def _config_dir() -> Path:
    from backend.api.vault_routes import get_p
    return get_p("GNOSI_CONFIG")


def _load_state() -> Dict[str, Any]:
    from backend.api.vault_routes import _load_plugins_state
    return _load_plugins_state()


# ---------------------------------------------------------------------------
# Handlers del host (implementacions reals de les crides RPC del sandbox).
# ---------------------------------------------------------------------------
def _handle_read_page(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    """Llegeix una pàgina i retorna forma ESTRUCTURADA (igual que la UI):
    {pageId, title, content (només el cos), metadata}."""
    from backend.api.vault_routes import find_page_path, _validate_safe_page_id, parse_frontmatter
    page_id = _validate_safe_page_id(str(args.get("pageId") or ""))
    path = find_page_path(page_id)
    if not path or not path.exists():
        raise ValueError(f"pàgina no trobada: {page_id}")
    metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"), path)
    return {
        "pageId": page_id,
        "title": (metadata or {}).get("title") or "",
        "content": body,
        "metadata": metadata or {},
    }


def _handle_write_page(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    """Actualitza una pàgina SENSE trepitjar el frontmatter (com el PATCH de la UI).

    Accepta `content` (nou cos) i/o `metadata` (patch fusionat). Abans això feia
    un overwrite del fitxer sencer amb `content` cru → es carregava el frontmatter
    i el sidecar; ara es preserven i es reescriu via `save_page_md`.
    """
    from backend.api.vault_routes import (
        find_page_path, _validate_safe_page_id, parse_frontmatter, save_page_md,
    )
    page_id = _validate_safe_page_id(str(args.get("pageId") or ""))
    path = find_page_path(page_id)
    if not path or not path.exists():
        raise ValueError(f"pàgina no trobada: {page_id}")
    metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"), path)
    metadata = metadata or {}

    new_content = args.get("content")
    if new_content is not None:
        if not isinstance(new_content, str):
            raise ValueError("content ha de ser una cadena de text")
        body = new_content
    new_meta = args.get("metadata")
    if new_meta is not None:
        if not isinstance(new_meta, dict):
            raise ValueError("metadata ha de ser un objecte")
        metadata = {**metadata, **new_meta}
    metadata["id"] = page_id  # l'id no es pot canviar via writePage

    save_page_md(path, metadata, body)
    # Notifica la resta del sistema que la pàgina ha canviat (i altres plugins).
    plugin_events.emit("page:updated", {"page_id": page_id, "source": "plugin"})
    return {"pageId": page_id, "written": len(body)}


def _handle_create_page(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    """Crea una pàgina nova al vault (opcionalment dins d'una carpeta relativa)."""
    import uuid
    from backend.api.vault_routes import (
        save_page_md, register_page_in_index, _get_unique_filepath, get_p,
    )
    title = str(args.get("title") or "Sense títol").strip() or "Sense títol"
    content = args.get("content") or ""
    if not isinstance(content, str):
        raise ValueError("content ha de ser text")
    vault = get_p("VAULT")
    target_dir = vault
    folder = str(args.get("folder") or "").strip().strip("/")
    if folder:
        if ".." in folder.split("/"):
            raise ValueError("folder invàlid")
        target_dir = (vault / folder)
        if vault.resolve() not in target_dir.resolve().parents and target_dir.resolve() != vault.resolve():
            raise ValueError("folder fora del vault")
    target_dir.mkdir(parents=True, exist_ok=True)
    page_id = str(uuid.uuid4())
    metadata = {"id": page_id, "title": title}
    fp = _get_unique_filepath(target_dir, title)
    save_page_md(fp, metadata, content)
    register_page_in_index(fp)
    plugin_events.emit("page:created", {"page_id": page_id, "title": title, "source": "plugin"})
    return {"pageId": page_id, "title": title}


def _handle_settings_get(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    from backend.api.vault_routes import _load_plugins_state
    state = _load_plugins_state()
    return {"settings": (state.get("settings") or {}).get(plugin_id) or {}}


def _handle_settings_set(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    from backend.api.vault_routes import _load_plugins_state, _save_plugins_state
    patch = args.get("settings")
    if not isinstance(patch, dict):
        raise ValueError("settings ha de ser un objecte")
    state = _load_plugins_state()
    settings = dict(state.get("settings") or {})
    settings[plugin_id] = {**(settings.get(plugin_id) or {}), **patch}
    state["settings"] = settings
    _save_plugins_state(state)
    return {"settings": settings[plugin_id]}


def _handle_query_db(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    """Retorna les files (pàgines) d'una taula del vault, com a llista de dicts.

    Limitat per evitar payloads enormes: `limit` (per defecte 200, màx 1000).
    """
    from backend.api.vault_routes import _get_pages_for_table
    table_id = str(args.get("tableId") or "").strip()
    if not table_id:
        raise ValueError("tableId és obligatori")
    try:
        limit = int(args.get("limit") or 200)
    except (TypeError, ValueError):
        limit = 200
    limit = max(1, min(limit, 1000))
    pages = _get_pages_for_table(table_id) or []
    rows = [{
        "id": p.id,
        "title": p.title,
        "metadata": p.metadata or {},
    } for p in pages[:limit]]
    return {"tableId": table_id, "rows": rows, "total": len(pages), "truncated": len(pages) > limit}


def _handle_list_tables(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    """Retorna les taules (bases de dades) del vault: id, nom i nombre de camps."""
    from backend.api.vault_routes import load_registry
    reg = load_registry() or {}
    tables = []
    for t in reg.get("tables", []) or []:
        tables.append({
            "id": t.get("id"),
            "name": t.get("name") or t.get("id"),
            "fields": len(t.get("properties") or []),
        })
    return {"tables": tables}


def _handle_network_fetch(args: Dict[str, Any], plugin_id: str) -> Dict[str, Any]:
    import requests
    url = str(args.get("url") or "")
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("url ha de ser http(s)")
    opts = args.get("opts") or {}
    method = str(opts.get("method") or "GET").upper()
    resp = requests.request(
        method, url,
        headers=opts.get("headers") or None,
        data=opts.get("body"),
        timeout=10,
    )
    return {"status": resp.status_code, "body": resp.text[:1_000_000]}


_HOST_HANDLERS = {
    "vault.readPage": _handle_read_page,
    "vault.writePage": _handle_write_page,
    "vault.createPage": _handle_create_page,
    "vault.queryDB": _handle_query_db,
    "vault.listTables": _handle_list_tables,
    "settings.get": _handle_settings_get,
    "settings.set": _handle_settings_set,
    "network.fetch": _handle_network_fetch,
}


# ---------------------------------------------------------------------------
# Dispatcher: esdeveniment → plugins de dades subscrits.
# ---------------------------------------------------------------------------
def _dispatch(event: str, payload: Dict[str, Any]) -> None:
    try:
        config_dir = _config_dir()
        state = _load_state()
    except Exception:  # noqa: BLE001
        logger.exception("plugin_dispatcher: no s'ha pogut carregar l'estat")
        return

    for entry in ps.discover_plugins(config_dir):
        manifest = entry.get("manifest")
        if not manifest or not manifest.get("backend"):
            continue
        if event not in (manifest.get("events") or []):
            continue
        pid = manifest["id"]
        if not ps.has_permission(state, pid, "vault:read") and \
           not ps.has_permission(state, pid, "vault:write") and \
           not ps.has_permission(state, pid, "network"):
            # Actiu però sense cap permís de backend concedit → res a fer.
            continue
        granted = ps.granted_permissions(state, pid)
        logger.info("plugin_dispatcher: %s → plugin %s", event, pid)
        try:
            res = plugin_sandbox.run_event(config_dir, manifest, granted, event, payload)
            if not res.get("ok"):
                logger.warning("plugin %s en %s: %s", pid, event, res.get("error"))
            for line in res.get("logs") or []:
                logger.info("[plugin %s] %s: %s", pid, line.get("level"), line.get("message"))
        except Exception:  # noqa: BLE001
            logger.exception("plugin_dispatcher: fallada executant %s", pid)


_wired = False


def wire() -> None:
    """Connecta handlers + dispatcher. Idempotent."""
    global _wired
    if _wired:
        return
    plugin_sandbox.set_host_handlers(_HOST_HANDLERS)
    plugin_events.set_plugin_dispatcher(_dispatch)
    _wired = True
    logger.info("plugin_dispatcher connectat (handlers + bus)")
