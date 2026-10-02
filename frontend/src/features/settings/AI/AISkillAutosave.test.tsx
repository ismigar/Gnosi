import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SkillsSettingsPanel } from './AISkillsSettingsPanel';
import { normalizeSkill } from './aiSettingsUtils';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en', language: 'en' } }) }));
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

it('shows only the latest personalization and restores the original only after confirmation', async () => {
    const original = normalizeSkill({ id: 'core.reader', name: 'Reader', instructions: 'Original English instructions', origin: 'core' });
    const lineage = { id: original.id, name: original.name, version: String(original.version), revision: 'original', instructions: original.instructions, tool_ids: [] };
    const older = normalizeSkill({ id: 'user.older', name: 'Older copy', instructions: 'Older saved instructions', origin: 'user', modified_at: 1, metadata: { derived_from: lineage } });
    const personal = normalizeSkill({ id: 'user.reader', name: 'Reader copy', instructions: 'Instruccions personalitzades en català.', origin: 'user', revision: 'saved', modified_at: 2, metadata: { derived_from: lineage } });
    const createSkill = vi.fn(); const updateSkill = vi.fn().mockResolvedValue({ ...personal, revision: 'edited' });
    await render(<SkillsSettingsPanel agents={[]} onAgentsChanged={vi.fn()} resources={{ skills: [personal, original, older], tools: [], createSkill, updateSkill, cloneSkill: vi.fn(), validateSkill: vi.fn(), deleteSkill: vi.fn(), reload: vi.fn(), issues: [], loading: false, error: '' }} />);
    const click = async (text: string, scope: ParentNode = host) => { await act(async () => { [...scope.querySelectorAll('button')].find(button => button.textContent.includes(text))?.click(); await Promise.resolve(); }); };
    expect(host.querySelectorAll('.ai-resource-card')).toHaveLength(1);
    expect(host.textContent).not.toContain(older.name);
    await click('common.edit');
    const instructions = host.querySelector<HTMLTextAreaElement>('[aria-label="instructions"]');
    if (!instructions) throw new Error('Missing personal instructions');
    expect(instructions.value).toBe(personal.instructions);
    expect(createSkill).not.toHaveBeenCalled(); expect(updateSkill).not.toHaveBeenCalled();
    await click('restore_original');
    expect(instructions.value).toBe(personal.instructions);
    await click('common.cancel', document.body.querySelector('[role="dialog"]') || document.body);
    expect(instructions.value).toBe(personal.instructions); expect(updateSkill).not.toHaveBeenCalled();
    await click('restore_original');
    await click('restore_original', document.body.querySelector('[role="dialog"]') || document.body);
    expect(instructions.value).toBe(original.instructions);
    await click('common.close');
    expect(updateSkill).toHaveBeenCalledWith(personal, expect.objectContaining({ instructions: original.instructions }));
    expect(createSkill).not.toHaveBeenCalled();
});
