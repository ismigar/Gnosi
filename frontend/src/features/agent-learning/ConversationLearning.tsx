import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { prepareLearningDraft, type LearnedSkill } from '../../shared/api/agent-learning';
import type { ChatStreamRequest } from '../../shared/api/chat-streaming';
import { LearningProjectPanel } from './LearningProjectPanel';
import { LearnedSkillEditor } from './LearnedSkillEditor';
import './learning.css';

interface Props {
    readonly agentId: string;
    readonly sessionId: string;
    readonly contextRefs: Readonly<NonNullable<ChatStreamRequest['context_refs']>>;
    readonly lastResult?: string;
    readonly hasConversation: boolean;
    readonly initialGoal?: string;
    readonly onRequestConsumed?: () => void;
    readonly onClose: () => void;
}

export function ConversationLearning({ agentId, sessionId, contextRefs, lastResult, hasConversation, initialGoal = '', onRequestConsumed, onClose }: Props) {
    const { t, i18n } = useTranslation();
    const [goal, setGoal] = useState(initialGoal.slice(0, 2000));
    const [draft, setDraft] = useState<LearnedSkill | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    const autoStarted = useRef(false);
    useEffect(() => () => { controller.current?.abort(); }, []);
    const generate = useCallback(async () => {
        if (busy || !hasConversation) return;
        setBusy(true); setError(''); controller.current = new AbortController();
        try {
            const language = i18n.language.split('-')[0];
            setDraft(await prepareLearningDraft({
                agent_id: agentId, session_id: sessionId, goal,
                language: language === 'ca' || language === 'es' || language === 'fr' ? language : 'en',
            }, controller.current.signal));
        } catch { if (!controller.current.signal.aborted) setError(t('learning.draft_error')); }
        finally { setBusy(false); }
    }, [busy, hasConversation, i18n.language, agentId, sessionId, goal, t]);
    useEffect(() => {
        if (!initialGoal || !hasConversation || autoStarted.current) return;
        const timer = window.setTimeout(() => {
            autoStarted.current = true;
            onRequestConsumed?.();
            void generate();
        }, 0);
        return () => { window.clearTimeout(timer); };
    }, [initialGoal, hasConversation, generate, onRequestConsumed]);
    return <div className="agent-learning agent-learning__panel">
        <div className="agent-learning__toolbar"><strong>{t('learning.title')}</strong><button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={onClose}>{t('common.close')}</button></div>
        <LearningProjectPanel agentId={agentId} sessionId={sessionId} contextRefs={contextRefs} lastResult={lastResult} />
        <hr />
        <p className="agent-learning__muted">{t('learning.conversation_help')}</p>
        <label>{t('learning.goal')}<input className="gnosi-input" value={goal} maxLength={2000} disabled={busy} onChange={event => { setGoal(event.target.value); }} /></label>
        <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busy || !hasConversation} onClick={() => { void generate(); }}>{t(busy ? 'common.loading' : 'learning.create_from_conversation')}</button>
        {!hasConversation && <p>{t('learning.needs_conversation')}</p>}
        {error && <p role="alert" className="agent-learning__error">{error}</p>}
        {draft && <LearnedSkillEditor key={JSON.stringify(draft)} initialSkill={draft} agentId={agentId} sessionId={sessionId} />}
    </div>;
}
