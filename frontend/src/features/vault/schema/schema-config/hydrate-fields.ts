import { getFieldConfig, getFieldType, getSchemaFieldNames } from '../../../../shared/records/model/schemaUtils';
import { normalizeOptions, STATUS_CATALOG_REF } from '../../../../shared/records/model/optionCatalogUtils';
import { generateFieldId } from './field-id';
import { readString, readNumberOrString, readFormat } from './readers';
import type { Field } from './types';
import type { VaultSchema } from '../../../../shared/records/model/schemaTypes';
export function hydrateFields(currentSchema: VaultSchema | null | undefined, initialVisibleProperties: readonly string[] | null): Field[] {
    return getSchemaFieldNames(currentSchema || {}).map((name) => {
                const cfg = getFieldConfig(currentSchema || {}, name);
                return {
                    // We reuse the immutable field_id from the config if it exists; otherwise
                    // we generate a new one that will be persisted on save.
                    id: cfg.id || generateFieldId(),
                    name,
                    description: readString(cfg.description) || '',
                    type: getFieldType(currentSchema || {}, name),
                    formula: readString(cfg.formula) || '',
                    compute: readString(cfg.compute) || '',
                    defaultFormula: readString(cfg.defaultFormula) || '',
                    relationField: readString(cfg.relationField) || '',
                    targetProperty: readString(cfg.targetProperty) || '',
                    aggregation: readString(cfg.aggregation) || 'count_values',
                    limit: readNumberOrString(cfg.limit),
                    fallbackValue: cfg.fallbackValue ?? '',
                    relation_database_id: readString(cfg.relation_database_id) || '',
                    cardinality: readString(cfg.cardinality) || 'one-to-many',
                    file_mode: readString(cfg.file_mode) || 'upload',
                    storage_folder: readString(cfg.storage_folder) || '',
                    name_pattern: readString(cfg.name_pattern) || '',
                    translatable: !!cfg.translatable,
                    system: !!cfg.system,
                    button_action: readString(cfg.button_action) || '',
                    button_label: readString(cfg.button_label) || '',
                    duration_enabled: cfg.duration_enabled !== false,
                    predecessors_enabled: cfg.predecessors_enabled !== false,
                    skip_non_working_days: cfg.skip_non_working_days !== false,
                    period_unit: ['hours', 'days', 'years'].includes(readString(cfg.period_unit)) ? readString(cfg.period_unit) : 'days',
                    format: readFormat(cfg.format),
                    // Rich catalog: normalizes legacy strings into {name,color,group}.
                    options: normalizeOptions(cfg.options),
                    defaultOption: readString(cfg.default_option) || '',
                    catalogRef: readString(cfg.catalog_ref) || (getFieldType(currentSchema || {}, name) === 'status' ? STATUS_CATALOG_REF : ''),
                    // Registry CRU config: buildPayload starts from it to do
                    // round-trip of keys that the UI doesn't manage (role,
                    // option_groups…) — without this, every save would erase them.
                    rawConfig: cfg,
                    visible: initialVisibleProperties ? initialVisibleProperties.includes(name) : true
                };
            });
}
