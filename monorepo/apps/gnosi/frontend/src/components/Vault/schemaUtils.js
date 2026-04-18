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
        if (prop.defaultFormula) config.defaultFormula = prop.defaultFormula;
        if (prop.relationField) config.relationField = prop.relationField;
        if (prop.targetProperty) config.targetProperty = prop.targetProperty;
        if (prop.aggregation) config.aggregation = prop.aggregation;
        if (prop.relation_database_id) config.relation_database_id = prop.relation_database_id;
        if (prop.cardinality) config.cardinality = prop.cardinality;
        if (prop.limit !== undefined && prop.limit !== '') config.limit = prop.limit;
        if (prop.fallbackValue !== undefined && prop.fallbackValue !== '') config.fallbackValue = prop.fallbackValue;
        if (Object.keys(config).length > 0) {
            schema[`${prop.name}${RESERVED_KEYS_SUFFIX}`] = config;
        }
    });
    return schema;
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
