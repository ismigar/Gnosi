import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { X, Languages, Loader2 } from 'lucide-react';
import { toast } from '../../lib/toast';
import { detectRecordSourceLang } from './schemaUtils';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// Idiomes oferts per defecte. L'idioma origen el detecta la skill del backend
// en enviar; aquí, a més, l'amaguem de la llista quan el coneixem pel camp
// "Idioma" del registre (vegeu sourceLang). Els codis ISO 639-1 es passen tal
// qual a la skill, que sap rutar-los al proveïdor adequat (Softcatalà/Apertium
// per ca/es i regionals; DeepL per a la resta com àrab o xinès).
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
    // `mode` generalitza el modal: 'row' tradueix una fila de taula (subitems),
    // 'page' tradueix una pàgina sencera (subpàgines filles), 'bulk' tradueix
    // diverses files seleccionades alhora (un subitem per fila i idioma).
    const isPage = mode === 'page';
    const isBulk = mode === 'bulk';

    // Idioma origen del registre, llegit del seu camp "Idioma" (si en té). En
    // mode 'bulk' no s'amaga cap idioma: cada fila pot tenir un origen diferent
    // i el backend ja salta l'origen de cadascuna individualment.
    const sourceLang = useMemo(
        () => (isBulk ? '' : detectRecordSourceLang(recordMetadata || {}, schema || {})),
        [isBulk, recordMetadata, schema]
    );
    // Llista de destins: amaga l'idioma origen quan el coneixem.
    const languages = useMemo(
        () => DEFAULT_LANGUAGES.filter(l => l.code !== sourceLang),
        [sourceLang]
    );

    useEffect(() => {
        if (isOpen) setSelected([]);
    }, [isOpen]);

    const toggle = (code) => {
        if (code === sourceLang) return; // no es pot triar l'idioma original
        setSelected(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
    };

    const handleSubmit = async () => {
        if (selected.length === 0) {
            toast.error(t('translate.error_pick_lang', 'Selecciona almenys un idioma.'));
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
                    defaultValue: 'Traducció iniciada per {{count}} registres.',
                });
            } else if (isPage) {
                endpoint = '/api/vault/skills/translate-page';
                payload = { page_id: noteId, target_languages: selected, button_action: 'translate_page' };
                successMsg = t('translate.success_page', 'Traducció iniciada — les subpàgines es crearan en breu.');
            } else {
                endpoint = '/api/vault/skills/translate-row';
                payload = { item_id: noteId, target_languages: selected, button_action: fieldConfig?.button_action || 'translate_row' };
                successMsg = t('translate.success', 'Traducció iniciada — els subitems es crearan en breu.');
            }
            const res = await axios.post(endpoint, payload);
            toast.success(successMsg);
            if (onTranslated) onTranslated(res.data);
            onClose();
        } catch (err) {
            console.error('Error sol·licitant traducció:', err);
            const msg = err.response?.data?.detail || err.message || t('errors.unknown', 'Error desconegut');
            toast.error(`${t('translate.error', 'Error iniciant la traducció')}: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    };

    // Esc cancel·la, Enter confirma (acció positiva). Veure useModalKeyboard.
    useModalKeyboard({
        isOpen,
        onClose,
        onConfirm: handleSubmit,
        confirmDisabled: submitting || selected.length === 0,
        containerRef,
    });

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
        >
            <div
                ref={containerRef}
                onMouseDown={(e) => e.stopPropagation()}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]"
            >
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Languages size={18} className="text-[var(--gnosi-primary)]" />
                        {isBulk
                            ? t('translate.title_bulk', { count: noteIds.length, defaultValue: 'Traduir {{count}} registres' })
                            : isPage
                                ? t('translate.title_page', 'Tradueix la pàgina')
                                : t('translate.title', 'Traduir fila')}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', 'Tanca')} disabled={submitting}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-xs text-[var(--text-secondary)]/80">
                        {isBulk
                            ? t('translate.intro_bulk', 'Tria els idiomes destí. Per cada registre seleccionat i idioma es crearà (o s\'actualitzarà) un subitem amb la traducció dels camps marcats com a traduïbles.')
                            : isPage
                                ? t('translate.intro_page', 'Tria els idiomes destí. Per cada idioma es crearà una subpàgina amb la traducció del títol i el contingut.')
                                : t('translate.intro', 'Tria els idiomes destí. Per cada idioma es crearà un subitem amb la traducció dels camps marcats com a traduïbles.')}
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
                                defaultValue: "L'idioma original ({{lang}}) no apareix: és l'origen de la traducció.",
                            })}
                        </p>
                    )}

                    <p className="text-[10px] text-[var(--text-secondary)]/60">
                        {t('translate.provider_hint', 'El català es tradueix amb Softcatalà; la resta amb DeepL. Configura les credencials a .env_shared.')}
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
                        {t('translate.submit', 'Traduir')}
                    </button>
                </div>
            </div>
        </div>
    );
}
