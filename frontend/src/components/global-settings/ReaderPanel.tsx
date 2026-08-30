import { FileUp } from 'lucide-react';
import { FormGroup } from './SettingsPrimitives';
import { GnosiToggle } from './SettingsPrimitives';
import { Newspaper } from 'lucide-react';
import { PasswordInput } from './PasswordInput';
import { Rss } from 'lucide-react';
import { Section } from './SettingsPrimitives';
import { SettingsSectionTabs } from '../SettingsSectionTabs';
import { Trash2 } from 'lucide-react';
import { deleteReaderSource } from '../../shared/api/reader';
import { parseModelRouteKey } from '../AI/aiSettingsUtils';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'handleAddNewsletter' | 'handleNewsletterOpmlUpload' | 'isOpen' | 'loadNewsletterSources' | 'newsletterAccount' | 'newsletterAccountStatus' | 'newsletterAccountSyncing' | 'newsletterAccountTesting' | 'newsletterAddress' | 'newsletterName' | 'newsletterOpmlLoading' | 'newsletterOpmlRef' | 'newsletterSources' | 'newsletterSourcesError' | 'newsletterSourcesLoaded' | 'newsletterSourcesLoading' | 'newsletterStatus' | 'newsletterType' | 'podcastModelRoutes' | 'readerSection' | 'setConfirmConfig' | 'setDraft' | 'setNewsletterAccount' | 'setNewsletterAccountStatus' | 'setNewsletterAddress' | 'setNewsletterName' | 'setNewsletterPasswordDirty' | 'setNewsletterStatus' | 'setNewsletterType' | 'setReaderSection' | 'syncNewsletterAccount' | 't' | 'testNewsletterAccount'> };

