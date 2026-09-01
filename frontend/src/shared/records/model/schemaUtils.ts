/**
 * schemaUtils.js
 * Utilities for managing and transforming Vault table schemas.
 *
 * Schema format:
 *   { fieldName: 'type', fieldName_config: { formula, relationField, ... } }
 */

import type {
    SchemaFieldConfig,
    SchemaPage,
    SchemaView,
    TableProperty,
    VaultMetadata,
    VaultSchema,
    ViewSort,
} from './schemaTypes';

export { isCalendarPage } from './pageClassification';
export {
    detectRecordSourceLang,
    getLanguageFieldName,
    normalizeLangCode,
} from './schemaLanguageUtils';
export type {
    SchemaFieldConfig,
    SchemaPage,
    SchemaView,
    TableProperty,
    VaultMetadata,
    VaultSchema,
    ViewSort,
} from './schemaTypes';

const RESERVED_KEYS_SUFFIX = '_config';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns all field names from the schema (excludes _config keys).
 * @param {Object} schema
 * @returns {string[]}
 */
export function getSchemaFieldNames(schema: VaultSchema = {}): string[] {
    return Object.keys(schema).filter(key => !key.endsWith(RESERVED_KEYS_SUFFIX));
}

/**
 * Returns the type of a schema field.
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {string}
 */
export function getFieldType(schema: VaultSchema = {}, fieldName: string): string {
    const val = schema[fieldName];
    if (!val) return 'text';
    if (typeof val === 'string') return val;
    if (isRecord(val) && typeof val.type === 'string') return val.type;
    return 'text';
}

/**
 * Returns the additional configuration for a field (for formulas, rollups, etc.).
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {Object}
 */
export function getFieldConfig(
    schema: VaultSchema = {},
    fieldName: string,
): SchemaFieldConfig {
    const config = schema[`${fieldName}${RESERVED_KEYS_SUFFIX}`];
    return isRecord(config) ? config : {};
}

/**
 * Builds a flat schema (object) from a list of table properties
 * (format used by the backend: [{ name, type, ...config }]).
 * @param {Array} tableProperties
 * @returns {Object}
 */
export function buildSchemaFromTableProperties(
    tableProperties: readonly TableProperty[] = [],
): Record<string, unknown> {
    const schema: Record<string, unknown> = {};
    tableProperties.forEach(prop => {
        if (!prop.name) return;
        schema[prop.name] = prop.type || 'text';
        const config: Record<string, unknown> = {};
        if (prop.formula) config.formula = prop.formula;
        if (prop.compute) config.compute = prop.compute;
        if (prop.defaultFormula) config.defaultFormula = prop.defaultFormula;
        if (prop.relationField) config.relationField = prop.relationField;
        if (prop.targetProperty) config.targetProperty = prop.targetProperty;
        if (prop.aggregation) config.aggregation = prop.aggregation;
        if (prop.relation_database_id) config.relation_database_id = prop.relation_database_id;
        if (prop.cardinality) config.cardinality = prop.cardinality;
        if (prop.limit !== undefined && prop.limit !== '') config.limit = prop.limit;
        if (prop.fallbackValue !== undefined && prop.fallbackValue !== '') config.fallbackValue = prop.fallbackValue;
        if (prop.file_mode) config.file_mode = prop.file_mode;
        if (prop.storage_folder) config.storage_folder = prop.storage_folder;
        if (prop.name_pattern) config.name_pattern = prop.name_pattern;
        if (prop.translatable === true) config.translatable = true;
        if (prop.system === true) config.system = true;
        if (prop.button_action) config.button_action = prop.button_action;
        if (prop.button_label) config.button_label = prop.button_label;
        if (prop.button_config) config.button_config = prop.button_config;
        if (prop.duration_enabled !== undefined) config.duration_enabled = prop.duration_enabled;
        if (prop.predecessors_enabled !== undefined) config.predecessors_enabled = prop.predecessors_enabled;
        if (prop.skip_non_working_days !== undefined) config.skip_non_working_days = prop.skip_non_working_days;
        if (typeof prop.period_unit === 'string' && ['hours', 'days', 'years'].includes(prop.period_unit)) config.period_unit = prop.period_unit;
        if (isRecord(prop.format)) config.format = prop.format;
        // Explicit select/multi_select/status options: the fixed catalog of
        // selectable values. There are two possible sources and they can diverge:
        //   - `config.options` (nested): written by the inline options PATCH.
        //   - `prop.options` (top level): written by the modal save.
        // The PATCH does NOT touch the top level, but the modal's save
        // replaces the entire table and erases the nested `config`. So, if
        // `config.options` exists, it's because the last write was a PATCH
        // (it's the freshest) → it takes priority. Otherwise, we use the top level. Without
        // this, creating/deleting an option inline wasn't reflected: the read
        // was picking up the old top-level value.
        const propOptions = Array.isArray(prop.config?.options) ? prop.config.options
            : (Array.isArray(prop.options) ? prop.options : null);
        if (propOptions && propOptions.length > 0) config.options = propOptions;
        if (prop.id) config.id = prop.id;
        if (Object.keys(config).length > 0) {
            schema[`${prop.name}${RESERVED_KEYS_SUFFIX}`] = config;
        }
    });
    return schema;
}

