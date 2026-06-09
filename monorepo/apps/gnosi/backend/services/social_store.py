"""Persistència de publicacions socials a una taula del Vault.

Substitueix els arrays en memòria (SCHEDULED_POSTS / POST_HISTORY) de
`social_routes.py`, que es perdien a cada reinici. Cada publicació (esborrany,
programada, publicada o fallida) és una fila d'una taula "Publicacions Socials"
del Vault, desada com a Markdown + frontmatter com qualsevol altre registre.

Reaprofita les funcions del Vault (`create_table`, `create_page`, `patch_page`)
via imports lazy per evitar dependències circulars (vault_routes no coneix
aquest mòdul; aquest sí el crida).

Tipus de camp deliberadament "segurs" (title/text/date): l'usuari pot promoure
'Estat' o 'Xarxes' a select/multi-select des de la UI sense que res es trenqui.
"""
import json
import uuid
import asyncio
import logging
from typing import Dict, List, Optional, Any

log = logging.getLogger(__name__)

# Identificadors estables de la taula d'historial.
SOCIAL_TABLE_ID = "gnosi_social_publications"
SOCIAL_TABLE_NAME = "Publicacions Socials"
SOCIAL_DB_ID = "gnosi_vault_db"

# Estats possibles d'una publicació.
STATUS_DRAFT = "esborrany"
STATUS_SCHEDULED = "programada"
STATUS_PUBLISHING = "publicant"
STATUS_PUBLISHED = "publicada"
STATUS_PARTIAL = "parcial"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelada"

# Noms de columna (les metadades es persisteixen per nom: vault_persist_by_name).
COL_STATUS = "Estat"
COL_NETWORKS = "Xarxes"
COL_ORIGIN = "Origen"
COL_MESSAGES = "Missatges"
COL_SCHEDULED = "Programada per"
COL_PUBLISHED = "Publicada el"


def _schema() -> List[Dict[str, Any]]:
    """Esquema fix de la taula. Les xarxes són DADES, no columnes."""
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
    """Crea (idempotent) la taula d'historial al registre i retorna el seu id."""
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
    # create_table fa upsert + crea carpeta d'assets + vista principal.
    await create_table(table)
    log.info(f"🆕 Taula '{SOCIAL_TABLE_NAME}' creada al registre ({SOCIAL_TABLE_ID}).")
    return SOCIAL_TABLE_ID


def _build_body(proposals: Dict[str, Any]) -> str:
    """Cos Markdown llegible amb el text de cada xarxa."""
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
    """Desa una publicació nova com a fila del Vault. Retorna l'id de la pàgina.

    `proposals`: {network: {"text": str, ...}} — el missatge final per xarxa.
    """
    from backend.api.vault_routes import create_page, PageSaveRequest

    await ensure_social_table()

    # Títol llegible: el de l'origen, o un tall del primer text.
    title = (source_title or "").strip()
    if not title:
        first = next(iter(proposals.values()), {})
        snippet = (first.get("text") if isinstance(first, dict) else str(first)) or "Publicació"
        title = snippet.strip().split("\n")[0][:60] or "Publicació"

    # Missatges: {network: {text}} — update_publication hi afegirà status/url/error.
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
    """Actualitza l'estat i/o els resultats per xarxa d'una publicació.

    `results`: {network: {"status": ..., "url": ..., "error": ...}} — es fusiona
    dins el camp Missatges existent (sense perdre el text original).
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
        # Llegim els missatges actuals per fusionar-hi els resultats.
        current: Dict[str, Any] = {}
        try:
            file_path = await asyncio.to_thread(find_page_path, page_id)
            if file_path and file_path.exists():
                raw = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
                meta, _ = parse_frontmatter(raw, file_path)
                current = json.loads(meta.get(COL_MESSAGES) or "{}")
        except Exception as exc:
            log.warning(f"update_publication: no he pogut llegir Missatges de {page_id}: {exc}")
        for net, res in results.items():
            entry = current.get(net) or {}
            entry.update(res or {})
            current[net] = entry
        patch_meta[COL_MESSAGES] = json.dumps(current, ensure_ascii=False)

    if not patch_meta:
        return
    await patch_page(page_id, PagePatchRequest(metadata=patch_meta), background_tasks)


async def list_publications(status: Optional[str] = None) -> List[Dict[str, Any]]:
    """Llegeix les publicacions de la taula (opcionalment filtrades per estat)."""
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
