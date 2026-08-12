/**
 * optionCatalogUtils.js
 * Rich option catalogs (select/multi_select/status), semantic roles, and
 * a client-side mirror of the action_rules — vault_option_catalogs_action_rules directive.
 *
 * `config.options` supports TWO formats: legacy string ('CA') and rich object
 * `{name, color?, group?}`. It is normalized here on read; the backend
 * (services/option_catalogs.py) does the same and is the source of truth.
 */
import { getSchemaFieldNames, getFieldConfig, getFieldType } from './schemaUtils';

// Closed palette (mirror of the backend's OPTION_COLOR_PALETTE). The hex is the base
// tone; the chip tones it down with alpha so it works in light and dark mode.
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

// Default groups for a `status` field (Notion style).
export const DEFAULT_STATUS_GROUPS = ['Inicial', 'En curs', 'Final'];

// Seed catalog statuses (decision §9.1 of the directive).
export const STATUS_DRAFT = 'Esborrany';
export const STATUS_REVIEWED = 'Revisat';
export const STATUS_TRANSLATED = 'Traduït';
export const STATUS_PUBLISHED_DRUPAL = 'Publicat a Drupal';
export const STATUS_PUBLISHED_SOCIAL = 'Publicat a XXSS';
export const STATUS_CATALOG_REF = 'status';

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normName = (s) => stripAccents(String(s ?? '').trim().toLowerCase());

/**
 * Stable automatic color for an option without an explicit color. SAME
 * algorithm (djb2-xor over the normalized name) as the backend, so that an
 * unpersisted option is painted the same everywhere.
 */
export function autoColorFor(name) {
    const s = normName(name);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((Math.imul(h, 33) >>> 0) ^ s.charCodeAt(i)) >>> 0;
    }
    return OPTION_COLOR_PALETTE[h % OPTION_COLOR_PALETTE.length];
}

/** An option (legacy string or rich object) → rich object, or null if invalid. */
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

/** List in any format → rich list without duplicates (by name). */
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
 * Inline styles for an option chip with a catalog color. Returns null if there
 * is no color (the caller keeps the theme's current neutral style).
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

/** Base hex of a palette color (for dots/swatches). */
export function optionColorHex(colorName) {
    return COLOR_HEX[colorName] || COLOR_HEX.gray;
}

// --- Semantic roles (mirror of option_catalogs.find_role_prop) ---------------

const ROLE_FIELD_NAMES = {
    language: ['idioma', 'llengua', 'language', 'lang', 'lengua', 'lingua'],
    status: ['estat', 'estado', 'status', 'state'],
    tags: ['tags', 'tag', 'etiquetes', 'etiquetas', 'labels'],
};

// Types allowed for the NAME heuristic (mirror of the backend): a field
// A text-type "Estat" field is not a semantic status field. The explicit role
// (config.role) does not have this restriction.
const ROLE_ALLOWED_TYPES = {
    language: ['select', 'status'],
    status: ['select', 'status'],
    tags: ['multi_select'],
};

/**
 * Field name for a semantic role in the schema: first by explicit
 * `config.role`, then by the name heuristic (compatibility with tables that
 * haven't been migrated). Returns undefined if there is none.
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

// --- Client-side mirror of the action_rules ---------------------------------------
// The backend always revalidates (409 with the reason); this only governs the
// button's visual state (visible but disabled + tooltip).

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
 * Evaluates an action's `requires` against a record. `actionRules` is the
 * `table.action_rules` block from the registry if available; otherwise, the
 * default mirror. Non-evaluable conditions (missing field, empty value) pass.
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
        const reason = String(cond.reason || '').trim() || 'The current status does not allow this action';
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
 * Status options that seed-on-enable guarantees when a feature is
 * enabled (mirror of the backend's ensure_status_seed; the server does
 * this again on save — this is for the modal's immediate UX).
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
