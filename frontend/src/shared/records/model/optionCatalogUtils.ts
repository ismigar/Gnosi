/**
 * optionCatalogUtils.ts
 * Rich option catalogs (select/multi_select/status), semantic roles, and
 * a client-side mirror of the action_rules — vault_option_catalogs_action_rules directive.
 *
 * `config.options` supports TWO formats: legacy string ('CA') and rich object
 * `{name, color?, group?}`. It is normalized here on read; the backend
 * (services/option_catalogs.py) does the same and is the source of truth.
 */
import type { CSSProperties } from 'react';

import { getSchemaFieldNames, getFieldConfig, getFieldType } from './schemaUtils';

export interface NormalizedOption {
    readonly color: OptionColorName;
    readonly group?: string;
    readonly name: string;
}

export interface ActionRequirementResult {
    readonly ok: boolean;
    readonly reason: string | null;
}

// Closed palette (mirror of the backend's OPTION_COLOR_PALETTE). The hex is the base
// tone; the chip tones it down with alpha so it works in light and dark mode.
export const OPTION_COLOR_PALETTE = [
    'gray', 'blue', 'green', 'yellow', 'orange',
    'red', 'purple', 'pink', 'brown', 'teal',
] as const;

export type OptionColorName = typeof OPTION_COLOR_PALETTE[number];

