import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { reviewModelParameters, type ParameterReviewResponse } from '../../../shared/api/ai-activity';

export function ModelParameterReview({ modelId, modelName, onUpdated }: { modelId: string; modelName: string; onUpdated?: () => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<ParameterReviewResponse | null>(null);
    const [status, setStatus] = useState<'known' | 'not_published'>('known');
    const [total, setTotal] = useState('');
    const [active, setActive] = useState('');
    const [source, setSource] = useState('');
    const [reviewed, setReviewed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const request = async (action: 'inspect' | 'refresh' | 'save') => {
        setBusy(true); setError(false);
        try {
            const result = await reviewModelParameters({ model_id: modelId, action, status,
                total: total === '' ? null : Number(total), active: active === '' ? null : Number(active), source, reviewed });
            setData(result);
            if (result.status !== 'pending') {
                setSource(result.source || ''); setStatus(result.status as 'known' | 'not_published');
                setTotal(result.total == null ? '' : String(result.total)); setActive(result.active == null ? '' : String(result.active));
                setReviewed(false);
                if (action !== 'inspect') onUpdated?.();
            }
        } catch { setError(true); }
        finally { setBusy(false); }
    };
    const valid = reviewed && source.startsWith('https://') && (status === 'not_published' || (Number(total) > 0 && (active === '' || (Number(active) > 0 && Number(active) <= Number(total)))));
    return <div className="model-role-assessments">
        <button className="btn-gnosi-secondary" type="button" disabled={busy} onClick={() => { setOpen(v => !v); if (!open && !data) void request('inspect'); }}>{t('model_comparison.parameters_missing')}</button>
        {open && <div className="model-role-assessments__body">
            <strong>{modelName}</strong>
            <div className="flex justify-end"><RefreshButton label={t('model_comparison.review_lookup')} loading={busy} onClick={() => { void request('refresh'); }} /></div>
            <p>{t('model_comparison.review_help')}</p>
            {(data?.source_links ?? []).map((link,i) => <p key={link}><a href={link} target="_blank" rel="noreferrer">{t('model_comparison.review_source_link')} {i+1} ↗</a></p>)}
            {data && <p role="status">{t(`model_comparison.review_outcomes.${data.outcome}`)}{data.total != null && ` · ${String(data.total)} B`}{data.source && <> · <a href={data.source} target="_blank" rel="noreferrer">{t('model_comparison.parameters_source')}</a></>}</p>}
            <label>{t('model_comparison.review_status')}<select className="gnosi-select" disabled={busy} value={status} onChange={e => { setStatus(e.target.value as 'known' | 'not_published'); setReviewed(false); }}><option value="known">{t('model_comparison.review_known')}</option><option value="not_published">{t('model_comparison.parameters_not_published')}</option></select></label>
            {status === 'known' && <>
                <label>{t('model_comparison.review_total')}<input className="gnosi-input" disabled={busy} type="number" min="0" step="any" value={total} onChange={e => { setTotal(e.target.value); setReviewed(false); }} /></label>
                <label>{t('model_comparison.review_active')}<input className="gnosi-input" disabled={busy} type="number" min="0" step="any" value={active} onChange={e => { setActive(e.target.value); setReviewed(false); }} /></label>
            </>}
            <label>{t('model_comparison.parameters_source')}<input className="gnosi-input" disabled={busy} type="url" value={source} onChange={e => { setSource(e.target.value); setReviewed(false); }} /></label>
            <div className="flex gap-2"><span>{t('model_comparison.review_attest')}</span><GnosiToggle label={t('model_comparison.review_attest')} active={reviewed} disabled={busy} onChange={() => { setReviewed(v => !v); }} /></div>
            <button className="btn-gnosi-primary" type="button" disabled={busy || !valid} onClick={() => { void request('save'); }}>{t('model_comparison.review_save')}</button>
            {error && <p role="alert">{t('model_comparison.review_error')}</p>}
        </div>}
    </div>;
}
