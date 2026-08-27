"""Persistence of social posts in a Vault table.

Replaces the in-memory arrays (SCHEDULED_POSTS / POST_HISTORY) of
`social_routes.py`, which were lost on every restart. Each post (draft,
scheduled, published, or failed) is a row of a "Publicacions Socials"
table in the Vault, saved as Markdown + frontmatter like any other record.
The quoted table and field names are persisted data values. @language-example

Reuses the Vault functions (`create_table`, `create_page`, `patch_page`)
via lazy imports to avoid circular dependencies (vault_routes doesn't know
about this module; this module does call it).

Deliberately "safe" field types (title/text/date): the user can promote
'Estat' or 'Xarxes' to select/multi-select from the UI without anything breaking.
"""
import json
import uuid
import asyncio
import logging
from typing import Dict, List, Optional, Any

log = logging.getLogger(__name__)

# Stable identifiers for the history table.
SOCIAL_TABLE_ID = "gnosi_social_publications"
SOCIAL_TABLE_NAME = "Publicacions Socials"
SOCIAL_DB_ID = "gnosi_vault_db"

# Possible states of a post.
STATUS_DRAFT = "esborrany"
STATUS_SCHEDULED = "programada"
STATUS_PUBLISHING = "publicant"
STATUS_PUBLISHED = "publicada"
STATUS_PARTIAL = "parcial"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelada"

# Column names (metadata is persisted by name: vault_persist_by_name).
COL_STATUS = "Estat"
COL_NETWORKS = "Xarxes"
COL_ORIGIN = "Origen"
COL_MESSAGES = "Missatges"
COL_SCHEDULED = "Programada per"
COL_PUBLISHED = "Publicada el"


def _schema() -> List[Dict[str, Any]]:
    """Fixed schema of the table. Networks are DATA, not columns."""
    return [
        {"id": str(uuid.uuid4()), "name": "Títol", "type": "title"},
        {"id": str(uuid.uuid4()), "name": COL_STATUS, "type": "text"},
        {"id": str(uuid.uuid4()), "name": COL_NETWORKS, "type": "text"},
        {"id": str(uuid.uuid4()), "name": COL_ORIGIN, "type": "text"},
        {"id": str(uuid.uuid4()), "name": COL_MESSAGES, "type": "text"},
        {"id": str(uuid.uuid4()), "name": COL_SCHEDULED, "type": "date"},
        {"id": str(uuid.uuid4()), "name": COL_PUBLISHED, "type": "date"},
    ]


async def ensure_social_table() -> str:
    """Create (idempotently) the history table in the registry and return its id."""
    from backend.api.vault_routes import load_registry, create_table

    registry = load_registry()
    if any(t.get("id") == SOCIAL_TABLE_ID for t in registry.get("tables", [])):
        return SOCIAL_TABLE_ID

    table = {
        "id": SOCIAL_TABLE_ID,
        "name": SOCIAL_TABLE_NAME,
        "database_id": SOCIAL_DB_ID,
        "folder": SOCIAL_TABLE_NAME,
        "properties": _schema(),
    }
    # create_table does upsert + creates assets folder + main view.
    await create_table(table)
    log.info(f"🆕 Table '{SOCIAL_TABLE_NAME}' created in the registry ({SOCIAL_TABLE_ID}).")
    return SOCIAL_TABLE_ID


def _build_body(proposals: Dict[str, Any]) -> str:
    """Readable Markdown body with the text for each network."""
    lines: List[str] = []
    for net, data in (proposals or {}).items():
        text = data.get("text") if isinstance(data, dict) else str(data)
        lines.append(f"## {net}\n\n{text or ''}\n")
    return "\n".join(lines)


async def save_publication(
    *,
    networks: List[str],
    proposals: Dict[str, Any],
    background_tasks,
    status: str = STATUS_DRAFT,
    source_page_id: str = "",
    source_title: str = "",
    scheduled_time: str = "",
) -> str:
    """Saves a new post as a row in the Vault. Returns the page id.

    `proposals`: {network: {"text": str, ...}} — the final message per network.
    
    """
    from backend.api.vault_routes import create_page, PageSaveRequest

    await ensure_social_table()

    # Readable title: the source's title, or a truncated snippet of the first text.
    title = (source_title or "").strip()
    if not title:
        first = next(iter(proposals.values()), {})
        snippet = (first.get("text") if isinstance(first, dict) else str(first)) or "Publicació"
        title = snippet.strip().split("\n")[0][:60] or "Publicació"

    # Missatges: {network: {text}} — update_publication will add status/url/error to it.
    messages = {
        net: {"text": (proposals.get(net, {}) or {}).get("text", "") if isinstance(proposals.get(net), dict) else ""}
        for net in networks
    }

    metadata: Dict[str, Any] = {
        "database_table_id": SOCIAL_TABLE_ID,
        "table_id": SOCIAL_TABLE_ID,
        COL_STATUS: status,
        COL_NETWORKS: ", ".join(networks),
        COL_ORIGIN: source_page_id or "",
        COL_MESSAGES: json.dumps(messages, ensure_ascii=False),
        COL_SCHEDULED: scheduled_time or "",
        COL_PUBLISHED: "",
    }

    req = PageSaveRequest(title=title, content=_build_body(proposals), metadata=metadata)
    result = await create_page(req, background_tasks)
    return result.get("id")


async def update_publication(
    page_id: str,
    *,
    background_tasks,
    status: Optional[str] = None,
    results: Optional[Dict[str, Any]] = None,
    published_at: Optional[str] = None,
) -> None:
    """Updates the status and/or per-network results of a post.

    `results`: {network: {"status": ..., "url": ..., "error": ...}} — this is merged
    into the existing Missatges field (without losing the original text).
    
    """
    from backend.api.vault_routes import (
        find_page_path, parse_frontmatter, patch_page, PagePatchRequest,
    )

    patch_meta: Dict[str, Any] = {}
    if status is not None:
        patch_meta[COL_STATUS] = status
    if published_at is not None:
        patch_meta[COL_PUBLISHED] = published_at

    if results:
        # We read the current messages to merge the results into them.
        current: Dict[str, Any] = {}
        try:
            file_path = await asyncio.to_thread(find_page_path, page_id)
            if file_path and file_path.exists():
                raw = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
                meta, _ = parse_frontmatter(raw, file_path)
                current = json.loads(meta.get(COL_MESSAGES) or "{}")
        except Exception as exc:
            log.warning(f"update_publication: could not read messages for {page_id}: {exc}")
        for net, res in results.items():
            entry = current.get(net) or {}
            entry.update(res or {})
            current[net] = entry
        patch_meta[COL_MESSAGES] = json.dumps(current, ensure_ascii=False)

    if not patch_meta:
        return
    await patch_page(page_id, PagePatchRequest(metadata=patch_meta), background_tasks)


async def list_publications(status: Optional[str] = None) -> List[Dict[str, Any]]:
    """Read the table's posts (optionally filtered by status)."""
    from backend.api.vault_routes import _resolve_table_folder_from_metadata, parse_frontmatter

    folder = _resolve_table_folder_from_metadata({"database_table_id": SOCIAL_TABLE_ID})
    if not folder or not await asyncio.to_thread(folder.exists):
        return []

    def _scan() -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for md in folder.glob("*.md"):
            try:
                meta, _ = parse_frontmatter(md.read_text(encoding="utf-8"), md)
            except Exception:
                continue
            if not meta or meta.get("database_table_id") != SOCIAL_TABLE_ID:
                continue
            if status and meta.get(COL_STATUS) != status:
                continue
            out.append(meta)
        return out

    return await asyncio.to_thread(_scan)
