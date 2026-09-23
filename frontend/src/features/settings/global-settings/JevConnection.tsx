import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchAiCatalog, setAiProviderCredentials, setAiProviderStatus } from '../../../shared/api/ai';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { isJsonRecord } from '../AI/aiResourcesApi';

export function JevConnection({ connected, onConnect }: { connected: boolean; onConnect: () => void }) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [storedKey, setStoredKey] = useState(connected);
  useEffect(() => {
    if (connected) return;
    const controller = new AbortController();
    void fetchAiCatalog(controller.signal).then(data => {
      const providers = data.config.providers;
      const provider = isJsonRecord(providers) ? providers.typesafe : null;
      if (!controller.signal.aborted && isJsonRecord(provider)) {
        setStoredKey(provider.has_api_key === true && provider.enabled !== false);
      }
    }).catch(() => { /* A stored key can still be replaced when status is unavailable. */ });
    return () => { controller.abort(); };
  }, [connected]);
  const connect = async () => {
    setBusy(true);
    setError(false);
    try {
      await setAiProviderCredentials('typesafe', { api_key: apiKey.trim(), base_url: null });
      await setAiProviderStatus('typesafe', { enabled: true });
      setApiKey('');
      onConnect();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return <div>
    {(connected || storedKey) && <p role="status" className="settings-desc">{t('settings.ai.model_strategy.jev_connected')}</p>}
    <FormGroup label={t('settings.ai.model_strategy.jev_key')} description={t('settings.ai.model_strategy.jev_key_help')}>
      <input type="password" className="gnosi-input" autoComplete="off" value={apiKey}
        aria-label={t('settings.ai.model_strategy.jev_key')} disabled={busy}
        onChange={event => { setApiKey(event.target.value); }} />
    </FormGroup>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlock: '16px' }}>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busy || !apiKey.trim()}
        onClick={() => { void connect(); }}>{t('settings.ai.model_strategy.jev_connect')}</button>
    </div>
    {error && <p role="alert">{t('settings.ai.model_strategy.jev_connection_error')}</p>}
  </div>;
}
