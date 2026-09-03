"""FastAPI boundary for databases, table rows, views and folder schemas."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables import api as table_collection_api
from backend.domains.vault.tables import lifecycle as table_lifecycle
from backend.domains.vault.tables import options as table_options
from backend.domains.vault.tables import schema as table_schema
from backend.domains.vault.tables.composition import TableDomainDependencies
from backend.domains.vault.tables.contracts import (
    DatabaseUpsertRequest,
    OptionCatalogDeleteResponse,
    RegistryRecord,
    TableOptionRemoveRequest,
    TableOptionRenameRequest,
    TablePropertyPatchRequest,
    TablePropertyPatchResponse,
    TableRenameRequest,
    TableUpsertRequest,
)
from backend.domains.vault.tables.security import get_workspace_context, require_role
from backend.domains.vault.views import api as vault_views
from backend.domains.vault.views import schema as vault_view_schema
from backend.domains.vault.views.contracts import (
    VaultViewInput,
    VaultViewResponse,
    ViewMutationResponse,
    ViewReorderRequest,
    ViewReorderResponse,
    ViewUsageResponse,
)

router = APIRouter(dependencies=[Depends(get_workspace_context)])
_dependencies: TableDomainDependencies | None = None


def configure(dependencies: TableDomainDependencies) -> None:
    """Install the single table-domain dependency graph during app composition."""
    global _dependencies
    _dependencies = dependencies


def _configured() -> TableDomainDependencies:
    if _dependencies is None:
        raise RuntimeError("Table routes have not been configured")
    return _dependencies


def register_routes(parent_router: APIRouter) -> None:
    """Expose domain routes through the historical flat parent inventory."""
    changed = False
    for route in router.routes:
        if route not in parent_router.routes:
            parent_router.routes.append(route)
            changed = True
    if changed:
        parent_router._mark_routes_changed()


@router.get("/databases", response_model=list[RegistryRecord])
async def list_databases() -> list[RegistryData]:
    return await table_collection_api.list_databases(_configured().collections)


@router.post(
    "/databases",
    dependencies=[Depends(require_role("editor"))],
    response_model=RegistryRecord,
)
async def create_database(db: DatabaseUpsertRequest = Body(...)) -> RegistryData:
    return await table_collection_api.create_database(
        db.registry_data(),
        _configured().collections,
    )


@router.delete(
    "/databases/{database_id}",
    dependencies=[Depends(require_role("admin"))],
    response_model=RegistryRecord,
)
async def delete_database(database_id: str) -> RegistryData:
    return await table_collection_api.delete_database(
        database_id,
        _configured().collections,
    )


@router.get("/tables", response_model=list[RegistryRecord])
async def list_tables(database_id: Optional[str] = None) -> list[RegistryData]:
    return await table_collection_api.list_tables(
        database_id,
        _configured().collections,
    )


def _ensure_main_view(
    registry: RegistryData,
    table_id: str,
) -> RegistryData | None:
    """Guarantee that ``table_id`` owns one canonical main view."""
    return table_schema.ensure_main_view(registry, table_id)


@router.post(
    "/tables",
    dependencies=[Depends(require_role("editor"))],
    response_model=RegistryRecord,
)
async def create_table(table: TableUpsertRequest = Body(...)) -> RegistryData:
    return await create_table_from_registry(table.registry_data())


async def create_table_from_registry(table: RegistryData) -> RegistryData:
    """Create a table from trusted internal registry data."""
    return await table_lifecycle.create_table(
        table,
        _configured().create_table,
    )


def _table_schema_signature(properties: object) -> str:
    """Return a deterministic signature for one ordered property schema."""
    return table_schema.table_schema_signature(properties)


def _schema_revision(value: object) -> int:
    """Parse a non-negative schema revision without trusting client types."""
    return table_schema.schema_revision(value)


def _reconcile_table_schema_revision(
    old_table: RegistryData,
    incoming_table: RegistryData,
) -> None:
    """Reject stale schema writes through the canonical table domain."""
    table_schema.reconcile_table_schema_revision(old_table, incoming_table)


def _create_table_locked(table: RegistryData) -> RegistryData:
    return table_lifecycle.create_table_locked(table, _configured().create_table)


@router.delete(
    "/tables/{table_id}",
    dependencies=[Depends(require_role("admin"))],
    response_model=RegistryRecord,
)
async def delete_table(
    table_id: str,
    background_tasks: BackgroundTasks,
    expected_table_revision: Optional[str] = None,
    expected_views_revision: Optional[str] = None,
    expected_asset_revision: Optional[str] = None,
) -> RegistryData:
    """Delete a table.

    Why background_tasks for the rmtree:
      The asset folders may live on cloud-synced storage (OneDrive FUSE)
      where deleting hundreds of files can take seconds-to-minutes. Doing
      it inline blocks the HTTP response → the frontend modal hangs in
      `isSubmitting=true` state, looking like the operation is broken.
      We update the registry synchronously (the user-visible source of
      truth) and queue the disk cleanup as a background task.
    """
    return await table_lifecycle.delete_table(
        table_id,
        background_tasks,
        expected_table_revision,
        expected_views_revision,
        expected_asset_revision,
        _configured().delete_table,
    )


@router.put(
    "/tables/{table_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=RegistryRecord,
)
async def rename_table(
    table_id: str,
    data: TableRenameRequest = Body(...),
) -> RegistryData:
    return await table_lifecycle.rename_table(
        table_id,
        data.registry_data(),
        _configured().rename_table,
    )


def _rename_table_locked(
    table_id: str,
    data: RegistryData,
) -> table_lifecycle.DeferredRewrite:
    """Rename a table while the canonical registry mutation lock is held."""
    return table_lifecycle.rename_table_locked(
        table_id,
        data,
        _configured().rename_table,
    )


def _rename_field_in_filter_tree(node: object, old: str, new: str) -> bool:
    """Recursively rewrite a field reference inside a filter tree."""
    return table_schema.rename_field_in_filter_tree(node, old, new)


def _rename_field_refs_in_view_like(container: object, old: str, new: str) -> bool:
    """Rewrite field-name references in a view or embedded section."""
    return table_schema.rename_field_refs_in_view_like(container, old, new)


def _propagate_property_rename(
    registry: RegistryData,
    table_id: str,
    old_name: str,
    new_name: str,
) -> int:
    """Propagate a property rename through canonical view configuration."""
    return table_schema.propagate_property_rename(
        registry,
        table_id,
        old_name,
        new_name,
    )


@router.patch(
    "/tables/{table_id}/properties/{field_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=TablePropertyPatchResponse,
)
async def patch_table_property(
    table_id: str,
    field_id: str,
    data: TablePropertyPatchRequest = Body(...),
) -> RegistryData:
    """
        Renames or updates non-structural attributes of a property identified
    by its immutable 'id'. Never changes the id.

    PERSISTENCE BY NAME: since pages store keys by the current name,
    renaming records the old name as an `alias` of the property. Rows with
    the old name keep resolving (via aliases) and migrate on their own to the new name on
    the next save — without rewriting any file here (instant, robust
    offline). See `vault_persist_by_name.md`.

    Accepted body (all optional):
      - name: new displayed name
      - type: new type (only if data migration is safe)
      - config: dict that gets merged with the existing config

    """
    return await table_schema.patch_table_property(
        table_id,
        field_id,
        {key: value for key, value in data.model_dump(exclude_unset=True).items()}
        if isinstance(data, TablePropertyPatchRequest)
        else data,
        _configured().properties,
    )


def _patch_table_property_locked(
    table_id: str,
    field_id: str,
    data: RegistryData,
) -> RegistryData:
    return table_schema.patch_table_property_locked(
        table_id,
        field_id,
        data,
        _configured().properties,
    )


def _find_table_and_prop(
    registry: RegistryData,
    table_id: str,
    field_ref: str,
) -> tuple[RegistryData, RegistryData]:
    """Return a table and property by table ID and field ID or name."""
    return table_options.find_table_and_property(registry, table_id, field_ref)


def _option_value_keys(prop: RegistryData) -> list[str]:
    """Candidate frontmatter keys for this field's value."""
    return table_options.option_value_keys(prop)


