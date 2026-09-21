import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runSkillTrial, saveLearnedSkill, type LearnedSkill, type SkillTrialResult } from '../../shared/api/agent-learning';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import { SkillResourcesEditor } from './SkillResourcesEditor';

interface Props {
    readonly initialSkill: LearnedSkill;
    readonly agentId: string;
    readonly sessionId?: string;
    readonly onSaved?: () => void;
}

export function LearnedSkillEditor({ initialSkill, agentId, sessionId = '', onSaved }: Props) {
    const { t } = useTranslation();
    const [skill, setSkill] = useState(initialSkill);
    const [criteria, setCriteria] = useState(initialSkill.criteria.join('\n'));
    const [assign, setAssign] = useState(false);
    const [testInput, setTestInput] = useState('');
    const [trial, setTrial] = useState<SkillTrialResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState('');
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => { controller.current?.abort(); }, []);
    const currentSkill: LearnedSkill = { ...skill, criteria: criteria.split('\n').map(item => item.trim()).filter(Boolean) };
    const valid = Boolean(skill.name.trim() && skill.instructions.trim() && agentId
        && currentSkill.criteria.length > 0 && currentSkill.criteria.length <= 16
        && currentSkill.criteria.every(item => item.length <= 1000)
        && (skill.examples || []).every(item => item.name.trim() && item.input.trim() && item.expected.trim())
        && (skill.resources || []).every(item => /^[\w.-]+\.(md|txt|json|csv|yaml)$/u.test(item.name))
        && new Set((skill.resources || []).map(item => item.name)).size === (skill.resources || []).length);
    const change = (update: Partial<LearnedSkill>) => { setSkill(current => ({ ...current, ...update })); setTrial(null); setSaved(''); };
    const runTrial = async () => {
        if (busy || !valid || !testInput.trim()) return;
        setBusy(true); setError(''); controller.current = new AbortController();
        try { setTrial(await runSkillTrial({ skill: currentSkill, agent_id: agentId, input: testInput }, controller.current.signal)); }
        catch { if (!controller.current.signal.aborted) setError(t('learning.trial_error')); }
        finally { setBusy(false); }
    };
    const save = async () => {
        if (busy || !valid || saved) return;
        setBusy(true); setError('');
        try {
            const result = await saveLearnedSkill({ skill: currentSkill, agent_id: agentId, session_id: sessionId, assign });
            setSaved(t(result.assigned ? 'learning.saved_assigned' : 'learning.saved_skill'));
            if (result.missing_tools?.length) setError(t('learning.missing_tools'));
            onSaved?.();
        } catch { setError(t('learning.save_skill_error')); }
        finally { setBusy(false); }
    };
    return <div className="agent-learning" aria-busy={busy}>
        <p className="agent-learning__muted">{t('learning.review_help')}</p>
        <label>{t('learning.name')}<input className="gnosi-input" value={skill.name} maxLength={160} disabled={busy} onChange={event => { change({ name: event.target.value }); }} /></label>
        <label>{t('learning.description')}<textarea className="gnosi-input" value={skill.description || ''} rows={2} maxLength={2000} disabled={busy} onChange={event => { change({ description: event.target.value }); }} /></label>
        <label>{t('learning.instructions')}<textarea className="gnosi-input" value={skill.instructions} rows={8} maxLength={24000} disabled={busy} onChange={event => { change({ instructions: event.target.value }); }} /></label>
        <label>{t('learning.criteria')}<textarea className="gnosi-input" value={criteria} rows={4} disabled={busy} onChange={event => { setCriteria(event.target.value); setTrial(null); setSaved(''); }} /></label>
        {Boolean(skill.tool_ids?.length) && <details><summary>{t('learning.dependencies')}</summary><p className="agent-learning__muted">{t('learning.dependencies_help')}</p><ul>{skill.tool_ids?.map(tool => <li key={tool}><code>{tool}</code></li>)}</ul></details>}
        <SkillResourcesEditor skill={skill} disabled={busy} onChange={change} />
        <section className="agent-learning__card">
            <strong>{t('learning.second_case')}</strong>
            <p className="agent-learning__muted">{t('learning.trial_help')}</p>
            <label>{t('learning.trial_input')}<textarea className="gnosi-input" rows={4} maxLength={12000} value={testInput} disabled={busy} onChange={event => { setTestInput(event.target.value); setTrial(null); }} /></label>
            <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={busy || !valid || !testInput.trim()} onClick={() => { void runTrial(); }}>{t(busy ? 'common.loading' : 'learning.run_trial')}</button>
            {trial && <>
                <pre>{trial.output}</pre>
                <p className="agent-learning__muted">{t('learning.trial_review_help')}</p>
                <ul>{trial.checks.map((check, index) => <li key={index}><strong>{t(check.met ? 'learning.met' : 'learning.unmet')}: {check.criterion}</strong><p>{check.evidence}</p></li>)}</ul>
                <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={(skill.examples || []).length >= 8 || testInput.length > 8000 || trial.output.length > 8000} onClick={() => { change({ examples: [...(skill.examples || []), { name: t('learning.validated_example'), input: testInput, expected: trial.output }] }); }}>{t('learning.keep_example')}</button>
            </>}
        </section>
        <div className="agent-learning__toggle"><GnosiToggle active={assign} label={t('learning.assign')} disabled={busy || Boolean(saved)} onChange={() => { setAssign(value => !value); }} /><span>{t('learning.assign')}</span></div>
        {error && <p role="alert" className="agent-learning__error">{error}</p>}
        {saved && <p role="status">{saved}</p>}
        <button className="btn-gnosi btn-gnosi-primary" type="button" disabled={busy || !valid || Boolean(saved)} onClick={() => { void save(); }}>{t('learning.save_skill')}</button>
    </div>;
}
