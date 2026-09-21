import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchSkillPackage, validateSkillPackage, type LearnedSkill } from '../../shared/api/agent-learning';
import { LearnedSkillEditor } from './LearnedSkillEditor';
import './learning.css';

export function SkillPackageTools({ skillId = '', agentId, canEdit = true, onSaved }: {
    readonly skillId?: string; readonly agentId: string; readonly canEdit?: boolean; readonly onSaved?: () => void;
}) {
    const { t } = useTranslation();
    const [skill, setSkill] = useState<LearnedSkill | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const input = useRef<HTMLInputElement | null>(null);
    const exportPackage = async () => {
        setBusy(true); setError('');
        try {
            const payload = await fetchSkillPackage(skillId);
            const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = `${skillId}.gnosi-skill.json`;
            document.body.appendChild(link); link.click(); link.remove();
            window.setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
        } catch { setError(t('learning.package_error')); }
        finally { setBusy(false); }
    };
    const readFile = async (file?: File) => {
        if (!file) return;
        setBusy(true); setError('');
        try {
            if (file.size > 256_000) throw new Error('Package exceeds the size limit');
            const value: unknown = JSON.parse(await file.text());
            const payload = await validateSkillPackage(value);
            setSkill(payload.skill);
        } catch { setError(t('learning.package_error')); }
        finally { setBusy(false); if (input.current) input.current.value = ''; }
    };
    return <div className="agent-learning">
        <div className="agent-learning__actions">
            {skillId && <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={busy} onClick={() => { void exportPackage(); }}>{t('learning.export_package')}</button>}
            {skillId && canEdit && <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={busy || !agentId} onClick={() => {
                setBusy(true); setError('');
                void fetchSkillPackage(skillId).then(payload => { setSkill(payload.skill); }).catch(() => { setError(t('learning.load_error')); }).finally(() => { setBusy(false); });
            }}>{t('learning.test_or_reuse')}</button>}
            {!skillId && canEdit && <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={busy || !agentId} onClick={() => { input.current?.click(); }}>{t('learning.import_package')}</button>}
            <input ref={input} type="file" hidden accept=".json,application/json" aria-label={t('learning.import_package')} onChange={event => { void readFile(event.target.files?.[0]); }} />
        </div>
        {skillId && <p className="agent-learning__muted">{t('learning.export_help')}</p>}
        {error && <p role="alert" className="agent-learning__error">{error}</p>}
        {skill && <>
            <button className="btn-gnosi btn-gnosi-secondary" type="button" onClick={() => { setSkill(null); }}>{t('common.close')}</button>
            <LearnedSkillEditor key={JSON.stringify(skill)} initialSkill={skill} agentId={agentId} onSaved={onSaved} />
        </>}
    </div>;
}