def _global_status_members(
    registry: RegistryData,
) -> list[tuple[RegistryData, RegistryData]]:
    """Return every table/property pair backed by the global status catalog."""
    return table_options.global_status_members(registry, _configured().options)


async def _rewrite_option_in_rows(
    table: RegistryData,
    prop: RegistryData,
    old: str,
    new: Optional[str],
) -> int:
    """Rewrite one option value in all rows of a table."""
    return await table_options.rewrite_option_in_rows(
        table,
        prop,
        old,
        new,
        _configured().options,
    )


@router.get("/tables/{table_id}/options/usage", response_model=RegistryRecord)
async def table_option_usage(table_id: str, field_id: str) -> RegistryData:
    """Usage counter per option (how many rows use each value) — feeds
    the option editor of the SchemaConfigModal."""
    return await table_options.table_option_usage(
        table_id,
        field_id,
        _configured().options,
    )


@router.post(
    "/tables/{table_id}/options/rename",
    dependencies=[Depends(require_role("editor"))],
    response_model=RegistryRecord,
)
async def rename_table_option(
    table_id: str,
    payload: TableOptionRenameRequest = Body(...),
) -> RegistryData:
    """Renames an option in the catalog AND in all rows that use it (the
    values are persisted by name → eager rewrite of the affected .md files).

    Body: ``{field_id, old, new}``. Returns the count of touched files.

    """
    return await table_options.rename_table_option(
        table_id,
        payload.registry_data(),
        _configured().options,
    )


