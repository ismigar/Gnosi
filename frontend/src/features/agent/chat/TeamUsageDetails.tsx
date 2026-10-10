import { useTranslation } from 'react-i18next';
import type { TeamUsageMetrics } from '../model/agentTeamUsage';

const labels: Record<string, string> = { planning: 'Planning', execution: 'Execution', synthesis: 'Synthesis', repair: 'Repair' };

export function TeamUsageDetails({ metrics }: { readonly metrics: TeamUsageMetrics }) {
    const { t } = useTranslation();
    if (!metrics.team_phases?.length) return null;
    return <>
        {metrics.team_phases.filter(row => row.model_calls > 0).map(row => <div key={row.phase}>
            {t('chat.team_phase_usage', '{{phase}}: {{input}} input · {{output}} output tokens · {{calls}} calls', {
                phase: t(`chat.team_phase_${row.phase}`, labels[row.phase] ?? row.phase),
                input: row.input_tokens, output: row.output_tokens, calls: row.model_calls,
            })}
            {row.cost_usd !== undefined && ` · $${row.cost_usd.toFixed(6)}`}
        </div>)}
        {metrics.team_route === 'continuation' && <div>{t('chat.team_reused', 'Same specialist: no new planning call.')}</div>}
        {metrics.team_usage_complete === false && <div>{t('chat.team_usage_partial', 'Partial usage: the provider did not report all tokens.')}</div>}
        {metrics.team_cost_source === 'unknown' && <div>{t('chat.team_cost_unknown', 'Cost unavailable.')}</div>}
    </>;
}
