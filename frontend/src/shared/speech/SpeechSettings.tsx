import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchSpeechSettings, saveSpeechSettings, type SpeechSettings as Settings } from '../api/speech-output';
import { useActiveVaultId } from '../hooks/useActiveVaultId';
import { useSpeechOutput } from './useSpeechOutput';
import './speech.css';
import { emitAppEvent } from '../platform/app-events';

/** One saved configuration serves chat, Reader podcasts and generated audio. */
export function SpeechSettings({ editable = false, previewDisabled = false }: { editable?: boolean; previewDisabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const vault = useActiveVaultId();
  const queryClient = useQueryClient();
  const queryKey = ['speech-settings', vault];
  const configuration = useQuery({ queryKey, queryFn: ({ signal }) => fetchSpeechSettings(signal), staleTime: 10000 });
  const [draft, setDraft] = useState<Settings | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const output = useSpeechOutput(undefined, i18n.language);
  useEffect(() => { setDraft(configuration.data?.settings); }, [configuration.data]);
  useEffect(() => { if (previewDisabled) output.stop(); }, [previewDisabled, output.stop]);
  if (configuration.isPending) return <p role="status">{t('speech.loading')}</p>;
  if (configuration.isError || !configuration.data || !draft) return <p role="alert">{t('speech.settings_failed')}</p>;
  const data = configuration.data;
  const language = draft.language === 'auto' ? i18n.language.toLowerCase().split(/[-_]/)[0] : draft.language;
  const localVoices = data.local_voices.filter(voice => voice.language.toLowerCase().split(/[-_]/)[0] === language);
  const update = (patch: Partial<Settings>) => { output.stop(); setSaved(false); setDraft({ ...draft, ...patch }); };
  const save = async () => {
    output.stop(); setSaving(true); setSaveError(false); setSaved(false);
    try {
      const next = await saveSpeechSettings(draft);
      queryClient.setQueryData(queryKey, next); setSaved(true);
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const available = data.settings.provider === 'openai' ? data.openai_configured : data.local_available;
  return <section className="gnosi-speech-settings" aria-label={t('speech.title')}>
    <p>{t('speech.shared')}</p>
    {editable ? <>
      <label>{t('speech.engine')}
        <select className="gnosi-select" disabled={saving} value={draft.provider} onChange={event => { update({ provider: event.target.value === 'openai' ? 'openai' : 'local', voice: 'auto' }); }}>
          <option value="local">{t('speech.local')}</option><option value="openai">{t('speech.neural')}</option>
        </select>
      </label>
      <label>{t('speech.voice')}
        <select className="gnosi-select" disabled={saving} value={draft.voice} onChange={event => { update({ voice: event.target.value }); }}>
          <option value="auto">{t('speech.automatic')}</option>
          {draft.provider === 'openai' ? <><option value="marin">Marin</option><option value="cedar">Cedar</option></>
            : localVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.id} · {voice.language}</option>)}
        </select>
      </label>
      <label>{t('speech.language')}
        <select className="gnosi-select" disabled={saving} value={draft.language} onChange={event => { const language = event.target.value; if (language === 'auto' || language === 'ca' || language === 'en' || language === 'es' || language === 'fr') update({ language, ...(draft.provider === 'local' ? { voice: 'auto' } : {}) }); }}>
          <option value="auto">{t('speech.automatic')}</option><option value="ca">Català</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option>
        </select>
      </label>
      <label>{t('speech.speed')}
        <select className="gnosi-select" disabled={saving} value={draft.speed} onChange={event => { update({ speed: Number(event.target.value) }); }}>
          <option value="0.85">{t('speech.slow')}</option><option value="1">{t('speech.normal')}</option><option value="1.15">{t('speech.fast')}</option>
        </select>
      </label>
    </> : <p>{t(data.settings.provider === 'openai' ? 'speech.neural' : 'speech.local')} · {data.settings.voice === 'auto' ? t('speech.automatic') : data.settings.voice}<br />{t('speech.configure')}</p>}
    {(editable ? draft.provider : data.settings.provider) === 'openai' && <p>{t('speech.external_notice')}{!data.openai_configured && <> {t('speech.openai_missing')}</>}</p>}
    {(editable ? draft.provider : data.settings.provider) === 'local' && !data.local_available && <p role="alert">{t('speech.local_missing')}</p>}
    <div className="gnosi-speech-settings__actions">
      {!editable && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { output.stop(); emitAppEvent('open-settings', { tab: 'voice' }); }}>{t('speech.open_settings')}</button>}
      {editable && <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!dirty || saving} onClick={() => { void save(); }}>{t('speech.save')}</button>}
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={previewDisabled || saving || dirty || !available || output.state !== 'idle'} onClick={() => { void output.preview(); }}>{t('speech.preview')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={output.state === 'idle'} onClick={output.stop}>{t('speech.stop')}</button>
    </div>
    {output.state !== 'idle' && <p role="status">{t(output.state === 'preparing' ? 'speech.preparing' : 'speech.speaking')}</p>}
    {(saveError || output.error) && <p role="alert">{t(saveError ? 'speech.settings_failed' : 'speech.failed')}</p>}
    {saved && <p role="status">{t('speech.saved')}</p>}
    <p>{t('speech.existing_audio')}</p>
  </section>;
}
