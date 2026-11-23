"""One-hop note links for the active Vault without an on-demand reverse scan."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.domains.vault.links.parsing import extract_outlinks, normalize_ref, resolve_page_id
from backend.domains.vault.links.schemas import VaultLinkNeighborhoodResponse
from backend.domains.vault.links.state import link_index_state
from backend.domains.vault.pages.foundation import parse_frontmatter
from backend.domains.vault.pages.index_service import get_available_page_entries
from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import WorkspaceContext, get_workspace_context
from backend.utils.metadata_io import MetadataUnavailable, read_metadata_text


def _catalog(vault: Path) -> dict[str, tuple[Path, str]] | None:
    # Home uses this same navigation index to choose its center. Its reader
    # can reopen a persisted catalog without discovering any files.
    entries = get_available_page_entries(vault)
    if entries is None:
        with link_index_state.lock:
            if not link_index_state.built or link_index_state.vault_key != str(vault):
                return None
            entries = [dict(meta, id=note_id) for note_id, meta in link_index_state.page_meta_by_id.items()]
    notes: dict[str, tuple[Path, str]] = {}
    for entry in entries:
        path = Path(str(entry.get("path") or ""))
        page_id = entry.get("id")
        if page_id and path.suffix.lower() == ".md" and path.is_relative_to(vault) and ".." not in path.parts:
            notes[str(page_id)] = (path, str(entry.get("title") or path.stem))
    return notes


def _incoming(vault: Path, page_id: str, catalog: dict[str, tuple[Path, str]]) -> tuple[list[str], bool]:
    with link_index_state.lock:
        if not link_index_state.built or link_index_state.vault_key != str(vault):
            return [], False
        indexed = {
            note_id for note_id, (path, _title) in catalog.items()
            if link_index_state.page_meta_by_id.get(note_id, {}).get("path") == str(path)
        }
        if page_id not in indexed:
            return [], False
        sources = link_index_state.backlinks_by_target.get(page_id, ())
        incoming = {source["id"] for source in sources if source["id"] != page_id and source["id"] in indexed}
    return sorted(incoming), len(indexed) == len(catalog)


def get_link_neighborhood(
    page_id: Annotated[str, Query(min_length=1, max_length=512)],
    context: WorkspaceContext = Depends(get_workspace_context),
) -> VaultLinkNeighborhoodResponse:
    """Read one Markdown note and use an already built reverse index when available."""
    vault = context.vault_path
    try:
        catalog = _catalog(vault)
    except (MetadataUnavailable, OSError) as exc:
        raise HTTPException(503, "The Vault navigation index is temporarily unavailable") from exc
    if catalog is None:
        raise HTTPException(503, "The Vault navigation index is not ready")
    center = catalog.get(page_id)
    if not center:
        raise HTTPException(404, "Note not found")
    path = center[0]
    try:
        if not path.resolve().is_relative_to(vault.resolve()):
            raise HTTPException(404, "Note not found")
        token = active_vault_path.set(vault)
        try:
            metadata, body = parse_frontmatter(read_metadata_text(path), path)
        finally:
            active_vault_path.reset(token)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Note not found") from exc
    except (MetadataUnavailable, OSError, UnicodeError) as exc:
        raise HTTPException(503, "Note content is temporarily unavailable") from exc
    if resolve_page_id(metadata, path) != page_id:
        raise HTTPException(404, "Note not found")

    targets = {normalize_ref(ref).lower() for ref in extract_outlinks(metadata, body)}
    outgoing = sorted(
        note_id for note_id, (note_path, title) in catalog.items()
        if note_id != page_id and not targets.isdisjoint((note_id.lower(), title.strip().lower(), note_path.stem.lower()))
    )
    incoming, complete = _incoming(vault, page_id, catalog)
    return VaultLinkNeighborhoodResponse(incoming=incoming, outgoing=outgoing, incoming_complete=complete)


def register_routes(router: APIRouter) -> None:
    router.add_api_route(
        "/link-neighborhood", get_link_neighborhood, methods=["GET"], response_model=VaultLinkNeighborhoodResponse,
    )
