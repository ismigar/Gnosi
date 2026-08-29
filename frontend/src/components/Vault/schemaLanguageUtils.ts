import type { VaultSchema } from './schemaTypes';

const LANGUAGE_FIELD_NAMES = ['idioma', 'llengua', 'language', 'lang', 'lengua', 'lingua'];

const LANGUAGE_VALUE_TO_CODE: Readonly<Record<string, string>> = {
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

function stripAccents(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLanguageFieldName(value: string): boolean {
    return LANGUAGE_FIELD_NAMES.includes(stripAccents(value.toLowerCase()));
}

function schemaFieldNames(schema: VaultSchema): string[] {
    return Object.keys(schema).filter(key => !key.endsWith('_config'));
}

function schemaFieldId(schema: VaultSchema, fieldName: string): string | undefined {
    const config = schema[`${fieldName}_config`];
    if (!isRecord(config)) return undefined;
    const id = config.id;
    return typeof id === 'string' ? id : undefined;
}

export function normalizeLangCode(value: unknown): string {
    if (!value || typeof value !== 'string') return '';
    const raw = value.trim().toLowerCase();
    if (!raw) return '';
    const exact = LANGUAGE_VALUE_TO_CODE[raw];
    if (exact) return exact;
    const prefix = raw.split(/[-_]/)[0] ?? '';
    const normalizedPrefix = LANGUAGE_VALUE_TO_CODE[prefix];
    if (normalizedPrefix) return normalizedPrefix;
    return /^[a-z]{2}$/.test(prefix) ? prefix : '';
}

export function getLanguageFieldName(schema: VaultSchema = {}): string | undefined {
    return schemaFieldNames(schema).find(isLanguageFieldName);
}

export function detectRecordSourceLang(
    metadata: Readonly<Record<string, unknown>> = {},
    schema: VaultSchema = {},
): string {
    const languageFieldName = getLanguageFieldName(schema);
    const candidates: string[] = [];
    if (languageFieldName) {
        candidates.push(languageFieldName);
        const fieldId = schemaFieldId(schema, languageFieldName);
        if (fieldId) candidates.push(fieldId);
    }
    for (const key of Object.keys(metadata)) {
        if (isLanguageFieldName(key)) candidates.push(key);
    }
    for (const key of candidates) {
        const value = metadata[key];
        const code = normalizeLangCode(Array.isArray(value) ? value[0] : value);
        if (code) return code;
    }
    return '';
}
