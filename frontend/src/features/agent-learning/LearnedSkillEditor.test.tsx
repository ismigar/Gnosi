import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LearnedSkillEditor } from './LearnedSkillEditor';
import { saveLearnedSkill } from '../../shared/api/agent-learning';
vi.mock('../../shared/api/agent-learning', () => ({ saveLearnedSkill: vi.fn(), runSkillTrial: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../shared/notifications/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('./SkillResourcesEditor', () => ({ SkillResourcesEditor: () => null }));
vi.mock('../../shared/editor/InstructionMarkdownEditor', () => ({ InstructionMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="instructions" value={value} onChange={event => { onChange(event.target.value); }} /> }));
it('autosaves an adopted draft and updates its stable identity and revision before close', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
    const saved = vi.mocked(saveLearnedSkill);
    saved.mockImplementation(body => Promise.resolve({ skill_id: body.skill_id || '', revision: body.expected_revision ? 'second' : 'first', assigned: false, missing_tools: [] }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
        await act(async () => { root.render(<LearnedSkillEditor agentId="helper" initialSkill={{ name: 'Synthetic', instructions: 'First', criteria: ['Grounded'] }} />); await Promise.resolve(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        expect(saved).toHaveBeenCalledTimes(1);
        const id = saved.mock.calls[0]?.[0].skill_id;
        expect(id).toMatch(/^user\.learned-/);
        const field = host.querySelector<HTMLTextAreaElement>('[aria-label="instructions"]');
        if (!field) throw new Error('Missing instructions');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, 'Edited');
            field.dispatchEvent(new Event('input', { bubbles: true })); await Promise.resolve();
        });
        await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'common.close')?.click(); await Promise.resolve(); });
        const update = saved.mock.calls[1]?.[0];
        expect(update?.skill_id).toBe(id);
        expect(update?.expected_revision).toBe('first');
        expect(update?.skill.instructions).toBe('Edited');
        expect(saved).toHaveBeenCalledTimes(2); expect(host.querySelector('.agent-learning')).toBeNull();
    } finally { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
