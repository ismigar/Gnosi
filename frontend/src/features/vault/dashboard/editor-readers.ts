import type { PageMetadata, PageNote, PageOption, PageProperty, PagePropertyConfig, PageTable } from '../editor/block-editor/page-editor/types';
import type { FieldFormat } from '../../../shared/records/model/formatUtils';
import { isRecord } from './readers';
import type { Metadata, Page, Table } from './types';

const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string';

function isFieldFormat(value: unknown): value is FieldFormat | null | undefined {
  if (value === null || value === undefined) return true;
  return isRecord(value) && (value.dateFormat === null || optionalString(value.dateFormat))
    && (value.kind === null || optionalString(value.kind))
    && (value.decimals === undefined || value.decimals === null || typeof value.decimals === 'number');
}

function isPageOption(value: unknown): value is PageOption {
  return typeof value === 'string' || (isRecord(value) && typeof value.name === 'string'
    && optionalString(value.color) && optionalString(value.group));
}

function isPropertyConfig(value: unknown): value is PagePropertyConfig {
  return isRecord(value) && optionalString(value.id) && optionalString(value.description)
    && isFieldFormat(value.format)
    && (value.options === undefined || (Array.isArray(value.options) && value.options.every(isPageOption)));
}

function isPageProperty(value: unknown): value is PageProperty {
  return isPropertyConfig(value) && typeof value.name === 'string' && typeof value.type === 'string'
    && (value.config === undefined || isPropertyConfig(value.config))
    && optionalString(value.relation_database_id) && optionalString(value.file_mode)
    && optionalString(value.storage_folder) && optionalString(value.name_pattern);
}

export function editorMetadata(metadata: Metadata = {}): PageMetadata {
  // Retain all plugin fields; validate only the editor's named scalar fields.
  const scalarFields = new Set(['title', 'icon', 'cover', 'table_id', 'database_table_id', 'resolved_table_id']);
  return Object.fromEntries(Object.entries(metadata).filter(([key, value]) => {
    if (scalarFields.has(key)) return optionalString(value);
    return key !== 'is_dashboard' || value === undefined || typeof value === 'boolean';
  }));
}

export function editorNote(page: Page): PageNote {
  return { ...page, resolved_table_id: page.resolved_table_id || undefined, metadata: editorMetadata(page.metadata) };
}

export function editorTable(table: Table): PageTable {
  return { ...table, properties: table.properties?.map(property => ({ ...property, type: property.type || 'text' })).filter(isPageProperty) };
}
