import type { FieldFormat } from './formatUtils';

export type VaultSchema = Readonly<Record<string, unknown>>;
export type VaultMetadata = Record<string, unknown>;

export interface SchemaFieldConfig extends Record<string, unknown> {
    format?: FieldFormat | null;
    id?: string;
}

export interface TableProperty extends Record<string, unknown> {
    name?: string;
    type?: string;
    formula?: unknown;
    compute?: unknown;
    defaultFormula?: unknown;
    relationField?: unknown;
    targetProperty?: unknown;
    aggregation?: unknown;
    relation_database_id?: unknown;
    cardinality?: unknown;
    limit?: unknown;
    fallbackValue?: unknown;
    file_mode?: unknown;
    storage_folder?: unknown;
    name_pattern?: unknown;
    translatable?: boolean;
    system?: boolean;
    button_action?: unknown;
    button_label?: unknown;
    button_config?: unknown;
    duration_enabled?: boolean;
    predecessors_enabled?: boolean;
    skip_non_working_days?: boolean;
    period_unit?: unknown;
    format?: unknown;
    options?: unknown;
    config?: Readonly<Record<string, unknown>>;
    id?: string;
}

export interface SchemaPage extends Record<string, unknown> {
    metadata?: Readonly<Record<string, unknown>> | null;
    folder?: unknown;
    created_time?: unknown;
    last_modified?: unknown;
}

export interface ViewSort {
    id: string;
    field: string;
    direction: string;
}

export interface SchemaView extends Record<string, unknown> {
    sort?: unknown;
    sorts?: unknown;
    filters?: unknown;
}
