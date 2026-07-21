/**
 * schemaUtils.js
 * Utilities for managing and transforming Vault table schemas.
 *
 * Schema format:
 *   { fieldName: 'type', fieldName_config: { formula, relationField, ... } }
 */

const RESERVED_KEYS_SUFFIX = '_config';

/**
 * Returns all field names from the schema (excludes _config keys).
 * @param {Object} schema
 * @returns {string[]}
 */
export function getSchemaFieldNames(schema = {}) {
    return Object.keys(schema).filter(key => !key.endsWith(RESERVED_KEYS_SUFFIX));
}

/**
 * Returns the type of a schema field.
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {string}
 */
export function getFieldType(schema = {}, fieldName) {
    const val = schema[fieldName];
    if (!val) return 'text';
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val.type) return val.type;
    return 'text';
}

/**
 * Returns the additional configuration for a field (for formulas, rollups, etc.).
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {Object}
 */
export function getFieldConfig(schema = {}, fieldName) {
    return schema[`${fieldName}${RESERVED_KEYS_SUFFIX}`] || {};
}

// Field names we typically use for "the record's language". The
// translation modal looks for them to hide the source language from the list of targets.
// Accent/case-insensitive comparison (see detectRecordSourceLang).
const LANGUAGE_FIELD_NAMES = ['idioma', 'llengua', 'language', 'lang', 'lengua', 'lingua'];

// Common labels → ISO 639-1 code, because the "Idioma" field can have
// values like "CA", "ca", "Català", "Castellà", "EN-GB"… The goal is to match it
// with the `code` values from the modal's DEFAULT_LANGUAGES. If not recognized, we return
// the lowercase 2-letter prefix (covers "EN-GB"→"en", "pt-BR"→"pt").
const LANGUAGE_VALUE_TO_CODE = {
    ca: 'ca', cat: 'ca', català: 'ca', catala: 'ca', catalan: 'ca', catalán: 'ca',
    es: 'es', spa: 'es', cas: 'es', castellà: 'es', castella: 'es', castellano: 'es', español: 'es', espanyol: 'es', spanish: 'es',
    en: 'en', eng: 'en', anglès: 'en', angles: 'en', inglés: 'en', english: 'en',
    fr: 'fr', fra: 'fr', fre: 'fr', francès: 'fr', frances: 'fr', francés: 'fr', french: 'fr',
    de: 'de', deu: 'de', ger: 'de', alemany: 'de', alemán: 'de', aleman: 'de', german: 'de',
    it: 'it', ita: 'it', italià: 'it', italia: 'it', italiano: 'it', italian: 'it',
    pt: 'pt', por: 'pt', portuguès: 'pt', portugues: 'pt', portugués: 'pt', portuguese: 'pt',
    nl: 'nl', nld: 'nl', dut: 'nl', neerlandès: 'nl', neerlandes: 'nl', neerlandés: 'nl', dutch: 'nl', holandés: 'nl',
    eu: 'eu', eus: 'eu', baq: 'eu', basc: 'eu', euskera: 'eu', euskara: 'eu', vasco: 'eu', vascuence: 'eu', basque: 'eu',
    gl: 'gl', glg: 'gl', gallec: 'gl', gallego: 'gl', galego: 'gl', galician: 'gl',
    ar: 'ar', ara: 'ar', àrab: 'ar', arab: 'ar', árabe: 'ar', arabe: 'ar', arabic: 'ar',
    zh: 'zh', zho: 'zh', chi: 'zh', xinès: 'zh', xines: 'zh', chino: 'zh', chinese: 'zh', mandarí: 'zh', mandarin: 'zh',
};

/**
 * Normalizes a language value ("Català", "EN-GB", "ca") to an ISO 639-1 code.
 * Returns '' if it cannot be determined.
 * @param {string} value
 * @returns {string}
 */
export function normalizeLangCode(value) {
    if (!value || typeof value !== 'string') return '';
    const raw = value.trim().toLowerCase();
    if (!raw) return '';
    if (LANGUAGE_VALUE_TO_CODE[raw]) return LANGUAGE_VALUE_TO_CODE[raw];
    // "en-gb" / "pt_br" → prefix before the separator.
    const prefix = raw.split(/[-_]/)[0];
    if (LANGUAGE_VALUE_TO_CODE[prefix]) return LANGUAGE_VALUE_TO_CODE[prefix];
    // Last resort: if it already looks like a 2-letter code, accept it as-is.
    return /^[a-z]{2}$/.test(prefix) ? prefix : '';
}

/**
 * Detects a record's source language by reading its "Idioma" field (or
 * synonyms) from the metadata. The translation modal uses it to hide the language that
 * is already the original and prevent the user from selecting it. Returns the ISO 639-1 code, or
 * '' if the record has no recognizable language field (in that case the backend
 * skips the source anyway, as a safety net).
 *
 * @param {Object} metadata  record metadata (note.metadata)
 * @param {Object} schema    table schema (to resolve field name↔id)
 * @returns {string}
 */
export function detectRecordSourceLang(metadata = {}, schema = {}) {
    if (!metadata || typeof metadata !== 'object') return '';
    const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // 1) Locate the language field name in the schema (accent/case-insensitive).
    const langFieldName = getSchemaFieldNames(schema).find(name =>
        LANGUAGE_FIELD_NAMES.includes(stripAccents(String(name).toLowerCase()))
    );
    // 2) Gather the candidate keys in the metadata: the field name, its
    //    stable id, and any key that matches by name (for metadata that
    //    it has been saved by name or by id).
    const candidates = [];
    if (langFieldName) {
        candidates.push(langFieldName);
        const cfgId = getFieldConfig(schema, langFieldName)?.id;
        if (cfgId) candidates.push(cfgId);
    }
    for (const k of Object.keys(metadata)) {
        if (LANGUAGE_FIELD_NAMES.includes(stripAccents(String(k).toLowerCase()))) candidates.push(k);
    }
    for (const key of candidates) {
        const val = metadata[key];
        const code = normalizeLangCode(Array.isArray(val) ? val[0] : val);
        if (code) return code;
    }
    return '';
}

