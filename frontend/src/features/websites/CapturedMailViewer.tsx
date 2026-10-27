import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServiceRequest, SiteConfig } from '../../shared/api/sites';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { Card, Field, Input, Select } from './components';
import { WebsitePreview } from './AppearanceEditor';
import { capturedDisplayHtml, splitList } from './helpers';
import { decodeCapturedMail, type CapturedLink, type CapturedMail } from './serviceModels';

export function CapturedMailViewer({ id, site, call, onClose, onChanged }: { id: string; site: SiteConfig; call: (action: string, request: ServiceRequest['request']) => Promise<unknown>; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [mail, setMail] = useState<CapturedMail | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0); const [html, setHtml] = useState(false);
  const [selected, setSelected] = useState<CapturedLink | null>(null); const [language, setLanguage] = useState(site.default_language); const [interests, setInterests] = useState('');
  const generation = useRef(0);
  const reader = useRef<HTMLElement>(null); const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (mail?.id) reader.current?.focus(); }, [mail?.id]);
  useEffect(() => { if (selected) { form.current?.scrollIntoView({ block: 'nearest' }); form.current?.querySelector<HTMLElement>('select,input,button')?.focus(); } }, [selected]);
  useEffect(() => {
    let active = true; const current = ++generation.current;
    const isCurrent = () => active && current === generation.current;
    void Promise.resolve().then(async () => {
      if (!isCurrent()) return; setLoading(true); setBusy(false); setError(''); setSelected(null); setMail(null); setNotice('');
      try {
        const value = decodeCapturedMail(await call('captured_get', { id }));
        if (!isCurrent()) return;
        if (!value || value.id !== id) throw new Error('Invalid captured mail');
        setMail(value);
      } catch { if (isCurrent()) setError(t('websites.captureUnavailable')); }
      finally { if (isCurrent()) setLoading(false); }
    });
    return () => { active = false; generation.current = current + 1; };
  }, [call, id, refresh, t]);
  const choose = (link: CapturedLink) => { setSelected(link); setLanguage(mail?.language || link.language); setInterests(mail?.interests.join(', ') ?? ''); setNotice(''); setError(''); };
  const apply = async () => {
    if (busy || !selected || selected.state !== 'ready') return;
    const current = generation.current; setBusy(true); setError(''); setNotice('');
    try {
      const value = decodeCapturedMail(await call('captured_apply', { id, link_index: selected.index, ...(selected.action === 'preferences' ? { language, interests: splitList(interests) } : {}) }));
      if (current !== generation.current) return;
      if (!value || value.id !== id) throw new Error('Invalid captured mail');
      setMail(value); setSelected(null); setNotice(t(value.actionApplied ? 'websites.captureActionApplied' : 'websites.captureLinkUnavailable')); reader.current?.focus({ preventScroll: true }); onChanged();
    } catch { if (current === generation.current) setError(t('websites.captureActionFailed')); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const linkLabel = (link: CapturedLink) => link.action === 'unsubscribe' ? t(link.listId === '*' ? 'websites.captureUnsubscribeAll' : 'websites.captureUnsubscribeList', { list: link.listId }) : t(`websites.captureActions.${link.action}`);
  return <section id={`websites-captured-${id}`} ref={reader} tabIndex={-1} aria-label={t('websites.capturedMail')} aria-busy={loading || busy}><Card title={t('websites.capturedMail')} actions={<div className="websites-actions"><RefreshButton loading={loading || busy} disabled={loading || busy} onClick={() => { setRefresh(value => value + 1); }} /><button type="button" className="websites-button" onClick={onClose}>{t('websites.closeCapture')}</button></div>}>
    <p className="websites-notice">{t('websites.captureHelp')}</p>
    {loading && <p role="status">{t('websites.loading')}</p>}{error && <p role="alert" className="websites-error">{error}</p>}{notice && <p role="status" className="websites-notice">{notice}</p>}
    {mail && <><h3 className="websites-message">{mail.subject}</h3><p className="websites-message">{t('websites.email')}: {mail.email}<br />{t('websites.senderEmail')}: {mail.fromEmail}<br />{mail.createdAt}</p>
      <div className="websites-actions websites-spacer"><button type="button" className="websites-button" aria-pressed={!html} onClick={() => { setHtml(false); }}>{t('websites.textBody')}</button><button type="button" className="websites-button" aria-pressed={html} onClick={() => { setHtml(true); }}>{t('websites.captureHtml')}</button></div>
      {html ? <WebsitePreview title={t('websites.captureHtml')} html={capturedDisplayHtml(mail.html)} /> : <pre className="websites-message">{mail.text}</pre>}
      <h3>{t('websites.captureLinks')}</h3>{!mail.links.length && <p className="websites-muted">{t('websites.captureNoLinks')}</p>}
      <div className="websites-list">{mail.links.map(link => <div className="websites-row" key={link.index}><div className="websites-row-title"><strong>{linkLabel(link)}</strong><span className="websites-badge">{t(`websites.captureLinkStates.${link.state}`)}</span></div><div className="websites-actions websites-spacer"><button type="button" className="websites-button" aria-controls={`websites-captured-action-${id}`} aria-expanded={selected?.index === link.index} disabled={busy || link.state !== 'ready'} onClick={() => { choose(link); }}>{t('websites.captureTestLink')}</button><a className="websites-button" href={link.url} target="_blank" rel="noopener noreferrer">{t('websites.captureOpenPublic')}</a></div></div>)}</div>
      {selected && <form id={`websites-captured-action-${id}`} ref={form} className="websites-row websites-spacer" onSubmit={event => { event.preventDefault(); void apply(); }}><h3>{linkLabel(selected)}</h3><p className="websites-muted">{t('websites.captureConfirmHelp', { email: mail.email })}</p><fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>{selected.action === 'preferences' && <div className="websites-grid"><Field label={t('websites.language')}><Select value={language} onChange={event => { setLanguage(event.target.value); }}>{(site.languages ?? []).map(value => <option value={value} key={value}>{value.split('-')[0]?.toUpperCase()}</option>)}</Select></Field><Field label={t('websites.interests')}><Input value={interests} onChange={event => { setInterests(event.target.value); }} /></Field></div>}<button type="submit" className="btn btn-gnosi-primary websites-spacer">{t(`websites.captureConfirmActions.${selected.action}`)}</button></fieldset></form>}
    </>}
  </Card></section>;
}
