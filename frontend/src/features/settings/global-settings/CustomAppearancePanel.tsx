import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { subscribeAppEvent } from '../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { customAppearanceKey, customAppearanceSafeMode, readCustomAppearance, resetCustomAppearance, saveCustomAppearance, validateCustomCss, type CustomAppearance, type CustomStyle } from '../../../shared/theme/customAppearance';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import './customization.css';

function StyleEditor({ style, theme, active, onSave, onToggle, onRemove }: {
    style: CustomStyle; theme: boolean; active: boolean;
    onSave: (style: CustomStyle) => boolean; onToggle: () => void; onRemove: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState(style.name);
    const [css, setCss] = useState(style.css);
    const [error, setError] = useState('');
    const nameLabel = t('settings.custom_appearance.name');
    return <div className="customization-card">
        <div className="customization-actions">
            <input className="gnosi-input" aria-label={nameLabel} value={name} maxLength={100} onChange={event => { setName(event.target.value); }} />
            <GnosiToggle active={active} label={t(theme ? 'settings.custom_appearance.use_theme' : 'settings.custom_appearance.enable_snippet', { name: style.name })} onChange={onToggle} />
            <button type="button" className="btn-gnosi btn-gnosi-secondary" aria-label={t('settings.custom_appearance.remove', { name: style.name })} onClick={onRemove}><Trash2 size={14} /></button>
        </div>
        <textarea className="gnosi-input" spellCheck={false} aria-label={t('settings.custom_appearance.css_for', { name: style.name })} value={css} onChange={event => { setCss(event.target.value); }} />
        {error && <p role="alert">{error}</p>}
        <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={name === style.name && css === style.css} onClick={() => {
            const invalid = validateCustomCss(css);
            if (invalid) { setError(t(`settings.custom_appearance.${invalid}`)); return; }
            if (!name.trim()) { setError(t('settings.custom_appearance.name_required')); return; }
            setError(onSave({ ...style, name: name.trim(), css }) ? '' : t('settings.custom_appearance.save_error'));
        }}>{t('settings.custom_appearance.apply')}</button>
    </div>;
}

export function CustomAppearancePanel() {
    const { t } = useTranslation();
    const [preferences, setPreferences] = useState(readCustomAppearance);
    const [error, setError] = useState('');
    useEffect(() => {
        const update = () => { setPreferences(readCustomAppearance()); };
        const stop = subscribeAppEvent('gnosi:appearance-changed', update);
        const stopStorage = subscribeWindowEvent('storage', event => { if (!event.key || event.key === customAppearanceKey.name) update(); });
        return () => { stop(); stopStorage(); };
    }, []);
    const save = (next: CustomAppearance): boolean => {
        const saved = saveCustomAppearance(next);
        setError(saved ? '' : t('settings.custom_appearance.save_error'));
        return saved;
    };
    const add = (kind: 'themes' | 'snippets') => {
        const style: CustomStyle = { id: uuidv4(), name: t(kind === 'themes' ? 'settings.custom_appearance.new_theme' : 'settings.custom_appearance.new_snippet'),
            css: kind === 'themes' ? ':root {\n  --gnosi-primary: #568b73;\n}' : '', enabled: false };
        save({ ...preferences, [kind]: [...preferences[kind], style] });
    };
    return <div className="customization-section">
        <h4 className="settings-label">{t('settings.custom_appearance.title')}</h4>
        <p className="settings-desc">{t('settings.custom_appearance.description')}</p>
        <p className="settings-desc">{t('settings.custom_appearance.recovery')}</p>
        {customAppearanceSafeMode() && <p role="status">{t('settings.custom_appearance.safe_mode')}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="customization-actions"><button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setError(resetCustomAppearance() ? '' : t('settings.custom_appearance.save_error')); }}><RotateCcw size={14} />{t('settings.custom_appearance.reset')}</button></div>
        {(['themes', 'snippets'] as const).map(kind => <div key={kind} className="customization-section">
            <div className="customization-actions"><h4 className="settings-label">{t(`settings.custom_appearance.${kind}`)}</h4>
                <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={preferences[kind].length >= 20} onClick={() => { add(kind); }}><Plus size={14} />{t(kind === 'themes' ? 'settings.custom_appearance.add_theme' : 'settings.custom_appearance.add_snippet')}</button></div>
            <div className="customization-list">{preferences[kind].map(style => <StyleEditor key={`${style.id}:${style.name}:${style.css}`} style={style} theme={kind === 'themes'}
                active={kind === 'themes' ? preferences.activeTheme === style.id : style.enabled}
                onSave={next => save({ ...preferences, [kind]: preferences[kind].map(item => item.id === style.id ? next : item) })}
                onToggle={() => { save(kind === 'themes' ? { ...preferences, activeTheme: preferences.activeTheme === style.id ? '' : style.id }
                    : { ...preferences, snippets: preferences.snippets.map(item => item.id === style.id ? { ...item, enabled: !item.enabled } : item) }); }}
                onRemove={() => { save({ ...preferences, activeTheme: kind === 'themes' && preferences.activeTheme === style.id ? '' : preferences.activeTheme, [kind]: preferences[kind].filter(item => item.id !== style.id) }); }} />)}</div>
        </div>)}
    </div>;
}
