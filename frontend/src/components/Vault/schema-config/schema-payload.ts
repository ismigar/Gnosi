import type { Field, EditorFormat } from './types';
import { OPTION_FIELD_TYPES, TRANSLATABLE_FIELD_TYPES } from './constants';
import { normalizeOptions } from '../optionCatalogUtils';
import { readRecord } from './readers';
const MANAGED_CONFIG_KEYS = [
    'id', 'system', 'description', 'formula', 'compute', 'relationField', 'targetProperty',
    'aggregation', 'limit', 'fallbackValue', 'defaultFormula',
    'relation_database_id', 'cardinality', 'file_mode', 'storage_folder',
    'name_pattern', 'button_action', 'button_label', 'button_config', 'format', 'options',
    'translatable', 'default_option', 'catalog_ref', 'duration_enabled',
    'predecessors_enabled', 'skip_non_working_days', 'period_unit',
];

// Builds the serializable schema sent to the backend from
// the local state. Taken directly from the previous block of `handleSave`.
export function buildPayload(fields: Field[], enableTranslation: boolean) {
    const newSchemaObj: Record<string, unknown> = {};
    const visibleProperties: string[] = [];
    fields.forEach(f => {
        const cleanName = f.name.trim();
        newSchemaObj[cleanName] = f.type;
        // Round-trip of the registry config: keys that the UI doesn't
        // manage (role, option_groups…) are kept as-is.
        const config = { ...(f.rawConfig || {}) };
        for (const k of MANAGED_CONFIG_KEYS) Reflect.deleteProperty(config, k);
        // Persists the immutable field_id: it's the stable key for
        // referencing the field in notes, views, filters and sections.
        // It is never regenerated once assigned.
        if (f.id && /^fld_[0-9a-f]{8}$/.test(f.id)) {
            config.id = f.id;
        }
        if (f.description?.trim()) {
            config.description = f.description.trim();
        }
        // System-managed column (Drupal NID/URL): read-only in the
        // grid. The sync writes its value; the user doesn't edit it.
        if (f.system === true) {
            config.system = true;
        }
        if (f.type === 'formula') {
            config.formula = f.formula.trim();
        }
        if (f.type === 'virtual') {
            config.compute = f.compute.trim();
        }
        if (f.type === 'rollup') {
            config.relationField = f.relationField.trim();
            config.aggregation = (f.aggregation || 'count_values').trim();
            if (f.aggregation !== 'count_all') {
                config.targetProperty = f.targetProperty.trim();
            }
            if (String(f.limit || '').trim()) {
                config.limit = Number(f.limit);
            }
            if (Reflect.apply(String, undefined, [f.fallbackValue || '']).trim()) {
                config.fallbackValue = f.fallbackValue;
            }
        }
        if (f.defaultFormula.trim()) {
            config.defaultFormula = f.defaultFormula.trim();
        }
        if (f.type === 'relation') {
            if (f.relation_database_id) {
                config.relation_database_id = f.relation_database_id;
            }
            config.cardinality = f.cardinality || 'one-to-many';
        }
        if (f.type === 'files') {
            if (f.file_mode) config.file_mode = f.file_mode;
            if (f.storage_folder) config.storage_folder = f.storage_folder;
            if (f.name_pattern.trim()) config.name_pattern = f.name_pattern.trim();
        }
        if (f.type === 'period') {
            config.duration_enabled = f.duration_enabled !== false;
            config.predecessors_enabled = f.predecessors_enabled !== false;
            config.skip_non_working_days = f.skip_non_working_days !== false;
            config.period_unit = ['hours', 'days', 'years'].includes(f.period_unit || '') ? f.period_unit : 'days';
        }
        // Per-field format (override of the global one): only persisted if it has
        // meaningful values, so that a field without a format derives from the global one.
        if (f.type === 'number' && f.format) {
            const fmt: EditorFormat = {};
            if (f.format.kind && f.format.kind !== 'number') fmt.kind = f.format.kind;
            if (f.format.decimals != null && f.format.decimals !== '') fmt.decimals = Number(f.format.decimals);
            if (f.format.currency) fmt.currency = f.format.currency;
            if (Object.keys(fmt).length > 0) config.format = fmt;
        }
        if ((f.type === 'date' || f.type === 'datetime') && f.format?.dateFormat) {
            config.format = { ...readRecord(config.format), dateFormat: f.format.dateFormat };
        }
        // Option catalog for select/multi_select/status, in
        // rich {name,color,group} format. With `catalog_ref` (shared catalog)
        // the options live in the root registry and are NOT persisted to the
        // field. If the list ends up empty, we don't write the key so that the
        // field can keep deriving options from the existing values.
        if (OPTION_FIELD_TYPES.has(f.type)) {
            const catalogRef = (f.catalogRef || '').trim();
            if (catalogRef) {
                config.catalog_ref = catalogRef;
            } else {
                const cleaned = normalizeOptions(f.options);
                if (cleaned.length > 0) {
                    config.options = cleaned;
                }
            }
            const def = (f.defaultOption || '').trim();
            if (def && (catalogRef || normalizeOptions(f.options).some((o) => o.name === def))) {
                config.default_option = def;
            }
        }
        // We only persist `translatable: true` when the field is marked
        // and its type supports it. Otherwise, we don't add the key.
        if (enableTranslation && f.translatable && TRANSLATABLE_FIELD_TYPES.has(f.type)) {
            config.translatable = true;
        }
        if (Object.keys(config).length > 0) {
            newSchemaObj[`${cleanName}_config`] = config;
        }
        if (f.visible) {
            visibleProperties.push(cleanName);
        }
    });
    return { newSchemaObj, visibleProperties };
}
