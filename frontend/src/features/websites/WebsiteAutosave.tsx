import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraftAutosave } from '../../shared/hooks/useDraftAutosave';
import { DraftSaveStatus } from '../../shared/editor/DraftSaveStatus';
import { apiErrorDetail } from '../../shared/api/errors';
import type { RequestContext } from '../../shared/api/request-context';
import { saveSite, type SiteConfig } from '../../shared/api/sites';
import { configurationKey } from './helpers';
import { autosaveRequest, useAutosaveRegistration, type RegisterAutosave } from './autosaveRequest';


export function AutosaveStatus({ status, retry, detail }: { status: 'idle' | 'pending' | 'saving' | 'saved' | 'error'; retry: () => Promise<boolean>; detail?: string }) {
  const { t } = useTranslation();
  return <div className="websites-actions"><DraftSaveStatus status={status} detail={detail} />{status === 'error' && <><span className="websites-error">{detail}</span><button type="button" className="websites-button" onClick={() => { void retry(); }}>{t('common.retry')}</button></>}</div>;
}

/** One serialized writer keeps drafts for every site, including a site just left. */
export function WebsiteAutosave({ drafts, saved, context, onSaved, register }: { drafts: Record<string, SiteConfig>; saved: Record<string, SiteConfig>; context: RequestContext; onSaved: (value: SiteConfig, submitted: SiteConfig) => void; register: RegisterAutosave }) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState('');
  const baseline = useRef(saved);
  useLayoutEffect(() => { baseline.current = saved; }, [saved]);
  const snapshots = useMemo(() => Object.fromEntries(Object.entries(drafts).map(([id, value]) => [id, { ...value, revision: 0 }])), [drafts]);
  const write = useCallback(async (values: Record<string, SiteConfig>) => {
    for (const [id, value] of Object.entries(values)) {
      const previous = baseline.current[id];
      if (!previous || configurationKey(value) === configurationKey(previous)) continue;
      try {
        setFailure('');
        const result = await autosaveRequest(context, signal => saveSite({ ...value, revision: previous.revision }, context, signal));
        baseline.current = { ...baseline.current, [id]: result };
        onSaved(result, value);
      } catch (error) { setFailure(apiErrorDetail(error, t('websites.operationFailed'))); throw error; }
    }
  }, [context, onSaved, t]);
  const autosave = useDraftAutosave(snapshots, true, write);
  const pending = Object.values(drafts).some(value => { const previous = saved[value.id]; return previous && configurationKey(value) !== configurationKey(previous); });
  useAutosaveRegistration(register, 'public', pending, autosave.flush);
  return <AutosaveStatus status={autosave.status} retry={autosave.flush} detail={failure} />;
}
