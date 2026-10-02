import { act } from 'react';
import type { components } from '../../generated/openapi';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import { LearnedSkillEditor } from './LearnedSkillEditor';

const api = vi.hoisted(() => ({ trial: vi.fn(), save: vi.fn() }));
vi.mock('../../shared/api/agent-learning', () => ({ runSkillTrial: api.trial, saveLearnedSkill: api.save }));
vi.mock('./SkillResourcesEditor', () => ({ SkillResourcesEditor: () => null }));
vi.mock('../../shared/notifications/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../../shared/editor/InstructionMarkdownEditor', () => ({ InstructionMarkdownEditor: () => null }));

it('shows the original criterion and both observable excerpts after a trial', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    api.save.mockImplementation((body: components['schemas']['SaveLearningRequest']) => Promise.resolve({ skill_id: body.skill_id, revision: 'saved', assigned: false, missing_tools: [] }));
    const locale = createInstance();
    await locale.init({ lng: 'en', resources: { en: { translation: { learning: {
        trial_input: 'New test case', run_trial: 'Run test', input_evidence: 'Input excerpt:', output_evidence: 'Result excerpt:',
    } } } }, interpolation: { escapeValue: false } });
    api.trial.mockResolvedValue({ output: '12 participants, 500 euros', mode: 'text_trial', missing_inputs: ['Recipient address'], checks: [{
        criterion: 'Preserve the budget', met: false, evidence: 'The amount changed',
        input_quote: '240 euros', output_quote: '500 euros',
    }] });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => { root.render(<I18nextProvider i18n={locale}><LearnedSkillEditor agentId="helper" initialSkill={{
            name: 'Synthetic', description: '', instructions: 'Preserve the facts', criteria: ['Preserve the budget'],
        }} /></I18nextProvider>); await Promise.resolve(); });
        const label = [...container.querySelectorAll('label')].find(item => item.textContent.includes('New test case'));
        const field = label?.querySelector('textarea');
        if (!field) throw new Error('Missing test input');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, '12 participants, 240 euros');
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        const button = [...container.querySelectorAll('button')].find(item => item.textContent === 'Run test');
        if (!button) throw new Error('Missing trial button');
        await act(async () => { button.click(); await Promise.resolve(); });
        expect(api.trial).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Preserve the budget');
        expect(container.textContent).toContain('Input excerpt:');
        expect(container.textContent).toContain('Result excerpt:');
        expect(container.textContent).toContain('Recipient address');
        expect([...container.querySelectorAll('q')].map(item => item.textContent)).toEqual(['240 euros', '500 euros']);
    } finally {
        await act(async () => { root.unmount();  await Promise.resolve(); });
        container.remove();
        vi.unstubAllGlobals();
    }
});
