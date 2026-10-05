import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reviewTaskEvaluation, type TaskEvaluationPlan, type TaskEvaluationSuite } from '../../../shared/api/ai-activity';

type Case = NonNullable<TaskEvaluationPlan['reused_cases']>[number];

function SampleResult({ item, suite, busy, onReviewed }: {
    readonly item: Case; readonly suite: TaskEvaluationSuite; readonly busy: boolean; readonly onReviewed: () => void;
}) {
    const { t } = useTranslation();
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const criterion = suite.criteria.find(criterion => criterion.id === item.id);
    const review = async (verdict: 'accepted' | 'rejected') => {
        if (!item.reused_from || saving || busy) return;
        setSaving(true); setError(false);
        try {
            await reviewTaskEvaluation(item.reused_from, { case_id: item.id, verdict, note });
            onReviewed();
        } catch { setError(true); }
        finally { setSaving(false); }
    };
    return <details>
        <summary>{criterion?.title || t(`model_comparison.tests.metrics.${item.metric}`)} · {t(item.passed ? 'agent_team.lab_pass' : 'agent_team.lab_fail')}
            {item.requires_review && ` · ${t(`model_comparison.tests.review_${item.review}`)}`}</summary>
        {criterion && <>
            <p>{t('model_comparison.tests.sample_prompt')}</p><pre>{item.task_prompt || criterion.prompt}</pre>
            <p>{t('model_comparison.tests.expected')}</p><pre>{JSON.stringify(item.expected ?? criterion.expected, null, 2)}</pre>
        </>}
        <p>{t('model_comparison.tests.deliverable')}</p><pre>{item.output}</pre>
        {item.requires_review && <p>{t('model_comparison.tests.review_help')}</p>}
        {item.review_note && <p>{item.review_note}</p>}
        {item.requires_review && item.passed && item.reused_from && item.evidence_origin !== 'shared' && <>
            <label>{t('model_comparison.tests.review_note')}<textarea className="gnosi-input" value={note}
                maxLength={2000} disabled={busy || saving} onChange={event => { setNote(event.target.value); }} /></label>
            <div className="model-task-choice__actions">
                <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busy || saving}
                    onClick={() => { void review('accepted'); }}>{t('model_comparison.tests.accept')}</button>
                <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busy || saving}
                    onClick={() => { void review('rejected'); }}>{t('model_comparison.tests.reject')}</button>
            </div>
        </>}
        {error && <p role="alert">{t('model_comparison.tests.review_error')}</p>}
    </details>;
}

export function ModelTaskSampleResults({ results, suite, busy, onReviewed }: {
    readonly results: readonly Case[]; readonly suite: TaskEvaluationSuite; readonly busy: boolean; readonly onReviewed: () => void;
}) {
    return <div>{results.filter(item => item.output).map(item =>
        <SampleResult key={`${item.id}:${item.reviewed_at}`} item={item} suite={suite} busy={busy} onReviewed={onReviewed} />)}</div>;
}
