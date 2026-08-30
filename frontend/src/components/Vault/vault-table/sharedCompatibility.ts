import type { ReactNode } from 'react';
import { useVaultViewData } from '../../../hooks/useVaultViewData';
import { withPeriodBoundaries, type PeriodInput } from '../../../utils/projectPlanning';
import { applyDefaultFormulasToMetadata } from '../defaultFormulaUtils';
import { evaluateFormula } from '../formulaUtils';
import { normalizeRelationValues } from '../relationItemUtils';
import { evaluateRollup } from '../rollupUtils';
import { getTableRecordFocusPreparation } from '../tableRecordFocusUtils';
import type { VaultDatePropertyProps } from '../vault-date-property/types';
import { VaultDateProperty } from '../VaultDateProperty';
import { displayString } from './fieldConfig';
import type { TableCell, TableNote } from './types';

/** These shared readers already support imported objects at runtime, but their
 * historical declarations only admit scalars. Keep their exact implementation
 * and values; the principal can broaden those declarations independently. */
export const useTableViewData = useVaultViewData as (input: {
  pages: readonly TableNote[];
  schema: Readonly<Record<string, unknown>>;
  view: { filters: unknown[]; sort: readonly { field: string; direction: string; }[]; search: string; };
  searchTerm: string;
}) => { sortedPages: TableNote[]; filteredPages: TableNote[]; };
export const evaluateTableFormula = evaluateFormula as (
  formula: unknown, metadata: Readonly<Record<string, unknown>>, title: string,
) => unknown;
export const applyTableDefaults = applyDefaultFormulasToMetadata;
export const prepareTableRecordFocus = getTableRecordFocusPreparation as (input:
  Omit<Parameters<typeof getTableRecordFocusPreparation>[0], 'notes' | 'sortedNotes'> & {
    notes: readonly TableNote[]; sortedNotes: readonly TableNote[];
  }
) => ReturnType<typeof getTableRecordFocusPreparation>;
export const normalizeTableRelations = normalizeRelationValues as (value: unknown) => string[];
export const evaluateTableRollup = evaluateRollup as (values: readonly unknown[], aggregation: string) => unknown;
export const TableDateProperty = VaultDateProperty as (props:
  Omit<VaultDatePropertyProps, 'notes' | 'planningSettings' | 'value'> & {
    notes: readonly TableNote[]; planningSettings: unknown; value: unknown;
  }
) => ReactNode;

/** Date's legacy ToPrimitive path, including numbers/null and imported values. */
export function metadataDate(value: unknown): Date {
  const result: unknown = Reflect.construct(Date, [value]);
  if (!(result instanceof Date)) throw new TypeError('Invalid date constructor');
  return result;
}
/** Only valid React scalar/array values are returned. Object metadata follows
 * the original error path rather than silently becoming a different display. */
export function cellNode(value: unknown): ReactNode {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return (value as unknown[]).map(cellNode);
  throw new TypeError('Objects are not valid as a table cell child');
}
export function tableCell(value: { rowId?: unknown; field?: unknown; } | null): TableCell | null {
  return value && typeof value.rowId === 'string' && typeof value.field === 'string' ? { rowId: value.rowId, field: value.field } : null;
}
export function tablePeriod(value: unknown): PeriodInput {
  // withPeriodBoundaries only inspects known properties after its object guard.
  return value as PeriodInput;
}
export function tableText(value: unknown): string { return displayString(value ?? ''); }
export function tableClipboard(): Partial<Pick<Clipboard, 'readText' | 'writeText'>> | undefined {
  return navigator.clipboard;
}
export const updateTablePeriod = withPeriodBoundaries;
