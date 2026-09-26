import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    AgentSkillsField,
    SkillsSettingsPanel,
    ToolsSettingsPanel,
} from './AIResourcesSettings';
import { GnosiApiError } from '../../../shared/api/errors';
import { SkillInstructions } from './SkillInstructions';
import { generateAiContent } from '../../../shared/api/ai';
vi.mock('../../../shared/api/ai', () => ({ generateAiContent: vi.fn() }));

import { normalizeSkill, normalizeTool } from './aiSettingsUtils';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en', resolvedLanguage: 'en' },
        t: (key: string, options: { defaultValue?: string } = {}) => (
            options.defaultValue ?? key
        ),
    }),
}));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));


interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}


const mountedRoots: MountedRoot[] = [];


const render = (element: ReactElement): HTMLDivElement => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    act(() => {
        root.render(element);
    });
    return container;
};


beforeAll(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
});


describe('AI resource settings components', () => {
    it('renders governed tool status, effects, and consumers', () => {
        const tool = normalizeTool({
            effects: ['local_write', 'ai_cost'],
            id: 'llm-wiki.process-source',
            input_schema: { type: 'object' },
            name: 'Process source',
            origin: 'plugin:llm-wiki',
            skill_ids: ['plugin.llm-wiki.process-source'],
            status: 'available',
        });
        const container = render(
            <ToolsSettingsPanel
                resources={{
                    error: '',
                    loading: false,
                    reload: vi.fn(),
                    tools: [tool],
                }}
            />,
        );

        expect(container.textContent).toContain('Process source');
        expect(container.textContent).toContain('local write');
        expect(container.textContent).toContain('settings.ai.resources.status_available');

        const cardButton = container.querySelector<HTMLButtonElement>(
            '.ai-resource-card__main',
        );
        expect(cardButton).not.toBeNull();
        if (!cardButton) throw new Error('Tool card button was not rendered');
        act(() => {
            cardButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('plugin.llm-wiki.process-source');
        expect(container.textContent).toContain('settings.ai.resources.input_schema');
    });

    it('filters the profile skills without changing assignments', () => {
        const onChange = vi.fn();
        const enabled = normalizeSkill({ id: 'core.enabled', name: 'Enabled skill', origin: 'core' });
        const disabled = normalizeSkill({ id: 'core.disabled', name: 'Other skill', origin: 'core' });
        const container = render(<AgentSkillsField agent={{ id: 'agent' }} onChange={onChange}
            registry={[]} selectedIds={[enabled.id]} skills={[enabled, disabled]} tools={[]} />);
        const filter = container.querySelector<HTMLElement>('[role="switch"][aria-label="settings.ai.resources.active_skills_only"]');
        expect(filter).not.toBeNull();
        act(() => { filter?.click(); });
        expect(container.textContent).toContain('Enabled skill');
        expect(container.textContent).not.toContain('Other skill');
        expect(onChange).not.toHaveBeenCalled();
        act(() => { filter?.click(); });
        expect(container.textContent).toContain('Other skill');
    });

    it('opens a skill without changing its assignment', () => {
        const onChange = vi.fn();
        const onSelectSkill = vi.fn();
        const skill = normalizeSkill({ id: 'core.example', name: 'Example skill', origin: 'core' });
        const container = render(<AgentSkillsField agent={{ id: 'agent' }} onChange={onChange}
            onSelectSkill={onSelectSkill} registry={[]} selectedIds={[skill.id]} skills={[skill]} tools={[]} />);
        const link = container.querySelector('a');
        expect(link?.textContent).toBe('Example skill');
        act(() => { link?.click(); });
        expect(onSelectSkill).toHaveBeenCalledWith(skill.id);
        expect(onChange).not.toHaveBeenCalled();
        expect(container.querySelector('.ai-agent-skill [role="switch"]')?.getAttribute('aria-checked')).toBe('true');
        act(() => { container.querySelector<HTMLElement>('.ai-agent-skill [role="switch"]')?.click(); });
        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('shows required and missing assignments plus model incompatibility', () => {
        const onChange = vi.fn();
        const required = normalizeSkill({
            id: 'plugin.llm-wiki.query',
            name: 'Query Brain',
            origin: 'plugin:llm-wiki',
            required_for_agents: ['llm-wiki'],
            tool_ids: ['llm-wiki.query'],
        });
        const container = render(
            <AgentSkillsField
                agent={{
                    capabilities: { tools: false },
                    id: 'llm-wiki',
                    model: 'plain',
                    provider: 'custom',
                }}
                onChange={onChange}
                registry={[]}
                selectedIds={[
                    'plugin.llm-wiki.query',
                    'plugin.disabled.missing',
                ]}
                skills={[required]}
                tools={[normalizeTool({
                    effects: ['read'],
                    id: 'llm-wiki.query',
                })]}
            />,
        );

        expect(container.textContent).toContain('Query Brain');
        expect(container.textContent).toContain('plugin.disabled.missing');
        expect(container.textContent).toContain('settings.ai.resources.required');
        expect(container.textContent).toContain(
            'settings.ai.resources.model_incompatible',
        );
        const locked = container.querySelector<HTMLElement>('[role="switch"][aria-disabled="true"]');
        expect(locked).not.toBeNull();
        act(() => {
            locked?.click();
            locked?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(onChange).not.toHaveBeenCalled();
        act(() => { container.querySelector<HTMLElement>('.ai-agent-skill [role="switch"]:not([aria-disabled])')?.click(); });
        expect(onChange).toHaveBeenCalledWith(['plugin.llm-wiki.query']);
    });

    it('opens personalization as a draft and cancel never writes a copy', () => {
        const skill = normalizeSkill({ id: 'core.example', name: 'Example', instructions: 'Exact runtime instructions', origin: 'core', description: 'Specific original description' });
        const cloneSkill = vi.fn(); const createSkill = vi.fn();
        const container = render(<SkillsSettingsPanel agents={[]} onAgentsChanged={vi.fn()} resources={{ skills: [skill], tools: [], cloneSkill, createSkill, updateSkill: vi.fn(), validateSkill: vi.fn(), deleteSkill: vi.fn(), reload: vi.fn(), issues: [], loading: false, error: '' }} />);
        const customize = [...container.querySelectorAll('button')].find(button => button.textContent.includes('customize'));
        act(() => { customize?.click(); });
        expect(container.querySelector('textarea[rows="7"]')?.textContent).toBe(skill.instructions);
        expect(cloneSkill).not.toHaveBeenCalled(); expect(createSkill).not.toHaveBeenCalled();
        const cancel = [...container.querySelectorAll('button')].find(button => button.textContent.includes('common.cancel'));
        act(() => { cancel?.click(); });
        expect(container.querySelector('.ai-resource-editor')).toBeNull();
        expect(cloneSkill).not.toHaveBeenCalled(); expect(createSkill).not.toHaveBeenCalled();
    });

    it('surfaces the atomic unassign-and-delete conflict', async () => {
        const skill = normalizeSkill({
            agent_ids: ['agent-one'],
            id: 'user.research',
            instructions: 'Find evidence.',
            name: 'Research',
            origin: 'user',
        });
        const deleteSkill = vi.fn().mockResolvedValue({
            affectedAgents: [{ id: 'agent-one', name: 'Agent One' }],
            deleted: false,
        });
        const container = render(
            <SkillsSettingsPanel
                agents={[{ id: 'agent-one', skill_ids: ['user.research'] }]}
                onAgentsChanged={vi.fn()}
                resources={{
                    cloneSkill: vi.fn(),
                    createSkill: vi.fn(),
                    deleteSkill,
                    error: '',
                    issues: [],
                    loading: false,
                    reload: vi.fn(),
                    skills: [skill],
                    tools: [],
                    updateSkill: vi.fn(),
                    validateSkill: vi.fn(),
                }}
            />,
        );

        const deleteButton = [
            ...container.querySelectorAll<HTMLButtonElement>(
                '.ai-resource-card__actions button',
            ),
        ].find((button) => button.textContent.includes('common.delete'));
        expect(deleteButton).toBeDefined();
        if (!deleteButton) throw new Error('Delete skill button was not rendered');
        await act(async () => {
            deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });

        expect(deleteSkill).toHaveBeenCalledWith(skill);
        expect(container.textContent).toContain(
            'settings.ai.resources.delete_conflict_title',
        );
        expect(container.textContent).toContain(
            'settings.ai.resources.unassign_and_delete',
        );
    });
});

it('translates only on request and keeps original instructions visible and unchanged', async () => {
    const skill = normalizeSkill({ id: 'user.language', instructions: 'Només llegeix.' });
    vi.mocked(generateAiContent).mockResolvedValue({ content: 'Read only.', provider: 'local' });
    const calls = vi.mocked(generateAiContent).mock.calls.length;
    const container = render(<SkillInstructions skill={skill} />);
    expect(vi.mocked(generateAiContent).mock.calls.length).toBe(calls);
    expect(container.textContent).toContain('Només llegeix.');
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
    expect(vi.mocked(generateAiContent).mock.calls.length).toBe(calls + 1);
    expect(container.textContent).toContain('Read only.');
    expect(container.textContent).toContain('Només llegeix.');
    expect(skill.instructions).toBe('Només llegeix.');
});

it('keeps the original available when a requested translation fails', async () => {
    const skill = normalizeSkill({ id: 'user.failed-translation', instructions: 'No esborris res.' });
    vi.mocked(generateAiContent).mockRejectedValueOnce(new Error('Unavailable'));
    const container = render(<SkillInstructions skill={skill} />);
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('No esborris res.');
    expect(container.textContent).toContain('settings.ai.resources.instructions_translation_error');
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
    expect(skill.instructions).toBe('No esborris res.');
});

it('explains provider rate limits without replacing the original instructions', async () => {
    const skill = normalizeSkill({ id: 'user.rate-limited', instructions: 'Preserve this original.' });
    vi.mocked(generateAiContent).mockRejectedValueOnce(new Error('OpenAIRateLimitError'));
    const container = render(<SkillInstructions skill={skill} />);
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('settings.ai.resources.instructions_translation_rate_limit');
    expect(container.textContent).toContain('Preserve this original.');
});


it.each([401, 403, 503])('explains a rejected provider key (%s) and allows retry after reconnecting', async (status) => {
    const original = `Original instructions for authentication test ${String(status)}.`;
    const skill = normalizeSkill({ id: `user.authentication-${String(status)}`, instructions: original });
    vi.mocked(generateAiContent).mockRejectedValueOnce(new GnosiApiError(
        new Response(null, { status }),
        { detail: 'The AI provider rejected the key. Check Settings › AI.' },
    ));
    const container = render(<SkillInstructions skill={skill} />);
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('settings.ai.resources.instructions_translation_authentication');
    expect(container.textContent).toContain(original);
    vi.mocked(generateAiContent).mockResolvedValueOnce({ content: 'Translated instructions.', provider: 'local' });
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('Translated instructions.');
    expect(container.textContent).not.toContain('settings.ai.resources.instructions_translation_authentication');
    expect(skill.instructions).toBe(original);
});
