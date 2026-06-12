/**
 * optionCatalogUtils.js
 * Catàlegs d'opcions rics (select/multi_select/status), rols semàntics i
 * mirall client de les action_rules — directiva vault_option_catalogs_action_rules.
 *
 * `config.options` admet DOS formats: string llegat ('CA') i objecte ric
 * `{name, color?, group?}`. Aquí es normalitza a la lectura; el backend
 * (services/option_catalogs.py) fa el mateix i és la font de veritat.
 */
import { getSchemaFieldNames, getFieldConfig, getFieldType } from './schemaUtils';

// Paleta tancada (mirall de OPTION_COLOR_PALETTE del backend). El hex és el to
// base; el xip el rebaixa amb alfa perquè funcioni en clar i fosc.
export const OPTION_COLOR_PALETTE = [
    'gray', 'blue', 'green', 'yellow', 'orange',
    'red', 'purple', 'pink', 'brown', 'teal',
];

const COLOR_HEX = {
    gray: '#6b7280',
    blue: '#3b82f6',
    green: '#22c55e',
    yellow: '#eab308',
    orange: '#f97316',
    red: '#ef4444',
    purple: '#a855f7',
    pink: '#ec4899',
    brown: '#a16207',
    teal: '#14b8a6',
};

// Grups per defecte d'un camp `status` (estil Notion).
export const DEFAULT_STATUS_GROUPS = ['Inicial', 'En curs', 'Final'];

// Estats del catàleg seed (decisió §9.1 de la directiva).
export const STATUS_DRAFT = 'Esborrany';
export const STATUS_REVIEWED = 'Revisat';
export const STATUS_TRANSLATED = 'Traduït';
export const STATUS_PUBLISHED_DRUPAL = 'Publicat a Drupal';
export const STATUS_PUBLISHED_SOCIAL = 'Publicat a XXSS';

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normName = (s) => stripAccents(String(s ?? '').trim().toLowerCase());

/**
 * Color automàtic estable per a una opció sense color explícit. MATEIX
 * algorisme (djb2-xor sobre el nom normalitzat) que el backend, perquè una
 * opció no persistida es pinti igual a tot arreu.
 */
export function autoColorFor(name) {
    const s = normName(name);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((Math.imul(h, 33) >>> 0) ^ s.charCodeAt(i)) >>> 0;
    }
    return OPTION_COLOR_PALETTE[h % OPTION_COLOR_PALETTE.length];
}

/** Una opció (string llegat o objecte ric) → objecte ric, o null si invàlida. */
export function normalizeOption(opt) {
    if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
        const name = String(opt.name ?? '').trim();
        if (!name) return null;
        const color = OPTION_COLOR_PALETTE.includes(String(opt.color ?? '').toLowerCase())
            ? String(opt.color).toLowerCase()
            : autoColorFor(name);
        const out = { name, color };
        const group = String(opt.group ?? '').trim();
        if (group) out.group = group;
        return out;
    }
    const name = String(opt ?? '').trim();
    if (!name) return null;
    return { name, color: autoColorFor(name) };
}

/** Llista en qualsevol format → llista rica sense duplicats (per nom). */
export function normalizeOptions(options) {
    const out = [];
    const seen = new Set();
    for (const opt of Array.isArray(options) ? options : []) {
        const norm = normalizeOption(opt);
        if (norm && !seen.has(norm.name)) {
            seen.add(norm.name);
            out.push(norm);
        }
    }
    return out;
}

export function optionNames(options) {
    return normalizeOptions(options).map((o) => o.name);
}

/**
 * Estils inline d'un xip d'opció amb color de catàleg. Retorna null si no hi
 * ha color (el caller manté l'estil neutre actual del tema).
 */
export function optionChipStyle(colorName) {
    const hex = COLOR_HEX[colorName];
    if (!hex) return null;
    return {
        backgroundColor: `${hex}26`, // ~15% alfa
        borderColor: `${hex}59`,     // ~35% alfa
        color: hex,
    };
}

/** Hex base d'un color de la paleta (per a punts/swatches). */
export function optionColorHex(colorName) {
    return COLOR_HEX[colorName] || COLOR_HEX.gray;
}

// --- Rols semàntics (mirall de option_catalogs.find_role_prop) ---------------

const ROLE_FIELD_NAMES = {
    language: ['idioma', 'llengua', 'language', 'lang', 'lengua', 'lingua'],
    status: ['estat', 'estado', 'status', 'state'],
    tags: ['tags', 'tag', 'etiquetes', 'etiquetas', 'labels'],
};

// Tipus admissibles per a l'heurístic de NOM (mirall del backend): un camp
// «Estat» de tipus text no és un camp d'estat semàntic. El rol explícit
// (config.role) no té aquesta restricció.
const ROLE_ALLOWED_TYPES = {
    language: ['select', 'status'],
    status: ['select', 'status'],
    tags: ['multi_select'],
};

