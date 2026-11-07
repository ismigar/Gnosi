import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewCatalogueFont } from '../../shared/api/sites';
import type { RequestContext } from '../../shared/api/request-context';

const pending: (() => Promise<void>)[] = [];
let running = 0;
function pump() {
  while (running < 2 && pending.length) {
    const next = pending.shift();
    if (next) { running++; void next().finally(() => { running--; pump(); }); }
  }
}

/** Load visible options only; names render with isolated, temporary FontFaces. */
export function CatalogueFontSample({ id, family, provider, context }: { id: string; family: string; provider: string; context: RequestContext }) {
  const { t } = useTranslation();
  const element = useRef<HTMLSpanElement>(null);
  const alias = `GnosiCatalogue-${useId().replace(/[^a-zA-Z0-9-]/gu, '')}`;
  const [loaded, setLoaded] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (typeof FontFace === 'undefined' || typeof document.fonts?.add !== 'function') return;
    const abort = new AbortController(); let face: FontFace | undefined; let queued = false;
    const load = async () => {
      if (abort.signal.aborted) return;
      const timer = setTimeout(() => { abort.abort(); }, 20_000);
      try {
        const blob = await previewCatalogueFont(id, context, abort.signal);
        if (abort.signal.aborted || blob.size > 500_000 || blob.size === 0) return;
        face = await new FontFace(alias, await blob.arrayBuffer()).load();
        if (abort.signal.aborted) return;
        document.fonts.add(face); setLoaded(id);
      } catch { if (!abort.signal.aborted) setFailed(true); }
      finally { clearTimeout(timer); }
    };
    const enqueue = () => { if (!queued) { queued = true; pending.push(load); pump(); } };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); enqueue(); }
    });
    if (observer && element.current) observer.observe(element.current); else enqueue();
    return () => { observer?.disconnect(); abort.abort(); if (face) document.fonts.delete(face); };
  }, [alias, context, family, id]);
  return <span ref={element} title={failed ? t('websites.fontSampleUnavailable') : family}>
    <span className="websites-font-sample" data-font-loaded={loaded === id} style={{ fontFamily: loaded === id ? `"${alias}"` : undefined }}>{family}</span>
    <small className="websites-muted"> · {provider}</small>
  </span>;
}
