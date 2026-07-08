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

// Noms de camp que solem usar per a "l'idioma del registre". El modal de
// traducció els busca per amagar l'idioma origen de la llista de destins.
// Comparació accent/caixa-insensible (vegeu detectRecordSourceLang).
const LANGUAGE_FIELD_NAMES = ['idioma', 'llengua', 'language', 'lang', 'lengua', 'lingua'];

// Etiquetes habituals → codi ISO 639-1, perquè el camp "Idioma" pot tenir
// valors com "CA", "ca", "Català", "Castellà", "EN-GB"… L'objectiu és casar-ho
// amb els `code` de DEFAULT_LANGUAGES del modal. Si no es reconeix, es retorna
// el prefix de 2 lletres en minúscula (cobreix "EN-GB"→"en", "pt-BR"→"pt").
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
 * Normalitza un valor d'idioma ("Català", "EN-GB", "ca") a codi ISO 639-1.
 * Retorna '' si no es pot determinar.
 * @param {string} value
 * @returns {string}
 */
export function normalizeLangCode(value) {
    if (!value || typeof value !== 'string') return '';
    const raw = value.trim().toLowerCase();
    if (!raw) return '';
    if (LANGUAGE_VALUE_TO_CODE[raw]) return LANGUAGE_VALUE_TO_CODE[raw];
    // "en-gb" / "pt_br" → prefix abans del separador.
    const prefix = raw.split(/[-_]/)[0];
    if (LANGUAGE_VALUE_TO_CODE[prefix]) return LANGUAGE_VALUE_TO_CODE[prefix];
    // Últim recurs: si ja sembla un codi de 2 lletres, accepta'l tal qual.
    return /^[a-z]{2}$/.test(prefix) ? prefix : '';
}

/**
 * Detecta l'idioma origen d'un registre llegint el seu camp "Idioma" (o
 * sinònims) del metadata. El modal de traducció l'usa per amagar l'idioma que
 * ja és l'original i evitar que l'usuari el trii. Retorna el codi ISO 639-1, o
 * '' si el registre no té camp idioma reconeixible (en aquest cas el backend
 * salta l'origen igualment com a xarxa de seguretat).
 *
 * @param {Object} metadata  metadata del registre (note.metadata)
 * @param {Object} schema    esquema de la taula (per resoldre nom↔id del camp)
 * @returns {string}
 */
