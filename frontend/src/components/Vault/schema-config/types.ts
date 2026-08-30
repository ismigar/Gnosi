import type { Dispatch, SetStateAction } from 'react';
import type { NormalizedOption, OptionColorName } from '../optionCatalogUtils';
import type { VaultSchema } from '../schemaTypes';

export type Setter<T> = Dispatch<SetStateAction<T>>;
export type AssignmentValue = string | string[] | number | boolean | null;
export interface Assignment extends Record<string, unknown> {
    field?: string;
    value?: AssignmentValue;
    custom?: boolean;
}
export interface ActionConfig extends Record<string, unknown> {
    assignments?: Assignment[];
    prompt?: string;
    target_field?: string;
    skill_id?: string;
}
export interface Functionality {
    id: string;
    label: string;
    action: string;
    enabled: boolean;
    config: ActionConfig;
}
export interface EditorFormat extends Record<string, unknown> {
    kind?: string;
    currency?: string;
    decimals?: number | string | null;
    dateFormat?: string;
}
export interface Field {
    id: string;
    name: string;
    type: string;
    description?: string;
    formula: string;
    compute: string;
    defaultFormula: string;
    relationField: string;
    targetProperty: string;
    aggregation: string;
    limit: string | number;
    fallbackValue: unknown;
    relation_database_id: string;
    cardinality: string;
    file_mode: string;
    storage_folder: string;
    name_pattern: string;
    translatable: boolean;
    system?: boolean;
    button_action: string;
    button_label: string;
    button_config?: ActionConfig;
    duration_enabled?: boolean;
    predecessors_enabled?: boolean;
    skip_non_working_days?: boolean;
    period_unit?: string;
    format?: EditorFormat;
    options: NormalizedOption[];
    defaultOption?: string;
    catalogRef?: string;
    rawConfig?: Record<string, unknown>;
    visible: boolean;
}
export interface RelationTable { id: string; name?: string; title?: string }
export interface VirtualComputer { compute: string; label?: string; description?: string }
export interface AgentSkill { id?: string; name?: string }
export interface DrupalContentType { machine: string; label?: string }
export interface DrupalField { field_name: string; label?: string; field_type?: string }
export type Mapping = Record<string, string>;
export type Catalogs = Record<string, NormalizedOption[]>;
export interface SaveOptions {
    enableSubitems: boolean;
    visibleProperties: string[];
    enableTranslation: boolean;
    enableDrupalSync: boolean;
    drupalBundle: string;
    drupalFieldMapping: Mapping;
    functionalities: Functionality[];
}
export interface SchemaConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    folder: string;
    tableName?: string;
    currentSchema?: VaultSchema | null;
    onSchemaUpdated?: (schema: Record<string, unknown>) => unknown;
    onSave?: (schema: Record<string, unknown>, options: SaveOptions) => unknown;
    initialEnableSubitems?: boolean;
    initialVisibleProperties?: readonly string[] | null;
    initialEnableTranslation?: boolean;
    initialEnableDrupalSync?: boolean;
    initialDrupalBundle?: string;
    initialDrupalFieldMapping?: Mapping | null;
    initialFunctionalities?: unknown;
    tableId?: string | null;
    availableTables?: readonly RelationTable[] | null;
}
export interface OptionTools {
    sharedCatalogs: Catalogs;
    fetchUsage?: ((fieldId: string) => Promise<Record<string, number>>) | null;
    renameEverywhere?: ((fieldId: string, oldValue: string, newValue: string, usage?: number | null) => Promise<unknown>) | null;
    removeEverywhere?: ((fieldId: string, value: string, reassignTo: string | null) => Promise<unknown>) | null;
    updateSharedCatalog?: (name: string, options: NormalizedOption[]) => Promise<void>;
}
export interface RemoveOptionState {
    isOpen: boolean;
    value: string | null;
    usageCount: number | null;
    protectedReason: string;
}
export interface OptionsEditorProps {
    options?: NormalizedOption[];
    onChange: (options: NormalizedOption[]) => void;
    fieldType?: string;
    groups?: string[];
    defaultOption?: string;
    onDefaultOptionChange?: (name: string) => void;
    optionTools?: OptionTools | null;
    fieldId?: string;
    catalogRef?: string;
    sharedCatalogs?: Catalogs;
    onLinkCatalog?: ((name: string) => void) | null;
}
export interface OptionRowProps {
    option: NormalizedOption;
    fieldType: string;
    groups: string[];
    usageCount?: number;
    isDefault: boolean;
    onRename: (oldName: string, newName: string) => void;
    onRemove: (name: string) => void;
    onSetColor: (name: string, color: OptionColorName) => void;
    onSetGroup: (name: string, group: string) => void;
    onSetDefault: (name: string) => void;
}
export interface FunctionalityEditorProps {
    functionality: Functionality;
    index: number;
    allFields: Field[];
    availableSkills: AgentSkill[];
    onUpdate: (index: number, patch: Partial<Functionality>) => void;
    onRemove: (index: number) => void;
    onProgramWithAi: (index: number) => void;
}
export type UpdateField = <K extends keyof Field>(index: number, key: K, value: Field[K]) => void;
export interface SortableFieldProps {
    field: Field;
    idx: number;
    allFields: Field[];
    handleUpdateField: UpdateField;
    handleRemoveField: (index: number) => void;
    allTables: readonly RelationTable[];
    currentTableName: string;
    virtualComputers: VirtualComputer[];
    enableTranslation: boolean;
    enableDrupalSync: boolean;
    drupalBundle: string;
    drupalFields: DrupalField[];
    drupalFieldMapping: Mapping;
    setDrupalFieldMapping: Setter<Mapping>;
    optionTools: OptionTools;
    projectPlanningEnabled: boolean;
    setAiActionModalFieldIndex: Setter<number | null>;
    setAiActionPrompt: Setter<string>;
    availableSkills: AgentSkill[];
}

export interface ToggleConfirmation {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: (() => void | Promise<void>) | null;
}
export interface RemoveFieldState { isOpen: boolean; index: number | null; name: string }
export interface AssignmentValueControlProps {
    value: AssignmentValue;
    onChange: (value: AssignmentValue) => void;
    fieldMeta?: Field;
    custom?: boolean;
    onCustomChange: (custom: boolean) => void;
}
