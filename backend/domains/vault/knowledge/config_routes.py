"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

from fastapi import APIRouter
from pydantic import BaseModel

from backend.domains.configuration import llm_wiki as _llm_wiki_configuration
from backend.domains.vault.knowledge.contracts import (
    BrainTableClearResponse,
    BrainTableCreateRequest,
    BrainTableCreateResponse,
    BrainTableSelectionRequest,
    BrainTableSelectionResponse,
    BrainTableStatusResponse,
)

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")
router = _strict_cast(APIRouter, _legacy.router)


def _contract_payload(
    payload: BaseModel | dict[_LegacyAny, _LegacyAny] | None,
) -> dict[_LegacyAny, _LegacyAny]:
    if isinstance(payload, BaseModel):
        return payload.model_dump(exclude_unset=True)
    return payload or {}


@router.get("/brain-table", response_model=BrainTableStatusResponse)
async def get_brain_table() -> _LegacyAny:
    """Return the designated Brain table status for Settings and UI gating.

    Resolve the per-vault designation in the active vault.
    """
    from backend.services import llm_wiki_config as bw

    cfg = bw.migrate_config()
    tid = cfg.get("brain_table_id")
    t = _legacy._table_by_id(tid) if tid else None
    return {
        "table_id": tid,
        "configured": bool(tid),
        "name": t.get("name") if t else None,
        "source_table_ids": [
            item.get("table_id") for item in cfg.get("source_tables") or [] if item.get("table_id")
        ],
        "index_field_ids": cfg.get("index_field_ids") or [],
    }


@router.post(
    "/brain-table",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainTableSelectionResponse,
)
async def set_brain_table(
    payload: BrainTableSelectionRequest = _legacy.Body(...),
) -> _LegacyAny:
    """Designate an existing table as the Brain and guarantee its
    knowledge schema (note type, sources, verification status, and more)."""
    from backend.services import llm_wiki_config as bw

    payload_data = _contract_payload(payload)
    table_id = str(payload_data.get("table_id") or "").strip()
    if not table_id:
        raise _legacy.HTTPException(status_code=400, detail="table_id is required")
    if not _legacy._table_by_id(table_id):
        raise _legacy.HTTPException(status_code=404, detail=f"Table {table_id} not found")
    locale = str(payload_data.get("ui_locale") or payload_data.get("language") or "en")
    _legacy._ensure_default_db_group()
    added = _legacy.ensure_brain_table_schema(table_id, locale)
    cfg = bw.migrate_config()
    cfg["ui_locale"] = locale
    cfg["brain_table_id"] = table_id
    cfg["target_table"] = table_id
    cfg["brain_roles"] = _legacy._infer_brain_roles(_legacy._table_by_id(table_id))
    for source in cfg.get("source_tables") or []:
        source["relation_property_id"] = _legacy.ensure_brain_source_relation(
            table_id, str(source.get("table_id") or ""), locale
        )
    cfg["source_contract_revision"] = _legacy.BRAIN_SOURCE_CONTRACT_REVISION
    cfg = bw.set_full_config(cfg)
    from backend.services import llm_wiki_indices

    await _legacy.asyncio.to_thread(llm_wiki_indices.ensure_system_pages, table_id, cfg)
    t = _legacy._table_by_id(table_id)
    return {
        "table_id": table_id,
        "configured": True,
        "name": t.get("name") if t else None,
        "columns_added": added,
    }


@router.post(
    "/brain-table/create",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainTableCreateResponse,
)
async def create_brain_table(
    payload: BrainTableCreateRequest | None = _legacy.Body(default=None),
) -> _LegacyAny:
    """Create and designate a new Brain table with the knowledge schema."""
    from backend.services import llm_wiki_config as bw

    payload_data = _contract_payload(payload)
    locale = str(payload_data.get("ui_locale") or payload_data.get("language") or "en")
    language = locale.split("-", 1)[0].lower()
    name = str(payload_data.get("name") or "").strip() or {
        "ca": "Cervell",
        "en": "Brain",
        "es": "Cerebro",
        "fr": "Cerveau",
    }.get(language, "Brain")
    new_id = str(_legacy.uuid.uuid4())
    table = {
        "id": new_id,
        "name": name,
        "database_id": "gnosi_vault_db",
        "properties": [
            _legacy._brain_property(role, field_name, property_type, brain_table_id=new_id)
            for role, field_name, property_type in _legacy._brain_schema(locale)
        ],
    }
    created = await _legacy.create_table(table)
    _legacy._ensure_default_db_group()
    cfg = bw.migrate_config()
    cfg["ui_locale"] = locale
    cfg["brain_table_id"] = created["id"]
    cfg["target_table"] = created["id"]
    cfg["brain_roles"] = _legacy._infer_brain_roles(_legacy._table_by_id(created["id"]))
    for source in cfg.get("source_tables") or []:
        source["relation_property_id"] = _legacy.ensure_brain_source_relation(
            created["id"], str(source.get("table_id") or ""), locale
        )
    cfg["source_contract_revision"] = _legacy.BRAIN_SOURCE_CONTRACT_REVISION
    cfg["index_field_ids"] = [
        field_id
        for role in ("areas", "tags")
        if (field_id := str(cfg["brain_roles"].get(role) or ""))
    ]
    cfg = bw.set_full_config(cfg)
    from backend.services import llm_wiki_indices

    await _legacy.asyncio.to_thread(llm_wiki_indices.ensure_system_pages, created["id"], cfg)
    return {
        "table_id": created["id"],
        "configured": True,
        "name": created.get("name"),
        "created": True,
    }


