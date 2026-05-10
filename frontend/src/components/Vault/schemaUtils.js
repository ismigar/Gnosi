/**
 * schemaUtils.js
 * Utilitats per gestionar i transformar els esquemes de les taules del Vault.
 *
 * Format d'esquema:
 *   { fieldName: 'type', fieldName_config: { formula, relationField, ... } }
 */

const RESERVED_KEYS_SUFFIX = '_config';

/**
 * Retorna tots els noms de camp de l'esquema (exclou les claus _config).
 * @param {Object} schema
 * @returns {string[]}
 */
export function getSchemaFieldNames(schema = {}) {
    return Object.keys(schema).filter(key => !key.endsWith(RESERVED_KEYS_SUFFIX));
}

/**
 * Retorna el tipus d'un camp de l'esquema.
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
 * Retorna la configuració addicional d'un camp (per a formules, rollups, etc.).
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {Object}
 */
export function getFieldConfig(schema = {}, fieldName) {
    return schema[`${fieldName}${RESERVED_KEYS_SUFFIX}`] || {};
}

/**
 * Construeix un esquema pla (objecte) a partir d'una llista de propietats de taula
 * (format que utilitza el backend: [{ name, type, ...config }]).
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
        if (prop.storage_folder) config.storage_folder = prop.storage_folder;
        if (prop.translatable === true) config.translatable = true;
        if (prop.button_action) config.button_action = prop.button_action;
        if (prop.button_label) config.button_label = prop.button_label;
        if (prop.id) config.id = prop.id;
        if (Object.keys(config).length > 0) {
            schema[`${prop.name}${RESERVED_KEYS_SUFFIX}`] = config;
        }
    });
    return schema;
}

/**
 * Retorna l'ID immutable d'un camp ('fld_xxxxxxxx') si existeix.
 * Aquest ID és la clau estable per referenciar el camp en notes,
 * filtres, vistes i seccions, independent del seu nom mostrat.
 * @param {Object} schema
 * @param {string} fieldName
 * @returns {string|undefined}
 */
export function getFieldId(schema = {}, fieldName) {
    return getFieldConfig(schema, fieldName).id;
}

/**
 * Retorna el nom actual d'un camp donat el seu ID immutable.
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
 * Resol una referència de camp que pot venir com a ID estable o com a nom.
 * Retorna { id, name } amb tots dos valors quan és possible.
 * @param {Object} schema
 * @param {string} ref - id ('fld_*') o nom de camp
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
 * Llegeix un valor de metadata d'una pàgina per ID o nom de camp.
 * Prioritza ID; si no hi és, fa fallback al nom (compatibilitat enrere).
 * @param {Object} page - amb metadata
 * @param {Object} schema
 * @param {string} ref - id o nom
 */
export function getMetaValue(page, schema, ref) {
    if (!page || !page.metadata) return undefined;
    const { id, name } = resolveFieldRef(schema, ref);
    if (id !== undefined && page.metadata[id] !== undefined) return page.metadata[id];
    if (name !== undefined && page.metadata[name] !== undefined) return page.metadata[name];
    return undefined;
}

/**
 * Escriu un valor de metadata utilitzant ID com a clau quan és possible
 * (i elimina la clau antiga per nom si encara hi és, per migrar lazy).
 * Muta i retorna el metadata.
 */
export function setMetaValue(metadata, schema, ref, value) {
    metadata = metadata || {};
    const { id, name } = resolveFieldRef(schema, ref);
    if (id) {
        metadata[id] = value;
        if (name && name !== id && metadata[name] !== undefined) {
            delete metadata[name];
        }
    } else if (name) {
        metadata[name] = value;
    }
    return metadata;
}

/**
 * Converteix un esquema pla en una llista de propietats de taula
 * (format que consumeix el component SchemaConfigModal).
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
 * Retorna les entrades de l'esquema com a parells [nom, tipus].
 * @param {Object} schema
 * @returns {Array<[string, string]>}
 */
export function getSchemaFieldEntries(schema = {}) {
    return getSchemaFieldNames(schema).map(name => [name, getFieldType(schema, name)]);
}


/**
 * Determina si una pàgina s'ha de considerar una cita del calendari.
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
    
    // Match backend logic in is_calendar_entry
    const isEntry = hasDate && (source.includes('gnosi') || !tableId);
    const isInFolder = folder === 'Calendar' || folder.startsWith('Calendar/');
    
    return isEntry || isInFolder;
}

/**
 * Determina si una pàgina pertany a contingut d'una aplicació del sistema
 * (com Contactes, Mail, etc.) que ha d'estar exclòs de la Wiki general.
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
