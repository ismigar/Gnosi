import type { Field, ViewTable } from '../../components/Vault/page-view-modal/types';
import type { TableProperty } from '../../components/Vault/schemaTypes';
import type { Table } from './types';

function isViewField(property: TableProperty): property is TableProperty & Field {
  return typeof property.name === 'string'
    && (property.relation_database_id === undefined || typeof property.relation_database_id === 'string');
}

export function viewTables(tables: readonly Table[]): ViewTable[] {
  return tables.map(table => ({ ...table, properties: table.properties?.filter(isViewField) }));
}
