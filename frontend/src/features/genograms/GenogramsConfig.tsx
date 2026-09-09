import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { prepareGenograms } from '../../shared/api/genograms';
import { emitAppEvent } from '../../shared/platform/app-events';
import { usePlugins } from '../../shared/plugins/usePlugins';
import { errorMessage } from './errors';

export default function GenogramsConfig() {
  const { t, i18n } = useTranslation();
  const { isEnabled } = usePlugins();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const prepare = async () => {
    setBusy(true); setMessage('');
    try {
      const language = i18n.resolvedLanguage?.split('-')[0] ?? 'en';
      await prepareGenograms(language === 'ca' || language === 'es' || language === 'fr' ? language : 'en');
      emitAppEvent('gnosi:genograms-prepared');
      emitAppEvent('gnosi:genograms-changed');
      setMessage(t('genograms.prepared'));
    } catch (error) { setMessage(errorMessage(error, t)); }
    finally { setBusy(false); }
  };
  return <div className="p-4 text-sm"><p>{t('genograms.setup_description')}</p><button className="btn-gnosi mt-3" disabled={busy || !isEnabled('genograms')} onClick={() => { void prepare(); }}>{t(busy ? 'common.loading' : 'genograms.prepare')}</button><p role="status">{message}</p></div>;
}
