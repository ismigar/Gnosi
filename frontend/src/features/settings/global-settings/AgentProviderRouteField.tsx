import { useTranslation } from 'react-i18next';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { validProviderRoute } from './agentProviderRoute';

export function AgentProviderRouteField({ provider, value, onChange }: {
  provider?: string; value?: string | null; onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  if (provider !== 'openrouter') return null;
  const invalid = !validProviderRoute(value);
  return <FormGroup label={t('settings.ai.assistant.upstream_provider')}
    description={t('settings.ai.assistant.upstream_provider_help')}>
    <input type="text" className="gnosi-input" value={value ?? ''} maxLength={128}
      aria-label={t('settings.ai.assistant.upstream_provider')} aria-invalid={invalid}
      autoCapitalize="none" spellCheck={false}
      placeholder={t('settings.ai.assistant.routing_automatic')}
      onChange={event => { onChange(event.target.value || null); }} />
    {invalid && <p role="alert">{t('settings.ai.assistant.upstream_provider_invalid')}</p>}
  </FormGroup>;
}