/**
 * Nom del camp d'un rol semàntic a l'esquema: primer per `config.role`
 * explícit, després per l'heurístic de nom (compatibilitat amb taules no
 * migrades). Retorna undefined si no n'hi ha.
 */
export function findRoleFieldName(schema = {}, role) {
    const names = getSchemaFieldNames(schema);
    const explicit = names.find((n) => getFieldConfig(schema, n)?.role === role);
    if (explicit) return explicit;
    const candidates = ROLE_FIELD_NAMES[role] || [];
    const allowed = ROLE_ALLOWED_TYPES[role] || [];
    return names.find((n) =>
        candidates.includes(normName(n)) && allowed.includes(getFieldType(schema, n))
    );
}

// --- Mirall client de les action_rules ---------------------------------------
// El backend revalida sempre (409 amb el motiu); això només governa l'estat
// visual del botó (visible però desactivat + tooltip).

export const DEFAULT_ACTION_RULES = {
    translate_row: {
        requires: [{ role: 'status', not_in: [STATUS_DRAFT], reason: 'No es pot traduir si està en esborrany' }],
    },
    sync_drupal: {
        requires: [{ role: 'status', not_in: [STATUS_DRAFT], reason: 'No es pot sincronitzar un esborrany' }],
    },
    publish_social: {
        requires: [{ role: 'status', not_in: [STATUS_DRAFT], reason: 'No es pot publicar un esborrany' }],
    },
};

function valuesOf(raw) {
    if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
    const s = String(raw ?? '').trim();
    return s ? [s] : [];
}

/**
 * Avalua les `requires` d'una acció sobre un registre. `actionRules` és el
 * bloc `table.action_rules` del registry si està disponible; si no, el mirall
 * per defecte. Condicions no avaluables (camp inexistent, valor buit) passen.
 *
 * @returns {{ok: boolean, reason: string|null}}
 */
export function checkActionRequires(schema = {}, metadata = {}, action, actionRules = null) {
    const rules = (actionRules && actionRules[action]) || DEFAULT_ACTION_RULES[action];
    if (!rules) return { ok: true, reason: null };
    for (const cond of rules.requires || []) {
        if (!cond || typeof cond !== 'object') continue;
        const fieldName = findRoleFieldName(schema, cond.role);
        if (!fieldName) continue;
        const cfg = getFieldConfig(schema, fieldName) || {};
        const raw = metadata?.[cfg.id] ?? metadata?.[fieldName];
        const values = valuesOf(raw);
        if (!values.length) continue;
        const reason = String(cond.reason || '').trim() || 'L’estat actual no permet aquesta acció';
        if (Array.isArray(cond.not_in) && values.some((v) => cond.not_in.includes(v))) {
            return { ok: false, reason };
        }
        if (Array.isArray(cond.in) && !values.some((v) => cond.in.includes(v))) {
            return { ok: false, reason };
        }
        if (cond.in_group || cond.not_in_group) {
            const opts = normalizeOptions(cfg.options);
            const groups = new Set(values.map((v) => opts.find((o) => o.name === v)?.group || ''));
            if (typeof cond.not_in_group === 'string' && groups.has(cond.not_in_group)) {
                return { ok: false, reason };
            }
            if (typeof cond.in_group === 'string' && !groups.has(cond.in_group)) {
                return { ok: false, reason };
            }
        }
    }
    return { ok: true, reason: null };
}

/**
 * Opcions d'Estat que el seed-on-enable garanteix quan s'activa una
 * funcionalitat (mirall de ensure_status_seed del backend; el servidor ho
 * torna a fer en desar — això és per a la UX immediata del modal).
 */
export function seedOptionsForFeature(feature) {
    if (feature === 'base') {
        return [
            { name: STATUS_DRAFT, color: autoColorFor(STATUS_DRAFT), group: 'Inicial' },
            { name: STATUS_REVIEWED, color: autoColorFor(STATUS_REVIEWED), group: 'En curs' },
        ];
    }
    if (feature === 'translation') {
        return [{ name: STATUS_TRANSLATED, color: autoColorFor(STATUS_TRANSLATED), group: 'En curs' }];
    }
    if (feature === 'drupal') {
        return [{ name: STATUS_PUBLISHED_DRUPAL, color: autoColorFor(STATUS_PUBLISHED_DRUPAL), group: 'Final' }];
    }
    if (feature === 'social') {
        return [{ name: STATUS_PUBLISHED_SOCIAL, color: autoColorFor(STATUS_PUBLISHED_SOCIAL), group: 'Final' }];
    }
    return [];
}
