import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import { ConversationLearning } from './ConversationLearning';

const api = vi.hoisted(() => ({ draft: vi.fn() }));
vi.mock('../../shared/api/agent-learning', () => ({ prepareLearningDraft: api.draft }));
vi.mock('./LearningProjectPanel', () => ({ LearningProjectPanel: () => null }));
vi.mock('./LearnedSkillEditor', () => ({ LearnedSkillEditor: () => <p>Draft ready</p> }));

it('turns an explicit chat request into one draft even under StrictMode', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    const locale = createInstance();
    await locale.init({ lng: 'ca', resources: {}, interpolation: { escapeValue: false } });
    api.draft.mockResolvedValue({ name: 'Synthetic', instructions: 'Summarize', criteria: ['Has title'] });
    const container = document.createElement('div');
    const root = createRoot(container);
    const consumed = vi.fn();
    try {
        await act(async () => { root.render(<StrictMode><I18nextProvider i18n={locale}><ConversationLearning agentId="helper" sessionId="session" contextRefs={[]} hasConversation initialGoal="Crea una habilitat per resumir" onRequestConsumed={consumed} onClose={() => undefined} /></I18nextProvider></StrictMode>); await Promise.resolve(); });
        await act(async () => { await vi.runOnlyPendingTimersAsync(); });
        expect(api.draft).toHaveBeenCalledTimes(1);
        expect(consumed).toHaveBeenCalledTimes(1);
        expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({ goal: 'Crea una habilitat per resumir', language: 'ca' }), expect.any(AbortSignal));
        expect(container.textContent).toContain('Draft ready');
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
        vi.useRealTimers();
    }
});
