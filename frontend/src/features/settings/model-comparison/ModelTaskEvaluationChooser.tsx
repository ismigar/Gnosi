import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiModelComparisonEntry, AiModelRegistryEntry } from '../../../shared/api/ai';
import { ModelTaskEvaluation } from './ModelTaskEvaluation';
import type { TaskId } from './taskRecommendations';

/** Failed offers remain testable without assigning them to the bot. */
export function ModelTaskEvaluationChooser({ agentId, currentRoute, registry, models, tasks, currency, onComplete }: {
    readonly agentId: string; readonly currentRoute?: { provider: string; model: string };
    readonly registry: readonly AiModelRegistryEntry[]; readonly models: readonly AiModelComparisonEntry[];
    readonly tasks: readonly TaskId[]; readonly currency: { usd_rate: number; symbol: string }; readonly onComplete: () => void;
}) {
    const { t } = useTranslation();
    const routes = registry.filter(row => row.enabled && models.some(model =>
        model.routes.some(route => route.provider === row.provider)));
    const initial = routes.find(row => row.provider === currentRoute?.provider && row.model_id === currentRoute.model) ?? routes[0];
    const key = (row: AiModelRegistryEntry) => JSON.stringify([row.provider, row.model_id]);
    const [selected, setSelected] = useState(initial ? key(initial) : '');
    const [busy, setBusy] = useState(false);
    const route = routes.find(row => key(row) === selected) ?? initial;
    return <details className="model-task-recommendations__requirements">
        <summary>{t('model_comparison.tests.choose_title')}</summary>
        <p>{t('model_comparison.tests.choose_help')}</p>
        {route ? <>
            <label>{t('model_comparison.tests.choose_model')}<select className="gnosi-select" value={key(route)} disabled={busy}
                onChange={event => { setSelected(event.target.value); }}>
                {routes.map(row => <option key={key(row)} value={key(row)}>{row.model_id} · {row.provider}</option>)}
            </select></label>
            <ModelTaskEvaluation key={key(route)} agentId={agentId} provider={route.provider} model={route.model_id} tasks={tasks}
                currency={currency} active onComplete={onComplete} onBusyChange={setBusy} />
        </> : <p>{t('model_comparison.tests.activate_first')}</p>}
    </details>;
}
