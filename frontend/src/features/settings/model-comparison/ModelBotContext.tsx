import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiModelRegistryEntry } from '../../../shared/api/ai';
import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import { profileDisplayName } from '../../../shared/ai/assistantProfiles';
import type { SettingsAgent } from '../global-settings/types';

export function ModelBotContext({ bots, bot, onBotChange, registry, onAssign, onConfigure, saveStatus, disabled = false }: {
    readonly bots: readonly SettingsAgent[];
    readonly bot?: SettingsAgent;
    readonly onBotChange: (id: string) => void;
    readonly registry: readonly AiModelRegistryEntry[];
    readonly onAssign?: (id: string, provider: string, model: string) => void;
    readonly onConfigure?: (id: string) => void;
    readonly saveStatus?: string;
    readonly disabled?: boolean;
}) {
    const { t } = useTranslation();
    const [routeKey, setRouteKey] = useState('');
    const routes = registry.filter(row => row.enabled);
    const selected = routes.find(row => JSON.stringify([row.provider, row.model_id]) === routeKey);
    const current = bot ? registry.find(row => row.provider === bot.provider && row.model_id === bot.model) : undefined;
    return <section className="ai-resource-card model-bot-context">
        <div className="model-bot-context__summary">
            <label className="model-setup-field">{t('model_comparison.workspace.bot')}
                <select className="gnosi-select" value={bot?.id ?? ''} onChange={event => { onBotChange(event.target.value); setRouteKey(''); }}>
                    <option value="">{t('model_comparison.workspace.select_bot')}</option>
                    {bots.map(item => <option key={item.id} value={item.id}>{profileDisplayName(item, t) || item.id}</option>)}
                </select>
            </label>
            {bot ? <div>
                <span className="settings-desc">{t('model_comparison.workspace.current')}</span>
                <strong>{modelDisplayName(current) || bot.model || '—'}</strong>
                <span className="settings-desc">{bot.provider || '—'}{bot.reasoning_effort ? ` · ${bot.reasoning_effort}` : ''}</span>
            </div> : <p className="settings-desc">{t('model_comparison.workspace.no_bot')}</p>}
            {bot && onConfigure && <button className="btn-gnosi btn-gnosi-secondary" type="button" onClick={() => { onConfigure(bot.id); }}>{t('model_comparison.workspace.bot_settings')}</button>}
        </div>
        {bot && onAssign && <details>
            <summary>{t('model_comparison.workspace.active_models')}</summary>
            <div className="model-bot-context__summary">
                <label className="model-setup-field">{t('settings.ai.assistant.profile_model')}
                    <select className="gnosi-select" value={routeKey} onChange={event => { setRouteKey(event.target.value); }}>
                        <option value="">{t('settings.ai.select_model_option')}</option>
                        {routes.map(row => <option key={JSON.stringify([row.provider, row.model_id])} value={JSON.stringify([row.provider, row.model_id])}>{modelDisplayName(row) || row.model_id} · {row.provider}</option>)}
                    </select>
                </label>
                <button className="btn-gnosi btn-gnosi-primary" type="button" disabled={disabled || !selected || saveStatus === 'saving'}
                    onClick={() => { if (selected) onAssign(bot.id, selected.provider, selected.model_id); }}>{t('model_comparison.workspace.assign', { name: profileDisplayName(bot, t) || bot.id })}</button>
            </div>
            <p className="settings-desc">{t('model_comparison.workspace.assignment_help')}</p>
        </details>}
        {saveStatus === 'saving' || saveStatus === 'error' || saveStatus === 'saved' ? <p role={saveStatus === 'error' ? 'alert' : 'status'}>
            {t(`model_comparison.workspace.${saveStatus === 'saving' ? 'saving' : saveStatus === 'saved' ? 'saved' : 'save_error'}`)}
        </p> : null}
    </section>;
}
