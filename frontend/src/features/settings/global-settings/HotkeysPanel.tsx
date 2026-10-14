import { useMemo, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_COMMAND_TITLES, COMMAND_PLUGINS, commandHotkey, hotkeyConflict, hotkeyFromEvent, isReservedHotkey, saveHotkeyBindings, useHotkeyBindings } from '../../../shared/commands/hotkeys';
import { usePluginHost } from '../../../shared/plugins/usePluginHost';
import { usePlugins } from '../../../shared/plugins/usePlugins';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import './customization.css';

export function HotkeysPanel() {
    const { t } = useTranslation();
    const bindings = useHotkeyBindings();
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const { commands: pluginCommands } = usePluginHost();
    const { isEnabled } = usePlugins();
    const commands = useMemo(() => [
        ...Object.entries(BUILTIN_COMMAND_TITLES).filter(([id]) => !COMMAND_PLUGINS[id] || isEnabled(COMMAND_PLUGINS[id])).map(([id, title]) => ({ id, title: t(title) })),
        ...pluginCommands.flatMap(command => typeof command.id === 'string' && typeof command.title === 'string'
            ? [{ id: `plugin:${command.pluginId}:${command.id}`, title: command.title }] : []),
    ], [isEnabled, pluginCommands, t]);
    const setBinding = (id: string, binding: string) => {
        const conflict = hotkeyConflict(id, binding, bindings, [...commands.map(command => command.id), ...Object.keys(bindings)]);
        if (conflict) { setError(t('settings.hotkeys.conflict', { command: commands.find(command => command.id === conflict)?.title ?? conflict })); return; }
        setError(saveHotkeyBindings({ ...bindings, [id]: binding }) ? '' : t('settings.hotkeys.save_error'));
    };
    return <Section title={t('settings.tabs.hotkeys')} icon={Keyboard}>
        <p className="settings-desc">{t('settings.hotkeys.description')}</p>
        <div className="customization-actions">
            <input className="gnosi-input" aria-label={t('settings.hotkeys.filter')} placeholder={t('settings.hotkeys.filter')} value={query} onChange={event => { setQuery(event.target.value); }} />
            <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setError(saveHotkeyBindings({}) ? '' : t('settings.hotkeys.save_error')); }}><RotateCcw size={14} />{t('settings.hotkeys.reset')}</button>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="customization-list">
            {commands.filter(command => command.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(command => <div key={command.id} className="customization-row">
                <label htmlFor={`hotkey-${command.id}`}>{command.title}</label>
                <input id={`hotkey-${command.id}`} className="gnosi-input" readOnly data-hotkey-recorder="true" value={commandHotkey(command.id, bindings)} placeholder={t('settings.hotkeys.unassigned')}
                    onKeyDown={event => {
                        if (event.key === 'Tab' || event.key === 'Escape') return;
                        event.preventDefault(); event.stopPropagation();
                        if (['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
                        const binding = hotkeyFromEvent(event);
                        if (!binding || event.nativeEvent.isComposing || event.getModifierState('AltGraph')) { setError(t('settings.hotkeys.modifier_required')); return; }
                        if (isReservedHotkey(binding)) { setError(t('settings.hotkeys.reserved')); return; }
                        setBinding(command.id, binding);
                    }} />
                <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setBinding(command.id, ''); }} aria-label={t('settings.hotkeys.clear_command', { command: command.title })}>{t('settings.hotkeys.clear')}</button>
            </div>)}
        </div>
    </Section>;
}
