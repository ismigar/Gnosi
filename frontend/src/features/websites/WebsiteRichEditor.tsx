import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InstructionMarkdownEditor } from '../../shared/editor/InstructionMarkdownEditor';
import { previewSiteImage } from '../../shared/api/sites';
import { useWebsiteAssets } from './websiteAssetContext';
import { WebsiteFileField } from './WebsiteFileField';
import { Disclosure, Field, Input } from './components';

/** One rich text surface per column, using the same guarded upload modal as other Webs assets. */
export function WebsiteRichEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const scope = useWebsiteAssets();
  const [image, setImage] = useState('');
  const [alt, setAlt] = useState('');
  const urls = useRef(new Map<string, string>());
  const controller = useRef(new AbortController());
  useEffect(() => {
    const pending = new AbortController(); controller.current = pending;
    const cache = urls.current;
    return () => { pending.abort(); cache.forEach(url => { URL.revokeObjectURL(url); }); cache.clear(); };
  }, [scope?.siteId, scope?.context]);
  const resolveFileUrl = useCallback(async (source: string) => {
    const cached = urls.current.get(source);
    if (cached) return cached;
    if (!scope || !source.startsWith('/') || source.startsWith('//')) return '';
    const pending = controller.current;
    const blob = await previewSiteImage(scope.siteId, source, scope.context, pending.signal);
    if (pending.signal.aborted) return '';
    const existing = urls.current.get(source);
    if (existing) return existing;
    const url = URL.createObjectURL(blob); urls.current.set(source, url); return url;
  }, [scope]);
  return <div>
    <InstructionMarkdownEditor label={label} value={value} onChange={onChange} persistentToolbar resolveFileUrl={resolveFileUrl} />
    <Disclosure title={t('websites.addImage')}>
      <WebsiteFileField kind="image" label={t('websites.rows.insertImage')} value={image} onChange={setImage} />
      <Field label={t('websites.rows.imageDescription')}><Input value={alt} onChange={event => { setAlt(event.target.value); }} /></Field>
      <button type="button" className="websites-button" disabled={!image} onClick={() => {
        // Angle brackets keep spaces and parentheses in uploaded paths intact.
        onChange(`${value}\n\n![${alt.replace(/[[\]\\]/gu, '\\$&')}](<${encodeURI(image).replace(/>/gu, '%3E')}>)\n`);
        setImage(''); setAlt('');
      }}>{t('websites.rows.insertImage')}</button>
    </Disclosure>
  </div>;
}
