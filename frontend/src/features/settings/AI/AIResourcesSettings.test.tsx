import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    AgentSkillsField,
    SkillsSettingsPanel,
    ToolsSettingsPanel,
} from './AIResourcesSettings';

import { normalizeSkill, normalizeTool } from './aiSettingsUtils';


vi.mock('../../../shared/editor/InstructionRichEditor', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en', resolvedLanguage: 'en' },
        t: (key: string, options: { defaultValue?: string; name?: string; version?: string } = {}) => (
            key.endsWith('.assignment_title') ? `Assignments: ${options.name || ''}`
                : key.endsWith('.skill_version') ? `Version ${options.version || ''}` : options.defaultValue ?? key
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
    it('keeps one named assignment form inside its skill card when switching and editing', async () => {
        const skills = ['First', 'Second', 'Third'].map((name, index) => normalizeSkill({
            id: `user.copy-${String(index)}`, name, version: String(index + 1), origin: 'user', instructions: 'Read the source.',
        }));
        const assignAgentSkills = vi.fn(); const saveAutomation = vi.fn();
        const container = render(<SkillsSettingsPanel agents={[]} onAgentsChanged={vi.fn()} resources={{
            skills, tools: [], automations: [], assignAgentSkills, saveAutomation, cloneSkill: vi.fn(), createSkill: vi.fn(),
            updateSkill: vi.fn(), validateSkill: vi.fn(), deleteSkill: vi.fn(), reload: vi.fn(), issues: [], loading: false, error: '',
        }} />);
        const action = (index: number) => [...container.querySelectorAll('.ai-resource-card')][index]
            ?.querySelectorAll<HTMLButtonElement>('.ai-resource-card__actions button');
        const clickAction = (index: number, label: string) => {
            act(() => { [...(action(index) || [])].find(button => button.textContent.includes(label))?.click(); });
        };
        for (const [index, skill] of skills.entries()) {
            clickAction(index, 'assign_copy');
            const form = container.querySelector('section.ai-resource-editor');
            expect(container.querySelectorAll('section.ai-resource-editor')).toHaveLength(1);
            expect(form?.getAttribute('aria-label')).toBe(`Assignments: ${skill.name}`);
            expect(form?.textContent).toContain(`Version ${String(skill.version)}`);
            expect(form?.closest('.ai-resource-card')).toBe(container.querySelectorAll('.ai-resource-card')[index]);
            clickAction(index, 'common.edit');
            expect(container.querySelector('section.ai-resource-editor')).toBeNull();
            const closeEditor = [...container.querySelectorAll<HTMLButtonElement>('.ai-resource-editor button')]
                .find(button => button.textContent.includes('common.close'));
            await act(async () => { closeEditor?.click(); await Promise.resolve(); });
            expect(container.querySelector('.ai-resource-editor')).toBeNull();
        }
        clickAction(0, 'assign_copy');
        clickAction(1, 'assign_copy');
        expect(container.querySelectorAll('section.ai-resource-editor')).toHaveLength(1);
        expect(container.querySelector('section.ai-resource-editor')?.getAttribute('aria-label')).toBe('Assignments: Second');
        act(() => { container.querySelector<HTMLButtonElement>('section.ai-resource-editor button')?.click(); });
        expect(container.querySelector('section.ai-resource-editor')).toBeNull();
        expect(assignAgentSkills).not.toHaveBeenCalled(); expect(saveAutomation).not.toHaveBeenCalled();
    });
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

    it('opening and closing unchanged personalization never writes a copy', async () => {
        const skill = normalizeSkill({ id: 'core.example', name: 'Example', instructions: 'Exact runtime instructions', origin: 'core', description: 'Specific original description' });
        const cloneSkill = vi.fn(); const createSkill = vi.fn();
        const container = render(<SkillsSettingsPanel agents={[]} onAgentsChanged={vi.fn()} resources={{ skills: [skill], tools: [], cloneSkill, createSkill, updateSkill: vi.fn(), validateSkill: vi.fn(), deleteSkill: vi.fn(), reload: vi.fn(), issues: [], loading: false, error: '' }} />);
        const customize = [...container.querySelectorAll('button')].find(button => button.textContent.includes('customize'));
        act(() => { customize?.click(); });
        expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="settings.ai.resources.instructions"]')?.value).toBe(skill.instructions);
        expect(cloneSkill).not.toHaveBeenCalled(); expect(createSkill).not.toHaveBeenCalled();
        const cancel = [...container.querySelectorAll('button')].find(button => button.textContent.includes('common.close'));
        await act(async () => { cancel?.click(); await Promise.resolve(); });
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
