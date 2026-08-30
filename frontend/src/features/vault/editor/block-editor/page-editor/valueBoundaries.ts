import type { PeriodInput } from '../../../../../shared/dates/projectPlanning';
import type { VaultPlanningNote, VaultPlanningSettings } from '../../../properties/vault-date-property/types';
import type { PageNote } from './types';
import type { normalizeRelationValues } from '../../../properties/relationItemUtils';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Keep JavaScript's historical display coercion at the metadata boundary. */
export function legacyText(value: unknown): string {
  return Reflect.apply(String, undefined, [value]);
}
export function inputValue(value: unknown): string | number | readonly string[] {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(legacyText);
  return legacyText(value);
}
export function arrayValues(value: unknown, scalar = false): unknown[] {
  return Array.isArray(value) ? value : scalar ? [value] : [];
}
export function previewTitle(value: unknown): string {
  const item = isRecord(value) ? value : {};
  return legacyText(item.title || item.name || item.text || item.id || value || '').trim();
}
type Scalar = string | number | bigint | boolean | null | undefined;
function isScalar(value: unknown): value is Scalar {
  return value == null || ['string', 'number', 'bigint', 'boolean'].includes(typeof value);
}
export function relationInput(value: unknown): Parameters<typeof normalizeRelationValues>[0] {
  if (Array.isArray(value)) return value.map((item: unknown) => isScalar(item) ? item : legacyText(item));
  return isScalar(value) ? value : legacyText(value);
}
export function periodInput(value: unknown): PeriodInput {
  if (isScalar(value) || value instanceof Date) return value;
  if (!isRecord(value)) return legacyText(value);
  const scalarKeys = ['actualEnd', 'actualStart', 'constraintDate', 'constraintType', 'deadline', 'durationDays', 'durationUnit', 'durationValue', 'end', 'endMode', 'mode', 'percentComplete', 'start', 'startMode'];
  const result: Record<string, unknown> = { ...value };
  for (const key of scalarKeys) if (!isScalar(result[key])) result[key] = legacyText(result[key]);
  if (Array.isArray(value.predecessorIds)) result.predecessorIds = value.predecessorIds.map((entry: unknown) => isScalar(entry) ? entry : legacyText(entry));
  else if (!isScalar(value.predecessorIds)) result.predecessorIds = legacyText(value.predecessorIds);
  if (Array.isArray(value.dependencies)) result.dependencies = value.dependencies.filter(isRecord).map(dependency => ({
    ...dependency,
    lagMinutes: isScalar(dependency.lagMinutes) ? dependency.lagMinutes : legacyText(dependency.lagMinutes),
    predecessorId: isScalar(dependency.predecessorId) ? dependency.predecessorId : legacyText(dependency.predecessorId),
    type: isScalar(dependency.type) ? dependency.type : legacyText(dependency.type),
  }));
  // Every field read by the period adapter was validated above; retain extension fields.
  return result;
}
export function planningNotes(notes: readonly PageNote[]): VaultPlanningNote[] {
  return notes.map(note => ({
    ...note, metadata: note.metadata
      ? Object.fromEntries(Object.entries(note.metadata).map(([key, value]) => [key, Array.isArray(value) ? value.map(legacyText) : periodInput(value)]))
      : undefined
  }));
}
export function planningSettings(value: unknown): VaultPlanningSettings {
  const next: Record<string, unknown> = isRecord(value) ? { ...value } : {};
  for (const key of ['hours_per_day', 'task_table_id', 'workday_start']) if (!isScalar(next[key])) next[key] = legacyText(next[key]);
  for (const key of ['holidays', 'working_weekdays']) if (Array.isArray(next[key])) next[key] = next[key].map((item: unknown) => isScalar(item) ? item : legacyText(item));
  return next;
}
export function dateValue(value: unknown): Date | string | number | null | undefined {
  return value == null || value instanceof Date || typeof value === 'string' || typeof value === 'number' ? value : legacyText(value);
}
