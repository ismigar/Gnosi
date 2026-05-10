import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { X, Languages, Loader2 } from 'lucide-react';
import { toast } from '../../lib/toast';

// Idiomes oferts per defecte. L'idioma origen es detecta a la skill del
// backend (o el deixa decidir l'usuari més endavant); aquí només triem
// destins. Els codis ISO 639-1 es passen tal qual a la skill, que sap
// rutar-los al proveïdor adequat (Softcatalà per `ca`, DeepL per la resta).
const DEFAULT_LANGUAGES = [
    { code: 'ca', label: 'Català' },
    { code: 'es', label: 'Castellà' },
    { code: 'en', label: 'Anglès' },
    { code: 'fr', label: 'Francès' },
    { code: 'de', label: 'Alemany' },
    { code: 'it', label: 'Italià' },
    { code: 'pt', label: 'Portuguès' },
    { code: 'nl', label: 'Neerlandès' },
];

export function TranslateLanguagesModal({ isOpen, onClose, noteId, fieldConfig, onTranslated }) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) setSelected([]);
    }, [isOpen]);

    if (!isOpen) return null;

    const toggle = (code) => {
        setSelected(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
    };

    const handleSubmit = async () => {
        if (selected.length === 0) {
            toast.error(t('translate.error_pick_lang', 'Selecciona almenys un idioma.'));
            return;
        }
        setSubmitting(true);
        try {
            const res = await axios.post('/api/vault/skills/translate-row', {
                item_id: noteId,
                target_languages: selected,
                button_action: fieldConfig?.button_action || 'translate_row',
            });
            toast.success(t('translate.success', 'Traducció iniciada — els subitems es crearan en breu.'));
            if (onTranslated) onTranslated(res.data);
            onClose();
        } catch (err) {
            console.error('Error sol·licitant traducció:', err);
            const msg = err.response?.data?.detail || err.message || 'Error desconegut';
            toast.error(`${t('translate.error', 'Error iniciant la traducció')}: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm">
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]">
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Languages size={18} className="text-[var(--gnosi-primary)]" />
                        {t('translate.title', 'Traduir fila')}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label="Tancar" disabled={submitting}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-xs text-[var(--text-secondary)]/80">
                        {t('translate.intro', 'Tria els idiomes destí. Per cada idioma es crearà un subitem amb la traducció dels camps marcats com a traduïbles.')}
                    </p>

                    <div className="grid grid-cols-2 gap-2">
                        {DEFAULT_LANGUAGES.map(lang => {
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
                                    <span className="flex-1">{lang.label}</span>
                                    <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{lang.code}</span>
                                </label>
                            );
                        })}
                    </div>

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
