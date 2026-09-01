"""Typed dependency composition for table rows, schemas and saved views."""

from __future__ import annotations

from dataclasses import dataclass

from backend.domains.vault.tables.api import TableCollectionDependencies
from backend.domains.vault.tables.lifecycle import (
    CreateTableDependencies,
    DeleteTableDependencies,
    RenameTableDependencies,
)
from backend.domains.vault.tables.options import OptionDependencies
from backend.domains.vault.tables.rows import (
    TableMetadataDependencies,
    TableRowQueryDependencies,
)
from backend.domains.vault.tables.schema import PropertyDependencies
from backend.domains.vault.views.api import ViewDependencies
from backend.domains.vault.views.schema import SchemaDependencies


@dataclass(frozen=True)
class TableDomainDependencies:
    """All runtime ports consumed by the table HTTP and row-query boundary."""

    collections: TableCollectionDependencies
    properties: PropertyDependencies
    create_table: CreateTableDependencies
    delete_table: DeleteTableDependencies
    rename_table: RenameTableDependencies
    options: OptionDependencies
    views: ViewDependencies
    folder_schema: SchemaDependencies
    row_queries: TableRowQueryDependencies
    row_metadata: TableMetadataDependencies


__all__ = ["TableDomainDependencies"]