/**
 * Returns a field's immutable ID ('fld_xxxxxxxx') if it exists.
 * This ID is the stable key for referencing the field in notes,
 * filters, views, and sections, independent of its displayed name.
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {string|undefined}
 */
export function getFieldId(
    schema: VaultSchema = {},
    fieldName: string,
): string | undefined {
    const id = getFieldConfig(schema, fieldName).id;
    return typeof id === 'string' ? id : undefined;
}

/**
 * Returns the current name of a field given its immutable ID.
 * @param {Object} schema
 * @param {string} fieldId
 * @returns {string|undefined}
 */
export function getFieldNameById(
    schema: VaultSchema = {},
    fieldId: string,
): string | undefined {
    if (!fieldId) return undefined;
    for (const name of getSchemaFieldNames(schema)) {
        if (getFieldConfig(schema, name).id === fieldId) return name;
    }
    return undefined;
}

/**
 * Resolves a field reference that may come as a stable ID or as a name.
 * Returns { id, name } with both values when possible.
 * @param {Object} schema
 * @param {string} ref - id ('fld_*') or field name
 * @returns {{id: string|undefined, name: string|undefined}}
 */
export function resolveFieldRef(
    schema: VaultSchema = {},
    ref: string,
): { id: string | undefined; name: string | undefined } {
    if (!ref) return { id: undefined, name: undefined };
    if (typeof ref === 'string' && ref.startsWith('fld_')) {
        return { id: ref, name: getFieldNameById(schema, ref) };
    }
    return { id: getFieldId(schema, ref), name: ref };
}

/**
 * Reads a metadata value from a page by field ID or name.
 * Prioritizes ID; if not present, falls back to name (backward compatibility).
 * @param {Object} page - with metadata
 * @param {Object} schema
 * @param {string} ref - id or name
 */
export function getMetaValue(
    page: SchemaPage | null | undefined,
    schema: VaultSchema,
    ref: string,
): unknown {
    if (!page || !page.metadata) return undefined;
    const { id, name } = resolveFieldRef(schema, ref);
    if (id !== undefined && page.metadata[id] !== undefined) return page.metadata[id];
    if (name !== undefined && page.metadata[name] !== undefined) return page.metadata[name];
    return undefined;
}

/**
 * Resolves one read-only table system timestamp.
 *
 * The registered schema field is authoritative. Filesystem timestamps are
 * only fallbacks because migrations, cloud hydration, or metadata-only saves
 * can rewrite every Markdown file without changing the source record.
 *
 * @param {Object} page       page/record returned by the Vault API
 * @param {Object} schema     flat table schema
 * @param {'created_time'|'last_edited_time'} type
 * @param {string} fieldRef   optional explicit field name or stable field ID
 * @returns {*} resolved timestamp, or an empty string
 */
export function resolveSystemDateValue(
    page: SchemaPage | null | undefined,
    schema: VaultSchema = {},
    type: 'created_time' | 'last_edited_time',
    fieldRef = '',
): unknown {
    const metadata = page?.metadata || {};
    const registeredField = fieldRef || getSchemaFieldNames(schema)
        .find(name => getFieldType(schema, name) === type);
    const candidates = [
        registeredField ? getMetaValue(page, schema, registeredField) : undefined,
        metadata[type],
        type === 'created_time' ? metadata.created_at : metadata.last_edited_at,
        type === 'created_time' ? page?.created_time : page?.last_modified,
    ];
    return candidates.find(value => value !== undefined && value !== null && value !== '') ?? '';
}

/**
 * Returns a page whose top-level timestamps reflect registered system fields.
 * Existing objects are reused when no value changes.
 */
