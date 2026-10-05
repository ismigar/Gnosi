import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportPublicTaskEvaluation } from '../../../shared/api/ai-activity';

/** Downloads only after the user has inspected an allowlisted, public-sample export. */
export function ModelTaskPublicExport({ reportIds, disabled }: {
    readonly reportIds: readonly string[]; readonly disabled: boolean;
}) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState(reportIds[0] ?? '');
    const [preview, setPreview] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const report = reportIds.includes(selected) ? selected : reportIds[0];
    const inspect = async () => {
        if (!report || busy) return;
        setBusy(true); setError(false); setPreview('');
        try {
            const data = await exportPublicTaskEvaluation(report);
            if (alive.current) setPreview(JSON.stringify(data, null, 2));
        } catch { if (alive.current) setError(true); }
        finally { if (alive.current) setBusy(false); }
    };
    const download = () => {
        const url = URL.createObjectURL(new Blob([preview + '\n'], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'gnosi-public-model-evaluation.json'; link.click();
        setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
    };
    if (!report) return null;
    return <details className="model-task-recommendations__requirements">
        <summary>{t('model_comparison.shared.contribute')}</summary>
        <p>{t('model_comparison.shared.export_help')}</p>
        {reportIds.length > 1 && <label>{t('model_comparison.shared.attempt')}<select className="gnosi-select" value={report}
            disabled={disabled || busy} onChange={event => { setSelected(event.target.value); setPreview(''); }}>
            {reportIds.map((id, index) => <option key={id} value={id}>{index + 1}</option>)}
        </select></label>}
        <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={disabled || busy}
            onClick={() => { void inspect(); }}>{t('model_comparison.shared.inspect')}</button>
        {error && <p role="alert">{t('model_comparison.shared.export_error')}</p>}
        {preview && <>
            <pre>{preview}</pre>
            <p>{t('model_comparison.shared.public_warning')}</p>
            <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={disabled || busy}
                onClick={download}>{t('model_comparison.shared.download')}</button>
            <p><a href="https://github.com/ismigar/ismigar.github.io/tree/main/data/model-evaluations" target="_blank" rel="noreferrer">
                {t('model_comparison.shared.contribution_guide')}</a></p>
        </>}
    </details>;
}
