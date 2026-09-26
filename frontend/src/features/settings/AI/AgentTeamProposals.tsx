import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchAgentTeamProposals, decideAgentTeamProposal, type AgentTeamProposal } from '../../../shared/api/ai-activity';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';

function Proposal({ proposal, canEdit, onChange }: { proposal: AgentTeamProposal; canEdit: boolean; onChange: () => void }) {
    const { t } = useTranslation();
    const [instructions, setInstructions] = useState(proposal.instructions);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const decide = async (accept: boolean) => {
        setBusy(true);
        try { await decideAgentTeamProposal(proposal, accept, instructions); onChange(); }
        catch (failure) { setError(String(failure)); }
        finally { setBusy(false); }
    };
    return <article className="ai-resource-card">
        <strong>{proposal.name}</strong>
        <p>{proposal.provider} · {proposal.model}</p>
        <p>{proposal.skill_ids.join(', ')}</p>
        <p>{t('agent_team.review_proposal')}</p>
        <details><summary>{t('agent_team.evidence')}</summary>
            <p>{t(proposal.rationale, { defaultValue: proposal.rationale })}</p><p>{proposal.acceptance.join(' · ')}</p><p>{proposal.limitations.map(item => t(item, { defaultValue: item })).join(' · ')}</p>
            <p>{proposal.evidence_run_ids.join(', ')}</p>
        </details>
        <label>{t('agent_team.instructions')}<textarea className="gnosi-input w-full" value={instructions} disabled={!canEdit || busy} onChange={e => { setInstructions(e.target.value); }} /></label>
        {error && <p role="alert">{error}</p>}
        {canEdit && <div className="flex gap-2">
            <button type="button" className="btn-gnosi-primary" disabled={busy || !instructions.trim()} onClick={() => { void decide(true); }}>{t('agent_team.retain')}</button>
            <button type="button" className="btn-gnosi-secondary" disabled={busy} onClick={() => { void decide(false); }}>{t('agent_team.reject')}</button>
        </div>}
    </article>;
}
export function AgentTeamProposals({ canEdit, version }: { canEdit: boolean; version: number }) {
    const { t } = useTranslation();
    const vaultId = useActiveVaultId();
    const [proposals, setProposals] = useState<AgentTeamProposal[]>([]);
    const [revision, setRevision] = useState(0);
    const [error, setError] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        void fetchAgentTeamProposals(controller.signal).then(items => { if (!controller.signal.aborted) { setProposals(items); setError(''); } })
            .catch((failure: unknown) => { if (!controller.signal.aborted) setError(String(failure)); });
        return () => { controller.abort(); };
    }, [vaultId, version, revision]);
    if (error) return <p role="alert">{error}</p>;
    const pending = proposals.filter(p => p.status === 'pending');
    return pending.length > 0 ? <section aria-label={t('agent_team.proposals')}><h3>{t('agent_team.proposals')}</h3>
        {pending.map(p => <Proposal key={`${p.run_id}:${p.id}`} proposal={p} canEdit={canEdit} onChange={() => { setRevision(v => v + 1); }} />)}
    </section> : null;
}