/**
 * Returns the NAME of the "Idioma" field (or synonym) from the schema, or undefined if
 * there is none. Recognizes the same names as detectRecordSourceLang. The table
 * uses it to avoid duplicating the language badge when the column is already visible.
 * @param {Object} schema
 * @returns {string|undefined}
 */
export function getLanguageFieldName(schema = {}) {
    const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return getSchemaFieldNames(schema).find(name =>
        LANGUAGE_FIELD_NAMES.includes(stripAccents(String(name).toLowerCase()))
    );
}

/**
 * Builds a flat schema (object) from a list of table properties
 * (format used by the backend: [{ name, type, ...config }]).
 * @param {Array} tableProperties
 * @returns {Object}
 */
export function buildSchemaFromTableProperties(tableProperties = []) {
    const schema = {};
    tableProperties.forEach(prop => {
        if (!prop.name) return;
        schema[prop.name] = prop.type || 'text';
        const config = {};
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
        if (prop.format && typeof prop.format === 'object') config.format = prop.format;
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
export function getFieldId(schema = {}, fieldName) {
    return getFieldConfig(schema, fieldName).id;
}

/**
 * Returns the current name of a field given its immutable ID.
 * @param {Object} schema
 * @param {string} fieldId
 * @returns {string|undefined}
 */
export function getFieldNameById(schema = {}, fieldId) {
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
export function resolveFieldRef(schema = {}, ref) {
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
export function getMetaValue(page, schema, ref) {
    if (!page || !page.metadata) return undefined;
    const { id, name } = resolveFieldRef(schema, ref);
    if (id !== undefined && page.metadata[id] !== undefined) return page.metadata[id];
    if (name !== undefined && page.metadata[name] !== undefined) return page.metadata[name];
    return undefined;
}

/**
 * Writes a metadata value using the current NAME as the key
 * (persistence by name: the .md never stores opaque 'fld_*' keys).
 * Removes any leftover 'fld_*' key for the same field. The backend
 * (to_storage_names) re-canonicalizes it again as a safety net.
 * Mutates and returns the metadata.
 */
export function setMetaValue(metadata, schema, ref, value) {
    metadata = metadata || {};
    const { id, name } = resolveFieldRef(schema, ref);
    if (name) {
        metadata[name] = value;
        if (id && id !== name && metadata[id] !== undefined) {
            delete metadata[id];
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
export function buildTablePropertiesFromSchema(schema = {}) {
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
export function getSchemaFieldEntries(schema = {}) {
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
export function normalizeSorts(raw) {
    if (Array.isArray(raw)) {
        return raw
            .filter(s => s && s.field)
            .map((s, i) => ({ id: s.id ?? `sort-${i}`, field: s.field, direction: s.direction || 'asc' }));
    }
    if (raw && typeof raw === 'object' && raw.field) {
        return [{ id: raw.id ?? 'sort-0', field: raw.field, direction: raw.direction || 'asc' }];
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
export function resolveViewSorts(view, fallback = null) {
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
export function resolveViewFilters(view) {
    const f = view?.filters;
    if (Array.isArray(f)) return f.filter(Boolean);
    if (f && typeof f === 'object' && Array.isArray(f.conditions)) return f.conditions.filter(Boolean);
    return [];
}


/**
 * Determines whether a page should be considered a calendar appointment.
 * @param {Object} page 
 * @returns {boolean}
 */
export function isCalendarPage(page) {
    if (!page) return false;
    const metadata = page.metadata || {};
    const source = String(metadata.source || '').trim().toLowerCase();
    const hasDate = !!metadata.date;
    const tableId = page.resolved_table_id || metadata.table_id || metadata.database_table_id;
    const folder = String(page.folder || '');
    
    // Match backend logic in is_calendar_entry: the source must be EXACTLY
    // "gnosi"/"gnosi vault" (not a substring). With `includes('gnosi')` a
    // DB record with table, date, and source "gnosi-*" (e.g. "gnosi-newsletter")
    // was classified as a citation and stayed HIDDEN from Recent/Sidebar/Search, even though
    // would make the backend treat it as a normal record. Real appointments (without
    // a table) still count thanks to `!tableId`.
    const isEntry = hasDate && (source === 'gnosi' || source === 'gnosi vault' || !tableId);
    const isInFolder = folder === 'Calendar' || folder.startsWith('Calendar/');
    
    return isEntry || isInFolder;
}

/**
 * Determines whether a page belongs to content from a system application
 * (such as Contactes, Mail, etc.) that must be excluded from the general Wiki.
 * @param {Object} page
 * @returns {boolean}
 */
export function isAppContent(page) {
    if (!page) return false;
    const folder = String(page.folder || '');
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
export const INTERNAL_METADATA_KEYS = new Set([
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
export function discoverFieldNamesFromRecords(records = []) {
    const byNorm = new Map(); // normalized key → original name (first seen)
    for (const rec of Array.isArray(records) ? records : []) {
        const md = rec && rec.metadata;
        if (!md || typeof md !== 'object') continue;
        for (const key of Object.keys(md)) {
            const norm = String(key || '').toLowerCase();
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