@router.post(
    "/tables/{table_id}/options/remove",
    dependencies=[Depends(require_role("editor"))],
    response_model=RegistryRecord,
)
async def remove_table_option(
    table_id: str,
    payload: TableOptionRemoveRequest = Body(...),
) -> RegistryData:
    """Deletes an option from the catalog and from ALL rows that use it, clearing
    the value or REASSIGNING it to another option (Notion-style).

    Body: ``{field_id, value, reassign_to?}``. Returns touched files.

    """
    return await table_options.remove_table_option(
        table_id,
        payload.registry_data(),
        _configured().options,
    )


@router.get("/option-catalogs", response_model=RegistryRecord)
async def list_option_catalogs() -> RegistryData:
    return await table_options.list_option_catalogs(_configured().options)


@router.put(
    "/option-catalogs/{name}",
    dependencies=[Depends(require_role("editor"))],
    response_model=RegistryRecord,
)
async def put_option_catalog(
    name: str,
    payload: RegistryData = Body(...),
) -> RegistryData:
    """Creates or replaces a shared catalog. Body: ``{options: [...]}``."""
    return await table_options.put_option_catalog(
        name,
        payload,
        _configured().options,
    )


@router.delete(
    "/option-catalogs/{name}",
    dependencies=[Depends(require_role("editor"))],
    response_model=OptionCatalogDeleteResponse,
)
async def delete_option_catalog(name: str) -> RegistryData:
    """Deletes a shared catalog. 409 if any field still references it."""
    return await table_options.delete_option_catalog(
        name,
        _configured().options,
    )


def _view_payload(view: VaultViewInput | RegistryData) -> RegistryData:
    if isinstance(view, VaultViewInput):
        return {key: value for key, value in view.model_dump(exclude_unset=True).items()}
    return view


def _view_reorder_payload(body: ViewReorderRequest | RegistryData) -> RegistryData:
    if isinstance(body, ViewReorderRequest):
        return {key: value for key, value in body.model_dump().items()}
    return body


@router.get(
    "/views",
    response_model=list[VaultViewResponse],
    response_model_exclude_unset=True,
)
async def list_views(table_id: Optional[str] = None) -> list[RegistryData]:
    return await vault_views.list_views(table_id, _configured().views)