export function detectRecordSourceLang(metadata = {}, schema = {}) {
    if (!metadata || typeof metadata !== 'object') return '';
    const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // 1) Localitza el nom del camp idioma a l'esquema (accent/caixa-insensible).
    const langFieldName = getSchemaFieldNames(schema).find(name =>
        LANGUAGE_FIELD_NAMES.includes(stripAccents(String(name).toLowerCase()))
    );
    // 2) Reuneix les claus candidates al metadata: el nom del camp, el seu id
    //    estable, i qualsevol clau que coincideixi pel nom (per metadata que
    //    s'hagi desat per nom o per id).
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
 * Retorna el NOM del camp "Idioma" (o sinònim) de l'esquema, o undefined si no
 * n'hi ha cap. Reconeix els mateixos noms que detectRecordSourceLang. La taula
 * el fa servir per no duplicar el badge d'idioma quan la columna ja és visible.
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
        if (prop.file_mode) config.file_mode = prop.file_mode;
        if (prop.storage_folder) config.storage_folder = prop.storage_folder;
        if (prop.name_pattern) config.name_pattern = prop.name_pattern;
        if (prop.translatable === true) config.translatable = true;
        if (prop.system === true) config.system = true;
        if (prop.button_action) config.button_action = prop.button_action;
        if (prop.button_label) config.button_label = prop.button_label;
        if (prop.format && typeof prop.format === 'object') config.format = prop.format;
        // Opcions explícites de select/multi_select/status: el catàleg fix de
        // valors triables. Hi ha dues fonts possibles i poden divergir:
        //   - `config.options` (niat): l'escriu el PATCH inline d'opcions.
        //   - `prop.options` (nivell superior): l'escriu el desat del modal.
        // El PATCH NO toca el nivell superior, però el desat del modal
        // substitueix tota la taula i esborra el `config` niat. Per tant, si
        // `config.options` existeix és perquè l'últim escrit va ser un PATCH
        // (és el fresc) → té prioritat. Si no, usem el nivell superior. Sense
        // això, crear/eliminar una opció inline no es reflectia: la lectura
        // agafava el nivell superior antic.
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
 * Escriu un valor de metadata utilitzant el NOM actual com a clau
 * (persistència per nom: el .md no guarda mai claus opaques 'fld_*').
 * Elimina qualsevol clau 'fld_*' residual del mateix camp. El backend
 * (to_storage_names) torna a canonicalitzar com a xarxa de seguretat.
 * Muta i retorna el metadata.
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
 * Normalitza el camp `sort` d'una vista a un array d'ordres.
 *
 * Les vistes guarden `sort` en dues formes històriques: un únic objecte
 * { field, direction } (vistes per defecte del backend i del frontend) o un
 * array [{ id, field, direction }] (multi-ordenació del ViewConfigModal).
 * Tots els consumidors (ViewConfigModal, VaultTable i, indirectament,
 * useVaultViewData) treballen amb arrays i fan `sorts.map(...)`/iteren amb
 * `for...of`, així que normalitzem sempre l'entrada per no petar ni perdre
 * l'ordre quan arriba en forma d'objecte. Descarta entrades sense `field` i
 * assigna `direction: 'asc'` per defecte.
 *
 * @param {Object|Array|null|undefined} raw  valor cru de `view.sort`
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
 * Ordre EFECTIU d'una vista, resolent les DUES claus del registry.
 *
 * A més de les dues formes de `normalizeSorts`, el registry té dues CLAUS
 * històriques: `sorts` (array complet — l'escriuen l'import de Notion, el
 * PageViewModal i les seccions d'embed) i `sort` (llegat; el modal hi desa
 * només el PRIMER criteri per compat). Es prefereix `sorts` — paritat amb el
 * backend (view_snapshot: `view.get("sorts") or [view["sort"]]`) i amb
 * DbViewEmbed. Llegir només `view.sort`, com feien els renderers del tauler,
 * IGNORAVA l'ordre configurat de totes les vistes importades (cap no té
 * `sort` singular).
 *
 * Si la vista té config d'ordre explícita però buida (l'usuari ha tret tots
 * els criteris: el modal desa `sorts: []`), es respecta com a "sense ordre"
 * i NO s'aplica el fallback.
 *
 * @param {Object|null|undefined} view      la vista del registry
 * @param {{field: string, direction: string}|null} fallback  ordre per defecte
 *        quan la vista no té CAP config d'ordre (p. ex. last_modified desc)
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
 * Filtres EFECTIUS d'una vista, sempre com a array.
 *
 * `view.filters` té dues formes històriques: l'array pla [{field, operator,
 * value}] (la que desa el modal) i l'objecte embolcallat {conditions: [...]}
 * (forma que la toolbar ja contempla per al recompte). El motor
 * (`matchesFilters`) fa `filters.every(...)`: passar-li l'objecte llança
 * TypeError i tomba la vista al boundary. Únic punt de normalització per a
 * tots els renderers.
 *
 * @param {Object|null|undefined} view  la vista del registry
 * @returns {Array} llista de filtres (mai null)
 */
export function resolveViewFilters(view) {
    const f = view?.filters;
    if (Array.isArray(f)) return f.filter(Boolean);
    if (f && typeof f === 'object' && Array.isArray(f.conditions)) return f.conditions.filter(Boolean);
    return [];
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
    
    // Match backend logic in is_calendar_entry: la font ha de ser EXACTAMENT
    // "gnosi"/"gnosi vault" (no una subcadena). Amb `includes('gnosi')` un
    // registre de BD amb taula i data i font "gnosi-*" (p.ex. "gnosi-newsletter")
    // es classificava com a cita i quedava AMAGAT de Recents/Sidebar/Cerca, tot i
    // que el backend el tracta com a registre normal. Les cites reals (sense
    // taula) segueixen comptant gràcies a `!tableId`.
    const isEntry = hasDate && (source === 'gnosi' || source === 'gnosi vault' || !tableId);
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
