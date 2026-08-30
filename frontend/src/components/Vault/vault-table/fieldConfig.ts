import type { LlmWikiConfiguration } from '../../../shared/api/brain';
import type { ResourceProcessingJob } from '../../../shared/api/resource-processing';
import type { FieldFormat } from '../formatUtils';
import { getFieldConfig } from '../schemaUtils';

export type TableLlmWikiConfig = NonNullable<LlmWikiConfiguration['config']> & {
  readonly processed_resources: Record<string, Record<string, unknown>>;
};
export type TableLlmWikiJobs = Record<string, Record<string, ResourceProcessingJob>>;
export function nestedRecords(value: unknown): Record<string, Record<string, unknown>> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))) : {};
}
export function resourceJobs(value: unknown): TableLlmWikiJobs {
  return Object.fromEntries(Object.entries(nestedRecords(value)).map(([table, rows]) => [table,
    Object.fromEntries(Object.entries(rows).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])).map(([id, job]) => [id, {
      ...job, phase: typeof job.phase === 'string' ? job.phase : undefined,
      running: typeof job.running === 'boolean' ? job.running : undefined,
    }])),
  ]));
}
export interface FieldAssignments extends Record<string, unknown> {
  readonly assignments?: readonly { readonly field?: string; readonly value?: unknown; }[];
}
export interface TableFieldConfig extends Record<string, unknown> {
  readonly id?: string;
  readonly format?: FieldFormat | null;
  readonly options?: readonly unknown[];
  readonly catalog_ref?: string;
  readonly relationField?: string;
  readonly targetProperty?: string;
  readonly aggregation?: string;
  readonly relation_database_id?: string;
  readonly storage_folder?: string;
  readonly name_pattern?: string;
  readonly file_mode?: string;
  readonly button_action?: string;
  readonly button_label?: string;
  readonly button_config?: FieldAssignments;
  readonly description?: string;
}
export interface TableFunctionality {
  readonly id: string;
  readonly action: string;
  readonly config: FieldAssignments;
  readonly label: string;
  readonly enabled: boolean;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Preserve JavaScript String coercion for imported scalar/array metadata. */
export function displayString(value: unknown): string {
  return Reflect.apply(String, undefined, [value]);
}
/** Open schema keys are validated at this component's boundary. */
export function getTableFieldConfig(schema: Readonly<Record<string, unknown>>, field: string): TableFieldConfig {
  const source = getFieldConfig(schema, field);
  let result: Record<string, unknown> = { ...source };
  const stringKeys = ['id', 'catalog_ref', 'relationField', 'targetProperty', 'aggregation', 'relation_database_id', 'storage_folder', 'name_pattern', 'file_mode', 'button_action', 'button_label', 'description'];
  result = Object.fromEntries(Object.entries(result).filter(([key, value]) => !stringKeys.includes(key) || typeof value === 'string'));
  if (!Array.isArray(result.options)) delete result.options;
  if (isRecord(result.button_config)) result.button_config = assignmentConfig(result.button_config);
  else delete result.button_config;
  return result;
}
export function assignmentConfig(value: object): FieldAssignments {
  const source: Record<string, unknown> = { ...value };
  return {
    ...source,
    ...(Array.isArray(source.assignments) ? { assignments: source.assignments.filter(isRecord).map(item => ({ ...item, field: typeof item.field === 'string' ? item.field : undefined })) } : {}),
  };
}