export function ReaderPanel({ context }: Props) {
  const { handleAddNewsletter, handleNewsletterOpmlUpload, loadNewsletterSources, newsletterAccount, newsletterAccountStatus, newsletterAccountSyncing, newsletterAccountTesting, newsletterAddress, newsletterName, newsletterOpmlLoading, newsletterOpmlRef, newsletterSources, newsletterSourcesError, newsletterSourcesLoaded, newsletterSourcesLoading, newsletterStatus, newsletterType, podcastModelRoutes, readerSection, setConfirmConfig, setDraft, setNewsletterAccount, setNewsletterAccountStatus, setNewsletterAddress, setNewsletterName, setNewsletterPasswordDirty, setNewsletterStatus, setNewsletterType, setReaderSection, syncNewsletterAccount, t, testNewsletterAccount } = context;
  return (<>
    <SettingsSectionTabs
      ariaLabel={t('settings.reader.sections_label')}
      activeId={readerSection}
      onChange={setReaderSection}
      items={[
        { id: 'podcast', icon: Newspaper, label: t('settings.reader.podcast_tab') },
        { id: 'subscriptions', icon: Rss, label: t('settings.reader.subscriptions_tab') },
      ]}
    />

    {readerSection === 'podcast' && (
      <Section title={t('settings.reader.podcast_title')} icon={Newspaper}>
        <div className="settings-desc" style={{ marginBottom: '24px', lineHeight: 1.6 }}>
          {t('settings.reader.podcast_description')}
        </div>
        <FormGroup
          label={t('settings.reader.model_label')}
          description={t('settings.reader.model_description')}
        >
          <select
            className="gnosi-select"
            value={podcastModelRoutes.selectedKey}
            onChange={event => {
              const route = parseModelRouteKey(event.target.value);
              setDraft(previous => ({
                ...previous,
                settings: {
                  ...previous.settings,
                  reader: {
                    ...(previous.settings.reader || {}),
                    podcast: route,
                  },
                },
              }));
            }}
          >
            <option value="">{t('settings.reader.default_model')}</option>
            {podcastModelRoutes.groups.map(([provider, modelIds]) => (
              <optgroup key={provider} label={provider}>
                {modelIds.map(modelId => (
                  <option key={modelId} value={`${provider}||${modelId}`}>
                    {modelId}
                  </option>
                ))}
              </optgroup>
            ))}
            {podcastModelRoutes.unavailableSelection && (
              <optgroup label={t('settings.reader.unavailable_group')}>
                <option value={podcastModelRoutes.unavailableSelection.key}>
                  {t('settings.reader.unavailable_model', {
                    provider: podcastModelRoutes.unavailableSelection.provider,
                    model: podcastModelRoutes.unavailableSelection.model,
                  })}
                </option>
              </optgroup>
            )}
          </select>
          {podcastModelRoutes.groups.length === 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
              {t('settings.reader.no_active_models')}
            </div>
          )}
        </FormGroup>
      </Section>
    )}

    {/* SUBSCRIPTIONS — dynamic form + list */}
    {readerSection === 'subscriptions' && (
      <Section title={t('subs_section_title')} icon={Rss} extra={
        <div style={{ display: 'inline-flex', gap: '8px' }}>
          <button onClick={() => { void loadNewsletterSources(); }} disabled={newsletterSourcesLoading} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', opacity: newsletterSourcesLoading ? 0.6 : 1, cursor: newsletterSourcesLoading ? 'wait' : 'pointer' }}>{newsletterSourcesLoading ? t('subs_btn_reload_loading') : t('subs_btn_reload')}</button>
          <button onClick={() => newsletterOpmlRef.current?.click()} disabled={newsletterOpmlLoading} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', opacity: newsletterOpmlLoading ? 0.6 : 1, cursor: newsletterOpmlLoading ? 'wait' : 'pointer' }}><FileUp size={16} /> {newsletterOpmlLoading ? t('subs_btn_import_opml_loading') : t('subs_btn_import_opml')}</button>
        </div>
      }>
        <input ref={newsletterOpmlRef} type="file" accept=".opml,.xml" onChange={(e) => { void handleNewsletterOpmlUpload(e.target.files?.[0]); }} style={{ display: 'none' }} />
        {newsletterSourcesError && (
          <div style={{ marginBottom: '20px', padding: '14px 20px', borderRadius: '14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--status-error)', fontSize: '0.9rem' }}>{newsletterSourcesError}</div>
        )}

        {/* SINGLE DYNAMIC FORM */}
        <div className="animate-in" style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', marginBottom: '40px', boxShadow: '0 12px 40px rgba(0,0,0,0.05)' }}>
          {/* Toggle 3-way */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
            {[
              { v: 'rss', icon: '📰' },
              { v: 'youtube', icon: '📺' },
              { v: 'newsletter', icon: '📧' }
            ].map(({ v, icon }) => (
              <button key={v} onClick={() => { setNewsletterType(v); setNewsletterStatus(''); setNewsletterAccountStatus(''); }} style={{
                padding: '10px 20px', borderRadius: '12px', border: '1px solid var(--settings-border)',
                background: newsletterType === v ? 'var(--gnosi-blue)' : 'transparent',
                color: newsletterType === v ? 'white' : 'var(--text-secondary)',
                fontSize: '0.85rem', fontWeight: '900', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
                display: 'inline-flex', alignItems: 'center', gap: '8px'
              }}>
                <span>{icon}</span>
                <span>{v}</span>
              </button>
            ))}
          </div>

          {/* Form subtitle (changes depending on type) */}
          <h4 style={{ margin: '0 0 18px 0', fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 900 }}>
            {newsletterType === 'rss' && t('subs_form_title_rss')}
            {newsletterType === 'youtube' && t('subs_form_title_youtube')}
            {newsletterType === 'newsletter' && t('subs_form_title_newsletter')}
          </h4>

          {/* RSS / YOUTUBE fields */}
          {(newsletterType === 'rss' || newsletterType === 'youtube') && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <FormGroup label={t('subs_form_field_name')}>
                  <input type="text" className="gnosi-input" value={newsletterName} onChange={e => { setNewsletterName(e.target.value); }} placeholder={t('subs_form_field_name_placeholder')} />
                </FormGroup>
                <FormGroup label={newsletterType === 'youtube' ? t('subs_form_youtube_url_label') : t('subs_form_rss_url_label')}>
                  <input type="text" className="gnosi-input" value={newsletterAddress} onChange={e => { setNewsletterAddress(e.target.value); }} placeholder={newsletterType === 'youtube' ? t('subs_form_youtube_url_placeholder') : t('subs_form_rss_url_placeholder')} />
                </FormGroup>
              </div>
              {newsletterType === 'youtube' && (
                <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  {t('subs_form_youtube_help')}
                </div>
              )}
              {newsletterStatus && (
                <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{newsletterStatus}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => { void handleAddNewsletter(); }} className="btn-gnosi-primary" style={{ padding: '12px 32px', borderRadius: '14px' }}>{t('subs_form_btn_add')}</button>
              </div>
            </>
          )}

          {/* NEWSLETTER fields (POP3 config) */}
          {newsletterType === 'newsletter' && (
            <>
              <div style={{ marginBottom: '18px', padding: '14px 18px', borderRadius: '12px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                {t('subs_news_warning')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <FormGroup label={t('subs_news_field_server')}>
                  <input type="text" className="gnosi-input" value={newsletterAccount.mail_server} onChange={e => { setNewsletterAccount(a => ({ ...a, mail_server: e.target.value })); }} placeholder={t('subs_news_field_server_placeholder')} />
                </FormGroup>
                <FormGroup label={t('subs_news_field_port')}>
                  <input type="number" className="gnosi-input" value={newsletterAccount.mail_port} onChange={e => { setNewsletterAccount(a => ({ ...a, mail_port: e.target.value })); }} placeholder="110" />
                </FormGroup>
                <FormGroup label={t('subs_news_field_ssl')}>
                  <select className="gnosi-input" value={newsletterAccount.mail_ssl} onChange={e => { setNewsletterAccount(a => ({ ...a, mail_ssl: e.target.value })); }}>
                    <option value="starttls">{t('subs_news_ssl_starttls')}</option>
                    <option value="ssl">{t('subs_news_ssl_ssl')}</option>
                    <option value="none">{t('subs_news_ssl_none')}</option>
                  </select>
                </FormGroup>
              </div>
              {/* Form wrapper so the browser's password manager associates user+password */}
              <form onSubmit={e => { e.preventDefault(); }} autoComplete="on" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <FormGroup label={t('subs_news_field_email')}>
                    <input
                      type="email"
                      className="gnosi-input"
                      value={newsletterAccount.email}
                      onChange={e => { setNewsletterAccount(a => ({ ...a, email: e.target.value })); }}
                      placeholder={t('subs_news_field_email_placeholder')}
                      name="newsletter-pop3-username"
                      autoComplete="username"
                    />
                  </FormGroup>
                  <FormGroup label={t('subs_news_field_password')}>
                    <PasswordInput
                      value={newsletterAccount.password}
                      onChange={e => { setNewsletterAccount(a => ({ ...a, password: e.target.value })); setNewsletterPasswordDirty(true); }}
                      name="newsletter-pop3-password"
                      autoComplete="current-password"
                    />
                  </FormGroup>
                </div>
              </form>
              {newsletterAccountStatus && (
                <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{newsletterAccountStatus}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <FormGroup label={t('subs_news_field_delete')} horizontal>
                  <GnosiToggle
                    active={newsletterAccount.delete_after_ingest}
                    label={t('subs_news_field_delete')}
                    onChange={() => { setNewsletterAccount(a => ({ ...a, delete_after_ingest: !a.delete_after_ingest })); }}
                  />
                </FormGroup>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button onClick={() => { void testNewsletterAccount(); }} disabled={newsletterAccountTesting} className="btn-gnosi-secondary" style={{ padding: '10px 18px', borderRadius: '12px', fontSize: '0.85rem', opacity: newsletterAccountTesting ? 0.6 : 1 }}>{newsletterAccountTesting ? t('subs_news_btn_test_loading') : t('subs_news_btn_test')}</button>
                  <button onClick={() => { void syncNewsletterAccount(); }} disabled={newsletterAccountSyncing} className="btn-gnosi-secondary" style={{ padding: '10px 18px', borderRadius: '12px', fontSize: '0.85rem', opacity: newsletterAccountSyncing ? 0.6 : 1 }}>{newsletterAccountSyncing ? t('subs_news_btn_sync_loading') : t('subs_news_btn_sync')}</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* COUNTER + SOURCE LIST */}
        <div style={{ marginBottom: '14px', color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>
          {newsletterSourcesLoading ? t('subs_count_loading', { count: newsletterSources.length }) : t('subs_count', { count: newsletterSources.length })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!newsletterSourcesLoading && newsletterSourcesLoaded && newsletterSources.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', background: 'var(--settings-sidebar-bg)', border: '1px dashed var(--settings-border)', borderRadius: '16px' }}>
              {t('subs_empty_state')}
            </div>
          )}
          {newsletterSources.map(s => (
            <div key={s.id} className="account-row hover-scale" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 30px', borderRadius: '24px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '22px', minWidth: 0, flex: 1 }}>
                <div style={{ width: '56px', height: '56px', background: 'rgba(59,130,246,0.12)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>
                  {s.type === 'rss' ? '📰' : (s.type === 'youtube' ? '📺' : '📧')}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.05rem' }}>{s.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
                  {s.category && s.category !== 'Uncategorized' && (
                    <div style={{ display: 'inline-block', marginTop: '6px', padding: '3px 10px', borderRadius: '8px', background: 'rgba(59,130,246,0.1)', color: 'var(--gnosi-blue)', fontSize: '0.72rem', fontWeight: 700 }}>{s.category}</div>
                  )}
                </div>
              </div>
              <button onClick={() => {
                setConfirmConfig({
                  isOpen: true,
                  title: t('subs_delete_modal_title'),
                  message: t('subs_delete_modal_message', { name: s.name }),
                  onConfirm: async () => {
                    try {
                      await deleteReaderSource(s.id);
                      void loadNewsletterSources();
                      setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                    } catch (e) {
                      console.error("Error deleting source:", e);
                    }
                  }
                });
              }} style={{ color: 'var(--status-error)', border: 'none', background: 'transparent', cursor: 'pointer', padding: '12px', borderRadius: '12px' }} className="hover-bg-danger"><Trash2 size={24} /></button>
            </div>
          ))}
        </div>
      </Section>
    )}
  </>);
}
