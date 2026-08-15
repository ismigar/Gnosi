import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL_RE = new RegExp(`_(${PLURAL_SUFFIXES.join('|')})$`);
const PLACEHOLDER_RE = /{{\s*([^},\s]+)[^}]*}}/g;
const TAG_RE = /<\/?([A-Za-z][\w-]*|\d+)\b[^>]*>/g;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const localeRoot = path.resolve(scriptDir, '../src/locales');

function canonicalizeLocale(value) {
    try {
        return Intl.getCanonicalLocales(String(value || '').replaceAll('_', '-'))[0] || null;
    } catch {
        return null;
    }
}

function flatten(value, prefix = '', output = new Map()) {
    for (const [key, child] of Object.entries(value)) {
        if (!prefix && key === '_meta') continue;
        const childPath = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === 'object' && !Array.isArray(child)) {
            flatten(child, childPath, output);
        } else {
            output.set(childPath, child);
        }
    }
    return output;
}

function extractSet(value, regex) {
    if (typeof value !== 'string') return [];
    return [...value.matchAll(regex)].map((match) => match[1]).sort();
}

function signature(value) {
    return JSON.stringify({
        placeholders: extractSet(value, PLACEHOLDER_RE),
        tags: extractSet(value, TAG_RE),
    });
}

function loadLocales() {
    const locales = [];
    for (const entry of fs.readdirSync(localeRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const cataloguePath = path.join(localeRoot, entry.name, 'translation.json');
        if (!fs.existsSync(cataloguePath)) continue;
        const code = canonicalizeLocale(entry.name);
        if (!code || code !== entry.name) {
            throw new Error(`Locale directory "${entry.name}" is not canonical BCP-47.`);
        }
        const catalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf8'));
        const metadata = catalogue._meta;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error(`Locale "${code}" is missing _meta.`);
        }
        if (typeof metadata.nativeName !== 'string' || !metadata.nativeName.trim()) {
            throw new Error(`Locale "${code}" is missing _meta.nativeName.`);
        }
        if (!canonicalizeLocale(metadata.intlLocale)) {
            throw new Error(`Locale "${code}" has an invalid _meta.intlLocale.`);
        }
        if (!['ltr', 'rtl'].includes(metadata.direction)) {
            throw new Error(`Locale "${code}" has an invalid _meta.direction.`);
        }
        if (metadata.zoteroLocale != null && !canonicalizeLocale(metadata.zoteroLocale)) {
            throw new Error(`Locale "${code}" has an invalid _meta.zoteroLocale.`);
        }
        locales.push({
            code,
            intlLocale: metadata.intlLocale,
            values: flatten(catalogue),
        });
    }
    if (!locales.some(({ code }) => code === 'en')) {
        throw new Error('The English fallback catalogue is required.');
    }
    return locales;
}

function findPluralBases(locales, allKeys) {
    const bases = new Set();
    for (const key of allKeys) {
        const match = key.match(PLURAL_RE);
        if (!match) continue;
        const base = key.slice(0, -match[0].length);
        const values = locales.flatMap(({ values: localeValues }) => (
            PLURAL_SUFFIXES.map((suffix) => localeValues.get(`${base}_${suffix}`))
        ));
        if (values.some((value) => typeof value === 'string' && value.includes('{{count}}'))) {
            bases.add(base);
        }
    }
    return bases;
}

function logicalKey(key, pluralBases) {
    const match = key.match(PLURAL_RE);
    const base = match ? key.slice(0, -match[0].length) : key;
    return match && pluralBases.has(base) ? base : key;
}

function validateParity(locales) {
    const errors = [];
    const allKeys = new Set(locales.flatMap(({ values }) => [...values.keys()]));
    const pluralBases = findPluralBases(locales, allKeys);
    const logicalKeys = new Set([...allKeys].map((key) => logicalKey(key, pluralBases)));

    for (const locale of locales) {
        const ownLogicalKeys = new Set(
            [...locale.values.keys()].map((key) => logicalKey(key, pluralBases))
        );
        for (const key of logicalKeys) {
            if (!ownLogicalKeys.has(key)) {
                errors.push(`${locale.code}: missing key "${key}"`);
            }
        }
        for (const base of pluralBases) {
            const categories = new Intl.PluralRules(locale.intlLocale)
                .resolvedOptions()
                .pluralCategories;
            for (const category of categories) {
                if (!locale.values.has(`${base}_${category}`)) {
                    errors.push(`${locale.code}: missing plural "${base}_${category}"`);
                }
            }
        }
    }

    for (const key of logicalKeys) {
        const variants = pluralBases.has(key) ? PLURAL_SUFFIXES : [null];
        for (const variant of variants) {
            const candidates = [];
            for (const locale of locales) {
                if (variant) {
                    const value = locale.values.get(`${key}_${variant}`);
                    if (value !== undefined) candidates.push({ locale: locale.code, value });
                } else {
                    const value = locale.values.get(key);
                    if (value !== undefined) candidates.push({ locale: locale.code, value });
                }
            }
            const stringCandidates = candidates.filter(({ value }) => typeof value === 'string');
            if (stringCandidates.length < 2) continue;
            const expected = signature(stringCandidates[0].value);
            for (const candidate of stringCandidates.slice(1)) {
                if (signature(candidate.value) !== expected) {
                    const variantKey = variant ? `${key}_${variant}` : key;
                    errors.push(`${candidate.locale}: placeholder/tag mismatch for "${variantKey}"`);
                }
            }
        }
    }
    return errors;
}

try {
    const locales = loadLocales();
    const errors = validateParity(locales);
    if (errors.length) {
        console.error(`i18n validation failed with ${errors.length} issue(s):`);
        for (const error of errors) console.error(`- ${error}`);
        process.exitCode = 1;
    } else {
        console.log(`i18n validation passed for ${locales.length} locale(s).`);
    }
} catch (error) {
    console.error(`i18n validation failed: ${error.message}`);
    process.exitCode = 1;
}
