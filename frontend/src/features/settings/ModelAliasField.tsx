import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiModelRegistryEntry } from '../../shared/api/ai';

export function ModelAliasField({ entry, onSave, disabled }: {
    readonly entry: AiModelRegistryEntry;
    readonly onSave: (entry: AiModelRegistryEntry, alias: string) => Promise<void>;
    readonly disabled: boolean;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const value = draft ?? entry.alias ?? '';
    const save = async () => {
        setSaving(true);
        setError(false);
        try { await onSave(entry, value); setDraft(null); }
        catch { setError(true); }
        finally { setSaving(false); }
    };
    return <div className="model-alias-field">
        <label className="model-setup-field">
            <span>{t('model_comparison.alias.label')}</span>
            <input value={value} maxLength={120} disabled={disabled || saving}
                placeholder={t('model_comparison.alias.placeholder')}
                onChange={event => { setDraft(event.target.value); }} />
        </label>
        {draft !== null && <button type="button" className="btn-gnosi-secondary"
            disabled={disabled || saving} onClick={() => { void save(); }}>{t('common.save')}</button>}
        {error && <small role="alert">{t('model_comparison.errors.configuration_save_error')}</small>}
    </div>;
}
