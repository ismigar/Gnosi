import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    AgentSkillsField,
    SkillsSettingsPanel,
    ToolsSettingsPanel,
} from './AIResourcesSettings';
import { normalizeSkill, normalizeTool } from './aiSettingsUtils';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options: { defaultValue?: string } = {}) => (
            options.defaultValue ?? key
        ),
    }),
}));


vi.mock('../../lib/toast', () => ({
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

        expect(container.textContent).toContain('settings.ai.catalog.tool_name');
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

    it('shows required and missing assignments plus model incompatibility', () => {
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
                onChange={vi.fn()}
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

        expect(container.textContent).toContain('settings.ai.catalog.tool_name');
        expect(container.textContent).toContain('plugin.disabled.missing');
        expect(container.textContent).toContain('settings.ai.resources.required');
        expect(container.textContent).toContain(
            'settings.ai.resources.model_incompatible',
        );
        expect(container.querySelector('input[disabled]')).not.toBeNull();
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