export function withResolvedSystemDates<Page extends SchemaPage>(
    page: Page,
    schema?: VaultSchema,
): Page;
export function withResolvedSystemDates(
    page: null | undefined,
    schema?: VaultSchema,
): null | undefined;
export function withResolvedSystemDates(
    page: SchemaPage | null | undefined,
    schema: VaultSchema = {},
): SchemaPage | null | undefined {
    if (!page || typeof page !== 'object') return page;
    const createdTime = resolveSystemDateValue(page, schema, 'created_time');
    const lastModified = resolveSystemDateValue(page, schema, 'last_edited_time');
    const patch: Pick<SchemaPage, 'created_time' | 'last_modified'> = {};
    if (createdTime && createdTime !== page.created_time) patch.created_time = createdTime;
    if (lastModified && lastModified !== page.last_modified) patch.last_modified = lastModified;
    return Object.keys(patch).length ? { ...page, ...patch } : page;
}

/**
 * Writes a metadata value using the current NAME as the key
 * (persistence by name: the .md never stores opaque 'fld_*' keys).
 * Removes any leftover 'fld_*' key for the same field. The backend
 * (to_storage_names) re-canonicalizes it again as a safety net.
 * Mutates and returns the metadata.
 */
export function setMetaValue(
    metadata: VaultMetadata | null | undefined,
    schema: VaultSchema,
    ref: string,
    value: unknown,
): VaultMetadata {
    metadata = metadata || {};
    const { id, name } = resolveFieldRef(schema, ref);
    if (name) {
        metadata[name] = value;
        if (id && id !== name && metadata[id] !== undefined) {
            Reflect.deleteProperty(metadata, id);
        }
    } else if (id) {
        metadata[id] = value;
    }
    return metadata;
}

/**
 * Converts a flat schema into a list of table properties
 * (format consumed by the SchemaConfigModal component).
 * @param {Object} schema
 * @returns {Array}
 */
export function buildTablePropertiesFromSchema(
    schema: VaultSchema = {},
): TableProperty[] {
    return getSchemaFieldNames(schema).map(name => {
        const config = getFieldConfig(schema, name);
        return {
            name,
            type: getFieldType(schema, name),
            ...config,
        };
    });
}

/**
 * Returns the schema entries as [name, type] pairs.
 * @param {Object} schema
 * @returns {Array<[string, string]>}
 */
export function getSchemaFieldEntries(
    schema: VaultSchema = {},
): Array<[string, string]> {
    return getSchemaFieldNames(schema).map(name => [name, getFieldType(schema, name)]);
}

/**
 * Normalizes a view's `sort` field into an array of sort orders.
 *
 * Views store `sort` in two historical forms: a single object
 * { field, direction } (default backend and frontend views) or an
 * array [{ id, field, direction }] (multi-sort from the ViewConfigModal).
 * All consumers (ViewConfigModal, VaultTable, and, indirectly,
 * useVaultViewData) work with arrays and do `sorts.map(...)`/iterate with
 * `for...of`, so we always normalize the input to avoid crashing or losing
 * the order when it arrives as an object. Discards entries without `field` and
 * assigns `direction: 'asc'` by default.
 *
 * @param {Object|Array|null|undefined} raw  raw value of `view.sort`
 * @returns {Array<{id: string, field: string, direction: string}>}
 */
export function normalizeSorts(raw: unknown): ViewSort[] {
    if (Array.isArray(raw)) {
        return raw
            .filter((sort): sort is Record<string, unknown> & { field: string } => isRecord(sort) && typeof sort.field === 'string' && sort.field.length > 0)
            .map((sort, index) => ({
                id: typeof sort.id === 'string' ? sort.id : `sort-${String(index)}`,
                field: sort.field,
                direction: typeof sort.direction === 'string' && sort.direction ? sort.direction : 'asc',
            }));
    }
    if (isRecord(raw) && typeof raw.field === 'string' && raw.field) {
        return [{
            id: typeof raw.id === 'string' ? raw.id : 'sort-0',
            field: raw.field,
            direction: typeof raw.direction === 'string' && raw.direction ? raw.direction : 'asc',
        }];
    }
    return [];
}

/**
 * EFFECTIVE order for a view, resolving the TWO registry keys.
 *
 * In addition to the two forms of `normalizeSorts`, the registry has two
 * historical KEYS: `sorts` (full array — written by the Notion import, the
 * PageViewModal, and the embed sections) and `sort` (legacy; the modal saves
 * only the FIRST criterion there for compat). `sorts` is preferred — parity with the
 * backend (view_snapshot: `view.get("sorts") or [view["sort"]]`) and with
 * DbViewEmbed. Reading only `view.sort`, as the dashboard renderers used to do,
 * IGNORED the configured order of all imported views (none of them has a
 * singular `sort`).
 *
 * If the view has an explicit but empty sort config (the user has removed all
 * criteria: the modal saves `sorts: []`), it is respected as "no order"
 * and the fallback is NOT applied.
 *
 * @param {Object|null|undefined} view      the registry view
 * @param {{field: string, direction: string}|null} fallback  default order
 *        when the view has NO sort config at all (e.g. last_modified desc)
 * @returns {Array<{id: string, field: string, direction: string}>}
 */
