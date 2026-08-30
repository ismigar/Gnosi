import {
    translateVaultPage,
    translateVaultRow,
    translateVaultRows,
    type TranslatePageResult,
    type TranslateRowResult,
    type TranslateRowsResult,
} from '../../../../shared/api/translation';


export type TranslationMode = 'bulk' | 'page' | 'row';
export type VaultTranslationResult =
    | TranslatePageResult
    | TranslateRowResult
    | TranslateRowsResult;


export interface TranslationLanguage {
    readonly code: string;
    readonly label: string;
}


export interface TranslationRequest {
    readonly buttonAction?: string;
    readonly mode: TranslationMode;
    readonly noteId?: string;
    readonly noteIds: readonly string[];
    readonly targetLanguages: readonly string[];
}


export const DEFAULT_TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
    { code: 'ca', label: 'Català' },
    { code: 'es', label: 'Castellà' },
    { code: 'en', label: 'Anglès' },
    { code: 'fr', label: 'Francès' },
    { code: 'de', label: 'Alemany' },
    { code: 'it', label: 'Italià' },
    { code: 'pt', label: 'Portuguès' },
    { code: 'nl', label: 'Neerlandès' },
    { code: 'eu', label: 'Basc' },
    { code: 'gl', label: 'Gallec' },
    { code: 'ar', label: 'Àrab' },
    { code: 'zh', label: 'Xinès' },
];


export function normalizeSourceLanguage(value: unknown): string {
    return typeof value === 'string' ? value : '';
}


export function visibleTranslationLanguages(
    sourceLanguage: string,
): readonly TranslationLanguage[] {
    return DEFAULT_TRANSLATION_LANGUAGES.filter(
        (language) => language.code !== sourceLanguage,
    );
}


export function toggleTranslationLanguage(
    selected: readonly string[],
    language: string,
    sourceLanguage: string,
): string[] {
    if (language === sourceLanguage) return [...selected];
    return selected.includes(language)
        ? selected.filter((code) => code !== language)
        : [...selected, language];
}


export async function requestVaultTranslation({
    buttonAction,
    mode,
    noteId = '',
    noteIds,
    targetLanguages,
}: TranslationRequest): Promise<VaultTranslationResult> {
    const languages = [...targetLanguages];
    if (mode === 'bulk') {
        return translateVaultRows({
            button_action: 'translate_row',
            item_ids: [...noteIds],
            target_languages: languages,
        });
    }
    if (mode === 'page') {
        return translateVaultPage({
            button_action: 'translate_page',
            page_id: noteId,
            target_languages: languages,
        });
    }
    return translateVaultRow({
        button_action: buttonAction || 'translate_row',
        item_id: noteId,
        target_languages: languages,
    });
}
