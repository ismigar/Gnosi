import type { PeriodInput } from '../../../utils/projectPlanning';

export type VaultDatePropertyType = 'date' | 'datetime' | 'period';
export type PlanningScalar = string | number | bigint | boolean | null | undefined;
export type VaultMetadataValue = PeriodInput | readonly PlanningScalar[];

export interface VaultPlanningNote {
    readonly id: string;
    readonly metadata?: Readonly<Record<string, unknown>> | null;
    readonly resolved_table_id?: PlanningScalar;
    readonly title?: string | null;
    readonly [key: string]: unknown;
}

export interface VaultDateFieldConfig {
    readonly aliases?: readonly string[] | null;
    readonly id?: string | null;
    readonly period_unit?: unknown;
    readonly predecessors_enabled?: boolean | null;
    readonly skip_non_working_days?: boolean | null;
    readonly [key: string]: unknown;
}

export interface VaultPlanningSettings {
    readonly holidays?: readonly PlanningScalar[];
    readonly hours_per_day?: PlanningScalar;
    readonly task_table_id?: PlanningScalar;
    readonly workday_start?: PlanningScalar;
    readonly working_weekdays?: readonly PlanningScalar[];
    readonly [key: string]: unknown;
}

export interface VaultDatePropertyProps {
    readonly fieldConfig?: VaultDateFieldConfig;
    readonly fieldName?: string;
    readonly idToTitle?: Readonly<Record<string, string>>;
    readonly noteId?: string;
    readonly notes?: readonly VaultPlanningNote[];
    readonly onChange: (value: PeriodInput) => void;
    readonly onRruleChange?: ((value: string | null) => void) | null;
    readonly planningEnabled?: boolean;
    readonly planningSettings?: unknown;
    readonly rruleValue?: string | null;
    readonly type?: VaultDatePropertyType;
    readonly value?: unknown;
}

export interface PeriodEditorProps {
    readonly fieldConfig: VaultDateFieldConfig;
    readonly fieldName: string;
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly noteId: string;
    readonly notes: readonly VaultPlanningNote[];
    readonly onChange: (value: PeriodInput) => void;
    readonly planningEnabled: boolean;
    readonly planningSettings: unknown;
    readonly value: unknown;
}
