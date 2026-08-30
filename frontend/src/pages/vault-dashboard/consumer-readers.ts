import type { FilterValue } from '../../utils/vaultFilters';
import type { Field, ViewTable } from '../../components/Vault/page-view-modal/types';
import type { TableProperty } from '../../components/Vault/schemaTypes';
import { isRecord } from './readers';
import type { Page, Table } from './types';

// These consumers operate on JSON-like values; preserve valid nested values by
// identity rather than flattening arrays, relation objects or stable field IDs.
export function isFilterValue(value: unknown): value is FilterValue {
  if (value === null || value === undefined || ['string', 'number', 'bigint', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isFilterValue);
  return isRecord(value) && Object.values(value).every(isFilterValue);
}

export function filterRecord(value: Readonly<Record<string, unknown>> = {}): Record<string, FilterValue> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, FilterValue] => isFilterValue(entry[1])));
}

export function filterPage(page: Page) {
  const values = filterRecord(page);
  return { ...values, id: page.id, title: page.title, metadata: filterRecord(page.metadata) };
}

function isViewField(property: TableProperty): property is TableProperty & Field {
  return typeof property.name === 'string'
    && (property.relation_database_id === undefined || typeof property.relation_database_id === 'string');
}

export function viewTables(tables: readonly Table[]): ViewTable[] {
  return tables.map(table => ({ ...table, properties: table.properties?.filter(isViewField) }));
}
