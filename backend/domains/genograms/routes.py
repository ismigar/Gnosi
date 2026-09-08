"""Authenticated, per-Vault preparation and read-only graph projection."""
from __future__ import annotations

import asyncio
from fastapi import APIRouter, Depends, HTTPException
from backend.services.workspace_service import get_workspace_context, require_role
from backend.services.plugin_access import require_plugins
from .contracts import GenogramConfig, GenogramGraphRequest, GenogramGraphResponse, GenogramSetupRequest, GenogramSetupResponse
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.views.row_resolution import resolve_row_ids
from .model import project, validate_network
from .locking import network_lock
from .storage import field_names, identity, network_tables, read_network, records, setup

router = APIRouter(prefix="/api/vault/genograms", tags=["Genograms"], dependencies=[Depends(get_workspace_context), Depends(require_plugins("genograms"))])


@router.post("/prepare", response_model=GenogramSetupResponse, dependencies=[Depends(require_role("editor"))])
async def prepare_genograms(request: GenogramSetupRequest) -> GenogramSetupResponse:
    return await asyncio.to_thread(setup, request.locale)


def graph(request: GenogramGraphRequest) -> GenogramGraphResponse:
    from backend.api import vault_routes as vault
    with network_lock():
        registry = vault.load_registry()
        ids = identity(registry)
        if request.table_id != ids.people_table_id:
            raise HTTPException(422, detail={"code": "genogram_people_table_required"})
        view: RegistryData | None = None
        config = request.config
        if request.view_id:
            view = next((v for v in records(registry.get("views")) if v.get("id") == request.view_id), None)
            if not view or view.get("table_id") != ids.people_table_id or view.get("type") != "genogram":
                raise HTTPException(404, detail="Genogram view not found")
            if config is None:
                config = GenogramConfig.model_validate(view.get("genogram") or {})
        config = config or GenogramConfig()
        raw_metadata: dict[str, RegistryData] = {}
        people, relations, issues = read_network(registry, raw_metadata)
        eligible_ids = request.eligible_ids
        if view is not None:
            matching = resolve_row_ids([{ "id": p.id, "metadata": raw_metadata.get(p.id, {}) } for p in people], view, None)
            eligible_ids = matching if eligible_ids is None else sorted(set(matching).intersection(eligible_ids))
        issues += validate_network(people, relations)
        invalid = {issue.record_id for issue in issues if issue.severity == "error"}
        valid_relations = [r for r in relations if r.id not in invalid and r.source not in invalid and r.target not in invalid]
        visible, hidden = project([p for p in people if p.id not in invalid], valid_relations, config, eligible_ids)
        tables = network_tables(registry)
        return GenogramGraphResponse(**ids.model_dump(), people=people, relations=relations, visible_ids=visible, hidden_connections=hidden, issues=issues, config=config, people_fields=field_names(tables["people"], "people"), relations_fields=field_names(tables["relations"], "relations"))


@router.post("/graph", response_model=GenogramGraphResponse)
async def query_genogram(request: GenogramGraphRequest) -> GenogramGraphResponse:
    return await asyncio.to_thread(graph, request)
