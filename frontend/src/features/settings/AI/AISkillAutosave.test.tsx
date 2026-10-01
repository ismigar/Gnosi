import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SkillsSettingsPanel } from './AISkillsSettingsPanel';
import { normalizeSkill } from './aiSettingsUtils';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/notifications/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../shared/editor/InstructionMarkdownEditor', () => ({ InstructionMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="instructions" value={value} onChange={event => { onChange(event.target.value); }} /> }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(element: ReactElement) { await act(async () => { root.render(element); await Promise.resolve(); }); }
async function edit(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true })); await Promise.resolve();
    });
}
it('creates a skill once, keeps its editor open, and updates the saved revision on later edits before closing', async () => {
    const created = normalizeSkill({ id: 'user.synthetic', name: 'Synthetic', instructions: 'First', origin: 'user', revision: 'first' });
    const createSkill = vi.fn().mockResolvedValue(created);
    const updateSkill = vi.fn().mockResolvedValue({ ...created, revision: 'second' });
    await render(<SkillsSettingsPanel agents={[]} onAgentsChanged={vi.fn()} resources={{ skills: [], tools: [], createSkill, updateSkill, cloneSkill: vi.fn(), validateSkill: vi.fn(), deleteSkill: vi.fn(), reload: vi.fn(), issues: [], loading: false, error: '' }} />);
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent.includes('new_skill'))?.click(); await Promise.resolve(); });
    const name = host.querySelector<HTMLInputElement>('.ai-resource-editor input');
    const instructions = host.querySelector<HTMLTextAreaElement>('[aria-label="instructions"]');
    if (!name || !instructions) throw new Error('Missing skill editor');
    await edit(name, 'Synthetic'); await edit(instructions, 'First');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(createSkill).toHaveBeenCalledTimes(1); expect(host.querySelector('.ai-resource-editor')).not.toBeNull();
    await edit(instructions, 'Second');
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'common.close')?.click(); await Promise.resolve(); });
    expect(updateSkill).toHaveBeenCalledWith(created, expect.objectContaining({ instructions: 'Second' }));
    expect(createSkill).toHaveBeenCalledTimes(1); expect(host.querySelector('.ai-resource-editor')).toBeNull();
    expect(host.textContent).not.toContain('common.save');
});
