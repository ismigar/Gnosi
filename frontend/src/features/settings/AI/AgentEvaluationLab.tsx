import './AIResourcesSettings.css';
import './AgentEvaluationLab.css';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { fetchEvaluationAgents, fetchRoleEvaluations, runRoleEvaluation, type EvaluationAgent, type EvaluationRequest, type RoleEvaluationReport } from '../../../shared/api/ai-activity';

const roles = ['director', 'allrounder', 'documentalist', 'expert', 'administrative', 'worker'] as const;
const strategies = ['allrounder', 'director_always', 'director_routes'];
export function AgentEvaluationLab({ onComplete }: { onComplete?: () => void }) {
    const { t } = useTranslation();
    const vault = useActiveVaultId();
    const activeVault = useRef(vault);
    useLayoutEffect(() => { activeVault.current = vault; }, [vault]);
    const [open, setOpen] = useState(false);
    const [agents, setAgents] = useState<EvaluationAgent[]>([]);
    const [reports, setReports] = useState<RoleEvaluationReport[]>([]);
    const [kind, setKind] = useState<'role' | 'strategies'>('role');
    const [role, setRole] = useState<EvaluationRequest['role']>('allrounder');
    const [agent, setAgent] = useState('');
    const [director, setDirector] = useState('');
    const [executor, setExecutor] = useState('');
    const [authorized, setAuthorized] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        const aborted = () => controller.signal.aborted;
        void Promise.resolve().then(async () => {
            if (aborted()) return;
            setAgents([]); setReports([]); setAuthorized(false);
            if (!open) return;
            const [a, r] = await Promise.all([fetchEvaluationAgents(controller.signal), fetchRoleEvaluations(controller.signal)]);
            if (!aborted()) { setAgents(a); setReports(r); setError(''); }
        }).catch(() => { if (!controller.signal.aborted) setError('agent_team.lab_error'); });
        return () => { controller.abort(); };
    }, [open, vault, revision]);
    const run = async () => {
        const requestVault = vault;
        setBusy(true); setError('');
        try {
            const report = await runRoleEvaluation({ kind, role, agent_id: agent, director_id: director, executor_id: executor, authorize_model_calls: authorized });
            if (activeVault.current !== requestVault) return;
            setReports(previous => [report, ...previous]); setAuthorized(false); onComplete?.();
        } catch { if (activeVault.current === requestVault) setError('agent_team.lab_error'); }
        finally { setBusy(false); }
    };
    const chooser = (label: string, value: string, set: (id: string) => void) => <label>{label}<select className="gnosi-select" value={value} disabled={busy} onChange={e => { set(e.target.value); setAuthorized(false); }}><option value="">—</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name} · {a.provider}/{a.model}</option>)}</select></label>;
    return <section className="ai-resource-card agent-evaluation-lab">
        <header className="agent-evaluation-lab__header"><button className="ai-resource-card__main" type="button" aria-expanded={open} onClick={() => { setOpen(v => !v); }}>{open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}<span className="ai-resource-card__heading"><strong>{t('agent_team.lab_title')}</strong></span></button>{open && <RefreshButton disabled={busy} onClick={() => { setRevision(v => v + 1); }} />}</header>
        {open && <div className="ai-resource-editor agent-evaluation-lab__content">
            <p className="settings-desc">{t('agent_team.lab_help')}</p>
            <div className="ai-resource-editor__grid agent-evaluation-lab__fields">
            <label>{t('agent_team.lab_kind')}<select className="gnosi-select" value={kind} disabled={busy} onChange={e => { setKind(e.target.value as 'role' | 'strategies'); setAuthorized(false); }}><option value="role">{t('agent_team.lab_role')}</option><option value="strategies">{t('agent_team.lab_strategies')}</option></select></label>
            {chooser(t(kind === 'role' ? 'agent_team.lab_agent' : 'model_comparison.profiles.allrounder'), agent, setAgent)}
            {kind === 'role' ? <label>{t('model_comparison.profile')}<select className="gnosi-select" value={role} disabled={busy} onChange={e => { setRole(e.target.value as EvaluationRequest['role']); setAuthorized(false); }}>{roles.map(r => <option key={r} value={r}>{t(`model_comparison.profiles.${r}`)}</option>)}</select></label> : <>
                {chooser(t('model_comparison.profiles.director'), director, setDirector)}
                {chooser(t('agent_team.lab_executor'), executor, setExecutor)}
            </>}
            </div>
            <div className="agent-evaluation-lab__authorization"><span>{t('agent_team.lab_authorize')}</span><GnosiToggle label={t('agent_team.lab_authorize')} active={authorized} onChange={() => { setAuthorized(v => !v); }} disabled={busy} /></div>
            <div className="ai-resource-editor__actions"><button className="btn-gnosi btn-gnosi-primary" type="button" disabled={busy || !authorized || !agents.some(a => a.id === agent) || (kind === 'strategies' && (!agents.some(a => a.id === director) || !agents.some(a => a.id === executor)))} onClick={() => { void run(); }}>{t(busy ? 'agent_team.lab_running' : 'agent_team.lab_run')}</button></div>
            {error && <p className="ai-resource-alert is-error" role="alert">{t(error)}</p>}
            <p className="settings-desc">{t('agent_team.lab_limitations')}</p>
            {reports.slice(0, 10).map(report => <article className="ai-resource-card agent-evaluation-lab__report" key={report.id}>
                <strong>{report.model} · {report.role ? t(`model_comparison.profiles.${report.role}`) : t('agent_team.lab_strategies')}</strong>
                <p>{(report.participants ?? []).map(p => `${t(p.role === 'executor' ? 'agent_team.lab_executor' : `model_comparison.profiles.${p.role}`)}: ${p.provider}/${p.model}`).join(' · ')}</p>
                <p>{report.created_at} · {report.version} · {report.score}%</p>
                {report.kind === 'strategies' && <div className="agent-evaluation-lab__results"><table className="model-comparison-table"><thead><tr>{['strategy', 'passed', 'calls', 'director_calls', 'avoidable', 'cost'].map(k => <th key={k}>{t(`agent_team.lab_${k}`)}</th>)}</tr></thead><tbody>{strategies.map(strategy => {
                    const cases = report.cases.filter(c => c.strategy === strategy);
                    const known = cases.every(c => c.cost_usd != null);
                    return <tr key={strategy}><td>{t(`agent_team.lab_${strategy}`)}</td><td>{cases.filter(c => c.passed).length}/{cases.length}</td><td>{cases.reduce((n, c) => n + c.model_calls, 0)}</td><td>{cases.reduce((n, c) => n + c.director_calls, 0)}</td><td>{cases.reduce((n, c) => n + c.avoidable_director_calls, 0)}</td><td>{known ? `$${cases.reduce((n,c) => n + (c.cost_usd ?? 0),0).toFixed(6)}` : t('model_comparison.unknown_cost')}</td></tr>;
                })}</tbody></table></div>}
                <details><summary>{t('agent_team.evidence')}</summary><ul>{report.cases.map(c => <li key={`${c.strategy}:${c.id}`}>{c.strategy && `${t(`agent_team.lab_${c.strategy}`)} · `}{c.id}: {t(c.passed ? 'agent_team.lab_pass' : 'agent_team.lab_fail')} · {c.model_calls} {t('agent_team.lab_calls')} · {c.latency_ms} ms · {c.cost_usd == null ? t('model_comparison.unknown_cost') : `$${c.cost_usd.toFixed(6)}`}</li>)}</ul></details>
            </article>)}
        </div>}
    </section>;
}
