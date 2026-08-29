import { useMemo, useRef, useState } from 'react';
import { Languages, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { toast } from '../../lib/toast';
import { detectRecordSourceLang } from './schemaUtils';
import {
    DEFAULT_TRANSLATION_LANGUAGES,
    normalizeSourceLanguage,
    requestVaultTranslation,
    toggleTranslationLanguage,
    visibleTranslationLanguages,
    type TranslationMode,
    type VaultTranslationResult,
} from './translate-languages-modal/translationModel';


type TranslationRecord = Readonly<Record<string, unknown>>;


export interface TranslateLanguagesModalProps {
    readonly fieldConfig?: { readonly button_action?: string };
    readonly isOpen: boolean;
    readonly mode?: TranslationMode;
    readonly noteId?: string;
    readonly noteIds?: readonly string[];
    readonly onClose: () => void;
    readonly onTranslated?: (result: VaultTranslationResult) => void;
    readonly recordMetadata?: TranslationRecord | null;
    readonly schema?: TranslationRecord;
}


export function TranslateLanguagesModal(props: TranslateLanguagesModalProps) {
    if (!props.isOpen) return null;
    return <TranslateLanguagesModalContent {...props} key={props.mode || 'row'} />;
}


function TranslateLanguagesModalContent({
    fieldConfig,
    mode = 'row',
    noteId,
    noteIds = [],
    onClose,
    onTranslated,
    recordMetadata = null,
    schema = {},
}: TranslateLanguagesModalProps) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<readonly string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const isPage = mode === 'page';
    const isBulk = mode === 'bulk';
    const sourceLanguage = useMemo(() => isBulk
        ? ''
        : normalizeSourceLanguage(detectRecordSourceLang(
            recordMetadata || {},
            schema,
        )), [isBulk, recordMetadata, schema]);
    const languages = useMemo(
        () => visibleTranslationLanguages(sourceLanguage),
        [sourceLanguage],
    );
    const title = isBulk
        ? t('translate.title_bulk', {
            count: noteIds.length,
            defaultValue: 'Translate {{count}} records',
        })
        : isPage
            ? t('translate.title_page', 'Translate page')
            : t('translate.title', 'Translate row');

    const submit = async (): Promise<void> => {
        if (selected.length === 0) {
            toast.error(t('translate.error_pick_lang', 'Pick at least one language.'));
            return;
        }
        setSubmitting(true);
        try {
            const result = await requestVaultTranslation({
                buttonAction: fieldConfig?.button_action,
                mode,
                noteId,
                noteIds,
                targetLanguages: selected,
            });
            const successMessage = isBulk
                ? t('translate.success_bulk', {
                    count: noteIds.length,
                    defaultValue: 'Translation started for {{count}} records.',
                })
                : isPage
                    ? t('translate.success_page', 'Translation started — child pages will appear shortly.')
                    : t('translate.success', 'Translation started — subitems will appear shortly.');
            toast.success(successMessage);
            onTranslated?.(result);
            onClose();
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : t('errors.unknown', 'Unknown error');
            toast.error(`${t('translate.error', 'Error starting translation')}: ${message}`);
        } finally {
            setSubmitting(false);
        }
    };
    const handleSubmit = (): void => { void submit(); };

    useModalKeyboard({
        confirmDisabled: submitting || selected.length === 0,
        containerRef,
        isOpen: true,
        onClose,
        onConfirm: handleSubmit,
        trapFocus: true,
    });

    return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 font-sans backdrop-blur-sm">
        <div
            aria-label={title}
            aria-modal="true"
            className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
            ref={containerRef}
            role="dialog"
        >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-5 py-3">
                <h2 className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                    <Languages className="text-[var(--gnosi-primary)]" size={18} />
                    {title}
                </h2>
                <button
                    aria-label={t('common.close', 'Close')}
                    className="gnosi-close-btn"
                    disabled={submitting}
                    onClick={onClose}
                    type="button"
                ><X /></button>
            </div>

            <div className="space-y-4 p-5">
                <p className="text-xs text-[var(--text-secondary)]/80">
                    {isBulk
                        ? t('translate.intro_bulk', 'Choose target languages. For each selected record and language a subitem will be created (or updated) with the translation of the fields marked as translatable.')
                        : isPage
                            ? t('translate.intro_page', 'Pick the target languages. For each language, a child page will be created with the translation of the title and content.')
                            : t('translate.intro', 'Pick the target languages. For each language, a subitem will be created with the translation of the fields marked as translatable.')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {languages.map((language) => {
                        const selectedLanguage = selected.includes(language.code);
                        return <label
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${selectedLanguage
                                ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 font-semibold text-[var(--gnosi-primary)]'
                                : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                            key={language.code}
                        >
                            <input
                                checked={selectedLanguage}
                                className="h-3.5 w-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)]"
                                disabled={submitting}
                                onChange={() => {
                                    setSelected((current) => toggleTranslationLanguage(
                                        current,
                                        language.code,
                                        sourceLanguage,
                                    ));
                                }}
                                type="checkbox"
                            />
                            <span className="flex-1">{t(`translate.lang_${language.code}`, language.label)}</span>
                            <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{language.code}</span>
                        </label>;
                    })}
                </div>

                {sourceLanguage ? <p className="text-[10px] text-[var(--text-secondary)]/60">
                    {t('translate.source_hidden', {
                        defaultValue: "The original language ({{lang}}) is hidden: it's the translation source.",
                        lang: t(
                            `translate.lang_${sourceLanguage}`,
                            DEFAULT_TRANSLATION_LANGUAGES.find(
                                (language) => language.code === sourceLanguage,
                            )?.label || sourceLanguage.toUpperCase(),
                        ),
                    })}
                </p> : null}
                <p className="text-[10px] text-[var(--text-secondary)]/60">
                    {t('translate.provider_hint', 'Catalan is translated via Softcatalà; the rest via DeepL. Configure credentials in secure settings.')}
                </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-5 py-3">
                <button
                    className="rounded-md border border-[var(--border-primary)] px-4 py-2 text-sm font-bold text-[var(--text-secondary)]/80 transition-colors hover:bg-[var(--bg-primary)] disabled:opacity-50"
                    disabled={submitting}
                    onClick={onClose}
                    type="button"
                >{t('common.cancel')}</button>
                <button
                    className="btn-gnosi btn-gnosi-primary flex items-center gap-2 px-5 disabled:opacity-50"
                    disabled={submitting || selected.length === 0}
                    onClick={handleSubmit}
                    type="button"
                >
                    {submitting ? <Loader2 className="animate-spin" size={14} /> : null}
                    {t('translate.submit', 'Translate')}
                </button>
            </div>
        </div>
    </div>;
}