const COLOR_HEX: Readonly<Record<OptionColorName, string>> = {
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
export const DEFAULT_STATUS_GROUPS = ['Inicial', 'En curs', 'Final'] as const;

// Seed catalog statuses (decision §9.1 of the directive).
export const STATUS_DRAFT = 'Esborrany';
export const STATUS_REVIEWED = 'Revisat';
export const STATUS_TRANSLATED = 'Traduït';
export const STATUS_PUBLISHED_DRUPAL = 'Publicat a Drupal';
export const STATUS_PUBLISHED_SOCIAL = 'Publicat a XXSS';
export const STATUS_CATALOG_REF = 'status';

type SemanticRole = 'language' | 'status' | 'tags';
type OptionChipStyle = Pick<CSSProperties, 'backgroundColor' | 'borderColor' | 'color'>;

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyOptionValue(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}

function isOptionColorName(value: string): value is OptionColorName {
    return (OPTION_COLOR_PALETTE as readonly string[]).includes(value);
}

function isSemanticRole(value: string): value is SemanticRole {
    return value === 'language' || value === 'status' || value === 'tags';
}

const stripAccents = (value: unknown): string => stringifyOptionValue(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const normName = (value: unknown): string => stripAccents(
    stringifyOptionValue(value ?? '').trim().toLowerCase(),
);

/**
 * Stable automatic color for an option without an explicit color. SAME
 * algorithm (djb2-xor over the normalized name) as the backend, so that an
 * unpersisted option is painted the same everywhere.
 */
export function autoColorFor(name: unknown): OptionColorName {
    const s = normName(name);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((Math.imul(h, 33) >>> 0) ^ s.charCodeAt(i)) >>> 0;
    }
    return OPTION_COLOR_PALETTE[h % OPTION_COLOR_PALETTE.length] ?? 'gray';
}

/** An option (legacy string or rich object) → rich object, or null if invalid. */
export function normalizeOption(opt: unknown): NormalizedOption | null {
    if (isUnknownRecord(opt)) {
        const name = stringifyOptionValue(opt.name ?? '').trim();
        if (!name) return null;
        const requestedColor = stringifyOptionValue(opt.color ?? '').toLowerCase();
        const color = isOptionColorName(requestedColor)
            ? requestedColor
            : autoColorFor(name);
        const group = stringifyOptionValue(opt.group ?? '').trim();
        return { name, color, ...(group ? { group } : {}) };
    }
    const name = stringifyOptionValue(opt ?? '').trim();
    if (!name) return null;
    return { name, color: autoColorFor(name) };
}

/** List in any format → rich list without duplicates (by name). */
export function normalizeOptions(options: unknown): NormalizedOption[] {
    const out: NormalizedOption[] = [];
    const seen = new Set<string>();
    for (const opt of Array.isArray(options) ? options : []) {
        const norm = normalizeOption(opt);
        if (norm && !seen.has(norm.name)) {
            seen.add(norm.name);
            out.push(norm);
        }
    }
    return out;
}

export function optionNames(options: unknown): string[] {
    return normalizeOptions(options).map((o) => o.name);
}

/**
 * Inline styles for an option chip with a catalog color. Returns null if there
 * is no color (the caller keeps the theme's current neutral style).
 */
export function optionChipStyle(colorName: unknown): OptionChipStyle | null {
    const normalizedColor = typeof colorName === 'string' ? colorName : '';
    const hex = isOptionColorName(normalizedColor) ? COLOR_HEX[normalizedColor] : undefined;
    if (!hex) return null;
    return {
        backgroundColor: `${hex}26`, // ~15% alfa
        borderColor: `${hex}59`,     // ~35% alfa
        color: hex,
    };
}

/** Base hex of a palette color (for dots/swatches). */
export function optionColorHex(colorName: unknown): string {
    const normalizedColor = typeof colorName === 'string' ? colorName : '';
    return isOptionColorName(normalizedColor) ? COLOR_HEX[normalizedColor] : COLOR_HEX.gray;
}

// --- Semantic roles (mirror of option_catalogs.find_role_prop) ---------------

const ROLE_FIELD_NAMES: Readonly<Record<SemanticRole, readonly string[]>> = {
    language: ['idioma', 'llengua', 'language', 'lang', 'lengua', 'lingua'],
    status: ['estat', 'estado', 'status', 'state'],
    tags: ['tags', 'tag', 'etiquetes', 'etiquetas', 'labels'],
};

// Types allowed for the NAME heuristic (mirror of the backend): a field
// A text-type "Estat" field is not a semantic status field. The explicit role
// (config.role) does not have this restriction.
const ROLE_ALLOWED_TYPES: Readonly<Record<SemanticRole, readonly string[]>> = {
    language: ['select', 'status'],
    status: ['select', 'status'],
    tags: ['multi_select'],
};

/**
 * Field name for a semantic role in the schema: first by explicit
 * `config.role`, then by the name heuristic (compatibility with tables that
 * haven't been migrated). Returns undefined if there is none.
 */
export function findRoleFieldName(schema: unknown = {}, role: unknown): string | undefined {
    const schemaRecord = isUnknownRecord(schema) ? schema : {};
    const roleName = typeof role === 'string' ? role : '';
    const names = getSchemaFieldNames(schemaRecord);
    const explicit = names.find((name) => {
        const config: unknown = getFieldConfig(schemaRecord, name);
        return isUnknownRecord(config) && config.role === roleName;
    });
    if (explicit) return explicit;
    if (!isSemanticRole(roleName)) return undefined;
    const candidates = ROLE_FIELD_NAMES[roleName];
    const allowed = ROLE_ALLOWED_TYPES[roleName];
    return names.find((n) =>
        candidates.includes(normName(n)) && allowed.includes(getFieldType(schemaRecord, n))
    );
}

// --- Client-side mirror of the action_rules ---------------------------------------
// The backend always revalidates (409 with the reason); this only governs the
// button's visual state (visible but disabled + tooltip).

export const DEFAULT_ACTION_RULES: Readonly<Record<string, unknown>> = {
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

function valuesOf(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.map((value) => stringifyOptionValue(value).trim()).filter(Boolean);
    }
    const s = stringifyOptionValue(raw ?? '').trim();
    return s ? [s] : [];
}

/**
 * Evaluates an action's `requires` against a record. `actionRules` is the
 * `table.action_rules` block from the registry if available; otherwise, the
 * default mirror. Non-evaluable conditions (missing field, empty value) pass.
 *
 * @returns {{ok: boolean, reason: string|null}}
 */
export function checkActionRequires(
    schema: unknown = {},
    metadata: unknown = {},
    action: unknown,
    actionRules: unknown = null,
): ActionRequirementResult {
    const schemaRecord = isUnknownRecord(schema) ? schema : {};
    const metadataRecord = isUnknownRecord(metadata) ? metadata : {};
    const actionName = typeof action === 'string' ? action : stringifyOptionValue(action ?? '');
    const customRules = isUnknownRecord(actionRules) ? actionRules[actionName] : undefined;
    const rules = customRules || DEFAULT_ACTION_RULES[actionName];
    if (!isUnknownRecord(rules)) return { ok: true, reason: null };
    const requirements = Array.isArray(rules.requires) ? rules.requires : [];
    for (const cond of requirements) {
        if (!isUnknownRecord(cond)) continue;
        const fieldName = findRoleFieldName(schemaRecord, cond.role);
        if (!fieldName) continue;
        const rawConfig: unknown = getFieldConfig(schemaRecord, fieldName);
        const cfg = isUnknownRecord(rawConfig) ? rawConfig : {};
        const configId = cfg.id == null ? null : stringifyOptionValue(cfg.id);
        const raw = (configId ? metadataRecord[configId] : undefined)
            ?? metadataRecord[fieldName];
        const values = valuesOf(raw);
        if (!values.length) continue;
        const reason = stringifyOptionValue(cond.reason || '').trim()
            || 'The current status does not allow this action';
        const excludedValues = Array.isArray(cond.not_in) ? cond.not_in : [];
        if (excludedValues.length > 0
            && values.some((value) => excludedValues.includes(value))) {
            return { ok: false, reason };
        }
        const includedValues = Array.isArray(cond.in) ? cond.in : [];
        if (includedValues.length > 0
            && !values.some((value) => includedValues.includes(value))) {
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
export function seedOptionsForFeature(feature: unknown): NormalizedOption[] {
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
