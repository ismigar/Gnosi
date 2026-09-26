import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import { useTranslation } from 'react-i18next';
import { FormGroup, GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import type { SettingsModel } from './types';
import { compatibleAlternatives, isLocalModelProvider, MAX_ALTERNATIVES, modelRouteKey, type AgentModelStrategy } from './agentModelStrategy';
import { JevConnection } from './JevConnection';

interface Props {
  strategy: AgentModelStrategy;
  onChange: (strategy: AgentModelStrategy) => void;
  provider: string;
  model: string;
  registry: SettingsModel[];
  jevConnected: boolean;
  onConnectJev: () => void;
}

export function AgentModelStrategyFields({ strategy, onChange, provider, model, registry, jevConnected, onConnectJev }: Props) {
  const { t } = useTranslation();
  const alternatives = compatibleAlternatives(provider, model, registry);
  const local = isLocalModelProvider(provider);
  return <>
    <FormGroup label={t('settings.ai.model_strategy.label')} description={t('settings.ai.model_strategy.help')}>
      <select className="gnosi-select" aria-label={t('settings.ai.model_strategy.label')} value={strategy.mode}
        onChange={event => { onChange({ ...strategy, mode: event.target.value as AgentModelStrategy['mode'] }); }}>
        {(['pinned', 'resilient', 'adaptive'] as const).map(mode => <option key={mode} value={mode}>{t(`settings.ai.model_strategy.${mode}`)}</option>)}
      </select>
    </FormGroup>
    {strategy.mode !== 'pinned' && <FormGroup label={t('settings.ai.model_strategy.alternatives')} description={t('settings.ai.model_strategy.alternatives_help', { count: MAX_ALTERNATIVES })}>
      <div className="settings-configurable-list">
        {alternatives.map(row => {
          const route = { provider: row.provider, model: row.model_id };
          const key = modelRouteKey(route);
          const active = strategy.allowed_models.some(item => modelRouteKey(item) === key);
          return <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{modelDisplayName(row)}</span>
            <GnosiToggle active={active} label={modelDisplayName(row)}
              disabled={!active && strategy.allowed_models.length >= MAX_ALTERNATIVES}
              onChange={() => { onChange({ ...strategy, allowed_models: active
                ? strategy.allowed_models.filter(item => modelRouteKey(item) !== key)
                : [...strategy.allowed_models, route] }); }} />
          </div>;
        })}
        {alternatives.length === 0 && <p className="settings-desc">{t('settings.ai.model_strategy.no_alternatives')}</p>}
        {alternatives.length > 0 && strategy.allowed_models.length === 0 && <p className="settings-desc">{t('settings.ai.model_strategy.primary_only')}</p>}
      </div>
    </FormGroup>}
    {strategy.mode === 'adaptive' && <>
      <FormGroup label={t('settings.ai.model_strategy.engine')} description={t('settings.ai.model_strategy.engine_help')}>
        <select className="gnosi-select" aria-label={t('settings.ai.model_strategy.engine')} value={strategy.decision_engine}
          onChange={event => { onChange({ ...strategy, decision_engine: event.target.value === 'jev' ? 'jev' : 'rules' }); }}>
          <option value="rules">{t('settings.ai.model_strategy.rules')}</option>
          <option value="jev" disabled={local || !provider}>{t('settings.ai.model_strategy.jev')}</option>
        </select>
        {local && <p className="settings-desc">{t('settings.ai.model_strategy.local_only')}</p>}
      </FormGroup>
      {strategy.decision_engine === 'jev' && <div>
        <p className="settings-desc">{t('settings.ai.model_strategy.jev_help')}</p>
        <JevConnection connected={jevConnected} onConnect={onConnectJev} />
      </div>}
    </>}
  </>;
}
