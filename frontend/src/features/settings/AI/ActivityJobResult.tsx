import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeActivityJob, readActivityJobResult } from '../../../shared/api/ai-activity';

export function ActivityJobResult({ jobId, status, canEdit, onChanged }: {
    readonly jobId: string; readonly status: string; readonly canEdit: boolean;
    readonly onChanged: () => Promise<void>;
}) {
    const { t } = useTranslation();
    const [result, setResult] = useState<unknown>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const act = async (action: 'result' | 'cancel' | 'resume') => {
        setBusy(true); setError('');
        try {
            if (action === 'result') setResult(await readActivityJobResult(jobId));
            else { await changeActivityJob(jobId, action); await onChanged(); }
        } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setBusy(false); }
    };
    return <div className="ai-resource-details">
        <div className="ai-resource-card__actions">
            {['completed', 'complete', 'succeeded', 'done'].includes(status) && <button type="button" disabled={busy} onClick={() => { void act('result'); }}>{t('activity.read_result')}</button>}
            {canEdit && ['running', 'queued', 'pending'].includes(status) && <button type="button" disabled={busy} onClick={() => { void act('cancel'); }}>{t('common.cancel')}</button>}
            {canEdit && ['paused', 'failed', 'cancelled', 'canceled'].includes(status) && <button type="button" disabled={busy} onClick={() => { void act('resume'); }}>{t('activity.resume')}</button>}
        </div>
        {busy && <p role="status">{t('common.loading')}</p>}
        {error && <p role="alert">{error}</p>}
        {result !== undefined && <pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>}
    </div>;
}