export function resolveViewSorts(
    view: SchemaView | null | undefined,
    fallback: unknown = null,
): ViewSort[] {
    const plural = normalizeSorts(view?.sorts);
    const resolved = plural.length ? plural : normalizeSorts(view?.sort);
    if (resolved.length) return resolved;
    if (view?.sort || view?.sorts) return [];
    return fallback ? normalizeSorts(fallback) : [];
}

/**
 * EFFECTIVE filters for a view, always as an array.
 *
 * `view.filters` has two historical forms: the flat array [{field, operator,
 * value}] (the one the modal saves) and the wrapped object {conditions: [...]}
 * (a form the toolbar already accounts for in the count). The engine
 * (`matchesFilters`) does `filters.every(...)`: passing it the object throws a
 * TypeError and crashes the view at the boundary. Single normalization point for
 * all renderers.
 *
 * @param {Object|null|undefined} view  the registry view
 * @returns {Array} list of filters (never null)
 */
export function resolveViewFilters(view: SchemaView | null | undefined): unknown[] {
    const f = view?.filters;
    if (Array.isArray(f)) return f.filter(Boolean);
    if (isRecord(f) && Array.isArray(f.conditions)) return f.conditions.filter(Boolean);
    return [];
}


/**
 * Determines whether a page belongs to content from a system application
 * (such as Contactes, Mail, etc.) that must be excluded from the general Wiki.
 * @param {Object} page
 * @returns {boolean}
 */
export function isAppContent(page: SchemaPage | null | undefined): boolean {
    if (!page) return false;
    const folder = typeof page.folder === 'string' ? page.folder : '';
    const systemFolders = [
        'Contacts',
        'Mail',
        'Calendar',
        'Newsletters',
        'Tools',
        'system',
        'data',
        'Assets',
        'Images',
        'BD'
    ];
    
    return systemFolders.some(sys => folder === sys || folder.startsWith(sys + '/'));
}

/**
 * Internal/system metadata keys that are NOT user fields and therefore
 * must never be shown in the column selector or the grid. It's the same
 * canonical set that BlockEditor uses to compute `adhocProperties`.
 */
export const INTERNAL_METADATA_KEYS: ReadonlySet<string> = new Set([
    'title', 'table_id', 'database_id', 'database_table_id', 'id',
    'parent_id', 'source_id', 'resolved_table_id', 'last_modified',
    'created_time', 'last_edited_time', 'last_edited_at', 'last_edited_by',
    'created_by', 'created_at',
    'source_parent_id', 'is_default_template', 'is_template', 'is_dashboard',
    'path', 'filename', 'description', 'cover', 'cover_manual', 'icon',
]);

const TITLE_FIELD_NAMES = new Set(['title', 'títol', 'titulo', 'título', 'titre']);

/**
 * Discovers user field NAMES from the `metadata` of a sample of
 * records. Needed for tables without a registered schema (e.g. imported
 * from the Notion clone, like "Recursos"), where `table.properties` is empty but the
 * records do carry fields. Replicates BlockEditor's `adhocProperties` filter:
 * excludes internal keys, the title, and variants prefixed with
 * favorite / icon_ / cover_ or suffixed with _manual, and the "Zotero Extras" dict.
 *
 * @param {Array} records  list of records ({ metadata })
 * @returns {string[]}     unique field names, sorted alphabetically
 */
export function discoverFieldNamesFromRecords(
    records: readonly SchemaPage[] = [],
): string[] {
    const byNorm = new Map<string, string>(); // normalized key → original name (first seen)
    for (const rec of records) {
        const md = rec.metadata;
        if (!md) continue;
        for (const key of Object.keys(md)) {
            const norm = key.toLowerCase();
            if (INTERNAL_METADATA_KEYS.has(key) || INTERNAL_METADATA_KEYS.has(norm)) continue;
            if (TITLE_FIELD_NAMES.has(norm)) continue;
            if (norm.endsWith('_manual')) continue;
            if (norm.startsWith('favorite') || norm.startsWith('icon_') || norm.startsWith('cover_')) continue;
            if (key === 'Zotero Extras') continue;
            if (!byNorm.has(norm)) byNorm.set(norm, key);
        }
    }
    return [...byNorm.values()].sort((a, b) => a.localeCompare(b));
}