@router.delete(
    "/brain-table",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainTableClearResponse,
)
async def clear_brain_table() -> _LegacyAny:
    """Disable the Brain designation without deleting any table."""
    from backend.services import llm_wiki_config as bw

    bw.set_brain_table_id("")
    return {"table_id": None, "configured": False}


def _llm_wiki_config_response(cfg: dict[_LegacyAny, _LegacyAny]) -> dict[_LegacyAny, _LegacyAny]:
    """Enrich the persisted contract with validation and runtime capabilities."""
    from backend.services import llm_wiki_config as wiki_cfg
    from backend.services import llm_wiki_storage
    from backend.services.llm_wiki_extractors import capability_report

    brain_id = str(cfg.get("brain_table_id") or "")
    brain = _legacy._table_by_id(brain_id) if brain_id else None
    source_ids = [
        str(item.get("table_id") or "")
        for item in cfg.get("source_tables") or []
        if item.get("table_id")
    ]
    missing = []
    if brain_id and (not brain):
        missing.append({"kind": "brain_table", "id": brain_id})
    for source_id in source_ids:
        if not _legacy._table_by_id(source_id):
            missing.append({"kind": "source_table", "id": source_id})
    source_relation_ids = {
        str(item.get("relation_property_id") or "")
        for item in cfg.get("source_tables") or []
        if item.get("relation_property_id")
    }
    note_type_id = str((cfg.get("brain_roles") or {}).get("note_type") or "")
    eligible = wiki_cfg.eligible_index_properties(
        brain, excluded_ids=source_relation_ids | {note_type_id}
    )
    index_options = {str(prop.get("id")): _llm_wiki_property_options(prop) for prop in eligible}
    return {
        "config": cfg,
        "brain": {
            "table_id": brain_id or None,
            "name": brain.get("name") if brain else None,
            "configured": bool(brain),
        },
        "eligible_index_properties": eligible,
        "index_options": index_options,
        "capabilities": capability_report(),
        "validation": {
            "valid": bool(brain) and bool(source_ids) and (not missing),
            "missing": missing,
        },
        "processed_resources": llm_wiki_storage.processed_resources(source_ids),
        "resource_statuses": llm_wiki_storage.resource_statuses(source_ids),
        "enabled": _legacy._llm_wiki_enabled(_legacy._load_plugins_state()),
    }


def _llm_wiki_property_options(prop: dict[_LegacyAny, _LegacyAny]) -> list[dict[str, str]]:
    """Return canonical existing values for one categorical Brain property."""
    if str(prop.get("type") or "") == "relation":
        target_id = str(prop.get("relation_database_id") or "")
        return (
            [
                {
                    "label": str(getattr(page, "title", "") or ""),
                    "value": f"[[{getattr(page, 'title', '')}|{getattr(page, 'id', '')}]]",
                }
                for page in (_legacy._get_pages_for_table(target_id) or [])[:250]
                if getattr(page, "title", None) and getattr(page, "id", None)
            ]
            if target_id
            else []
        )
    raw_options = (
        prop.get("options")
        or (prop.get("config") or {}).get("options")
        or (prop.get("select") or {}).get("options")
        or []
    )
    return [
        {
            "label": str(option.get("name") if isinstance(option, dict) else option),
            "value": str(option.get("name") if isinstance(option, dict) else option),
        }
        for option in raw_options
        if str(option.get("name") if isinstance(option, dict) else option).strip()
    ]


@router.get("/llm-wiki/config", response_model=None)
async def get_llm_wiki_config() -> _LegacyAny:
    """Return the migrated v2 per-vault LLM Wiki configuration."""
    from backend.services import llm_wiki_config

    cfg = await _legacy.asyncio.to_thread(llm_wiki_config.migrate_config)
    if int(cfg.get("source_contract_revision") or 0) < _legacy.BRAIN_SOURCE_CONTRACT_REVISION:
        cfg = await _legacy.asyncio.to_thread(_legacy._reconcile_llm_wiki_source_contract, cfg)
    return await _legacy.asyncio.to_thread(_llm_wiki_config_response, cfg)


_LLM_WIKI_CONFIG_DEPENDENCIES = _llm_wiki_configuration.LlmWikiConfigDependencies(
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    infer_brain_roles=lambda table: _legacy._infer_brain_roles(table),
    property_options=lambda prop: _llm_wiki_property_options(prop),
    ensure_default_db_group=lambda: _legacy._ensure_default_db_group(),
    ensure_brain_schema=lambda table_id, locale: _legacy.ensure_brain_table_schema(
        table_id, locale
    ),
    ensure_source_relation=lambda brain_id, source_id, locale: _legacy.ensure_brain_source_relation(
        brain_id, source_id, locale
    ),
    config_response=lambda config: _llm_wiki_config_response(config),
    source_contract_revision=_legacy.BRAIN_SOURCE_CONTRACT_REVISION,
)


@router.put(
    "/llm-wiki/config",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def put_llm_wiki_config(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Validate and atomically save Brain, sources, roles, and index fields."""
    return await _llm_wiki_configuration.put_config(payload, _LLM_WIKI_CONFIG_DEPENDENCIES)


@router.post(
    "/llm-wiki/brain/create",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def create_standard_llm_wiki_brain(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(default=None),
) -> _LegacyAny:
    """Compatibility-namespaced alias used by the v2 Settings panel."""
    request = BrainTableCreateRequest.model_validate(payload or {})
    result = await create_brain_table(request)
    from backend.services import llm_wiki_config

    cfg = await _legacy.asyncio.to_thread(llm_wiki_config.load_config)
    return {**result, **await _legacy.asyncio.to_thread(_llm_wiki_config_response, cfg)}