@router.post(
    "/views",
    dependencies=[Depends(require_role("editor"))],
    response_model=VaultViewResponse,
    response_model_exclude_unset=True,
)
async def create_view(view: VaultViewInput = Body(...)) -> RegistryData:
    return await vault_views.create_view(_view_payload(view), _configured().views)


@router.put(
    "/views/order",
    dependencies=[Depends(require_role("editor"))],
    response_model=ViewReorderResponse,
)
async def reorder_views(body: ViewReorderRequest = Body(...)) -> RegistryData:
    """Reorders a table's views according to the received order.

    Body: {"table_id": "...", "ordered_ids": ["v1", "v2", "v3"]}.
    Views from other tables keep their relative position. Views
    of the referenced table are placed at the end of the registry following
    the given order.

    """
    return await vault_views.reorder_views(
        _view_reorder_payload(body),
        _configured().views,
    )


@router.get(
    "/views/{view_id}",
    response_model=VaultViewResponse,
    response_model_exclude_unset=True,
)
async def get_view(view_id: str) -> RegistryData:
    return await vault_views.get_view(view_id, _configured().views)


@router.get("/views/{view_id}/usage", response_model=ViewUsageResponse)
async def get_view_usage(view_id: str) -> RegistryData:
    """Find all pages/notes in the vault where this view_id is embedded or referenced."""
    return await vault_views.get_view_usage(view_id, _configured().views)


@router.delete(
    "/views/{view_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=ViewMutationResponse,
)
async def delete_view(view_id: str) -> RegistryData:
    return await vault_views.delete_view(view_id, _configured().views)


@router.put(
    "/views/{view_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=ViewMutationResponse,
)
async def update_view(
    view_id: str,
    data: VaultViewInput = Body(...),
) -> RegistryData:
    return await vault_views.update_view(
        view_id,
        _view_payload(data),
        _configured().views,
    )


def _resolve_subpath_within_vault(folder: str, *segments: str) -> Path:
    """Resolve a subpath and reject traversal outside the active vault."""
    return vault_view_schema.resolve_subpath_within_vault(
        folder,
        *segments,
        dependencies=_configured().folder_schema,
    )


@router.post(
    "/schema",
    dependencies=[Depends(require_role("editor"))],
    response_model=RegistryRecord,
)
async def save_schema(
    folder: str,
    schema: RegistryData = Body(...),
) -> RegistryData:
    """
    Legacy route to save schemas per folder.
    Now we redirect it to table creation if needed, or save it as a local file.
    """
    return await vault_view_schema.save_schema(
        folder,
        schema,
        _configured().folder_schema,
    )


@router.get("/schema", response_model=RegistryRecord)
async def get_schema(folder: str) -> RegistryData:
    return await vault_view_schema.get_schema(folder, _configured().folder_schema)


__all__ = [
    "_create_table_locked",
    "_ensure_main_view",
    "_find_table_and_prop",
    "_global_status_members",
    "_option_value_keys",
    "_patch_table_property_locked",
    "_propagate_property_rename",
    "_reconcile_table_schema_revision",
    "_rename_field_in_filter_tree",
    "_rename_field_refs_in_view_like",
    "_rename_table_locked",
    "_resolve_subpath_within_vault",
    "_rewrite_option_in_rows",
    "_schema_revision",
    "_table_schema_signature",
    "configure",
    "create_database",
    "create_table",
    "create_view",
    "delete_database",
    "delete_option_catalog",
    "delete_table",
    "delete_view",
    "get_schema",
    "get_view",
    "get_view_usage",
    "list_databases",
    "list_option_catalogs",
    "list_tables",
    "list_views",
    "patch_table_property",
    "put_option_catalog",
    "register_routes",
    "remove_table_option",
    "rename_table",
    "rename_table_option",
    "reorder_views",
    "router",
    "save_schema",
    "table_option_usage",
    "update_view",
]
