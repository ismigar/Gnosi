import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { X, Languages, Loader2 } from 'lucide-react';
import { toast } from '../../lib/toast';
import { detectRecordSourceLang } from './schemaUtils';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// Default languages offered. The backend skill detects the source language
// on submit; here, we also hide it from the list when we know it from the field
// "Language" of the record (see sourceLang). The ISO 639-1 codes are passed
// as-is to the skill, which knows how to route them to the right provider (Softcatalà/Apertium
// for ca/es and regional languages; DeepL for the rest, like Arabic or Chinese).
const DEFAULT_LANGUAGES = [
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

export function TranslateLanguagesModal({ isOpen, onClose, noteId, noteIds = [], fieldConfig, recordMetadata = null, schema = {}, onTranslated, mode = 'row' }) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const containerRef = useRef(null);
    // `mode` generalizes the modal: 'row' translates a table row (subitems),
    // 'page' translates a whole page (child subpages), 'bulk' translates
    // several rows selected at once (one subitem per row and language).
    const isPage = mode === 'page';
    const isBulk = mode === 'bulk';

    // Source language of the record, read from its "Language" field (if it has one). In
    // 'bulk' mode no language is hidden: each row can have a different source
    // and the backend already skips the origin of each one individually.
    const sourceLang = useMemo(
        () => (isBulk ? '' : detectRecordSourceLang(recordMetadata || {}, schema || {})),
        [isBulk, recordMetadata, schema]
    );
    // List of targets: hides the source language when we know it.
    const languages = useMemo(
        () => DEFAULT_LANGUAGES.filter(l => l.code !== sourceLang),
        [sourceLang]
    );

    useEffect(() => {
        if (isOpen) setSelected([]);
    }, [isOpen]);

    const toggle = (code) => {
        if (code === sourceLang) return; // the original language cannot be chosen
        setSelected(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
    };

    const handleSubmit = async () => {
        if (selected.length === 0) {
            toast.error(t('translate.error_pick_lang', "Pick at least one language."));
            return;
        }
        setSubmitting(true);
        try {
            let endpoint, payload, successMsg;
            if (isBulk) {
                endpoint = '/api/vault/skills/translate-rows';
                payload = { item_ids: noteIds, target_languages: selected, button_action: 'translate_row' };
                successMsg = t('translate.success_bulk', {
                    count: noteIds.length,
                    defaultValue: "Translation started for {{count}} records.",
                });
            } else if (isPage) {
                endpoint = '/api/vault/skills/translate-page';
                payload = { page_id: noteId, target_languages: selected, button_action: 'translate_page' };
                successMsg = t('translate.success_page', "Translation started — child pages will appear shortly.");
            } else {
                endpoint = '/api/vault/skills/translate-row';
                payload = { item_id: noteId, target_languages: selected, button_action: fieldConfig?.button_action || 'translate_row' };
                successMsg = t('translate.success', "Translation started — subitems will appear shortly.");
            }
            const res = await axios.post(endpoint, payload);
            toast.success(successMsg);
            if (onTranslated) onTranslated(res.data);
            onClose();
        } catch (err) {
            console.error('Error requesting translation:', err);
            const msg = err.response?.data?.detail || err.message || t('errors.unknown', "Unknown error");
            toast.error(`${t('translate.error', "Error starting translation")}: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    };

    // Esc cancels, Enter confirms (positive action). See useModalKeyboard.
    useModalKeyboard({
        isOpen,
        onClose,
        onConfirm: handleSubmit,
        confirmDisabled: submitting || selected.length === 0,
        containerRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
        >
            <div
                ref={containerRef}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]"
                role="dialog"
                aria-modal="true"
                aria-label={isBulk
                    ? t('translate.title_bulk', { count: noteIds.length, defaultValue: 'Translate {{count}} records' })
                    : isPage
                        ? t('translate.title_page', 'Translate page')
                        : t('translate.title', 'Translate row')}
            >
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Languages size={18} className="text-[var(--gnosi-primary)]" />
                        {isBulk
                            ? t('translate.title_bulk', { count: noteIds.length, defaultValue: "Translate {{count}} records" })
                            : isPage
                                ? t('translate.title_page', "Translate page")
                                : t('translate.title', "Translate row")}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', "Close")} disabled={submitting}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-xs text-[var(--text-secondary)]/80">
                        {isBulk
                            ? t('translate.intro_bulk', "Choose target languages. For each selected record and language a subitem will be created (or updated) with the translation of the fields marked as translatable.")
                            : isPage
                                ? t('translate.intro_page', "Pick the target languages. For each language, a child page will be created with the translation of the title and content.")
                                : t('translate.intro', "Pick the target languages. For each language, a subitem will be created with the translation of the fields marked as translatable.")}
                    </p>

                    <div className="grid grid-cols-2 gap-2">
                        {languages.map(lang => {
                            const isOn = selected.includes(lang.code);
                            return (
                                <label
                                    key={lang.code}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                                        isOn
                                            ? 'bg-[var(--gnosi-primary)]/10 border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] font-semibold'
                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isOn}
                                        onChange={() => toggle(lang.code)}
                                        disabled={submitting}
                                        className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)]"
                                    />
                                    <span className="flex-1">{t(`translate.lang_${lang.code}`, lang.label)}</span>
                                    <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{lang.code}</span>
                                </label>
                            );
                        })}
                    </div>

                    {sourceLang && (
                        <p className="text-[10px] text-[var(--text-secondary)]/60">
                            {t('translate.source_hidden', {
                                lang: t(`translate.lang_${sourceLang}`, DEFAULT_LANGUAGES.find(l => l.code === sourceLang)?.label || sourceLang.toUpperCase()),
                                defaultValue: "The original language ({{lang}}) is hidden: it's the translation source.",
                            })}
                        </p>
                    )}

                    <p className="text-[10px] text-[var(--text-secondary)]/60">
                        {t('translate.provider_hint', "Catalan is translated via Softcatalà; the rest via DeepL. Configure credentials in .env_shared.")}
                    </p>
                </div>

                <div className="px-5 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/80 hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || selected.length === 0}
                        className="btn-gnosi btn-gnosi-primary px-5 flex items-center gap-2 disabled:opacity-50"
                    >
                        {submitting && <Loader2 size={14} className="animate-spin" />}
                        {t('translate.submit', "Translate")}
                    </button>
                </div>
            </div>
        </div>
    );
}
