import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    AgentSkillsField,
    SkillsSettingsPanel,
    ToolsSettingsPanel,
} from './AIResourcesSettings';
import { normalizeSkill, normalizeTool } from './aiSettingsUtils';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, options = {}) => options.defaultValue || key,
    }),
}));

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

const mountedRoots = [];

const render = async element => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
        root.render(element);
    });
    return container;
};

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('AI resource settings components', () => {
    it('renders governed tool status, effects, and consumers', async () => {
        const tool = normalizeTool({
            id: 'llm-wiki.process-source',
            name: 'Process source',
            origin: 'plugin:llm-wiki',
            effects: ['local_write', 'ai_cost'],
            status: 'available',
            skill_ids: ['plugin.llm-wiki.process-source'],
            input_schema: { type: 'object' },
        });
        const container = await render(
            <ToolsSettingsPanel
                resources={{
                    tools: [tool],
                    loading: false,
                    error: '',
                    reload: vi.fn(),
                }}
            />,
        );

        expect(container.textContent).toContain('Process source');
        expect(container.textContent).toContain('local write');
        expect(container.textContent).toContain('settings.ai.resources.status_available');

        const cardButton = container.querySelector('.ai-resource-card__main');
        await act(async () => cardButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(container.textContent).toContain('plugin.llm-wiki.process-source');
        expect(container.textContent).toContain('settings.ai.resources.input_schema');
    });

    it('shows required and missing assignments plus model incompatibility', async () => {
        const required = normalizeSkill({
            id: 'plugin.llm-wiki.query',
            name: 'Query Brain',
            origin: 'plugin:llm-wiki',
            required_for_agents: ['llm-wiki'],
            tool_ids: ['llm-wiki.query'],
        });
        const container = await render(
            <AgentSkillsField
                agent={{
                    id: 'llm-wiki',
                    provider: 'custom',
                    model: 'plain',
                    capabilities: { tools: false },
                }}
                skills={[required]}
                tools={[normalizeTool({ id: 'llm-wiki.query', effects: ['read'] })]}
                registry={[]}
                selectedIds={['plugin.llm-wiki.query', 'plugin.disabled.missing']}
                onChange={vi.fn()}
            />,
        );

        expect(container.textContent).toContain('Query Brain');
        expect(container.textContent).toContain('plugin.disabled.missing');
        expect(container.textContent).toContain('settings.ai.resources.required');
        expect(container.textContent).toContain('settings.ai.resources.model_incompatible');
        expect(container.querySelector('input[disabled]')).not.toBeNull();
    });

    it('surfaces the atomic unassign-and-delete conflict', async () => {
        const skill = normalizeSkill({
            id: 'user.research',
            name: 'Research',
            origin: 'user',
            instructions: 'Find evidence.',
            agent_ids: ['agent-one'],
        });
        const deleteSkill = vi.fn().mockResolvedValue({
            deleted: false,
            affectedAgents: [{ id: 'agent-one', name: 'Agent One' }],
        });
        const container = await render(
            <SkillsSettingsPanel
                resources={{
                    skills: [skill],
                    tools: [],
                    loading: false,
                    error: '',
                    reload: vi.fn(),
                    createSkill: vi.fn(),
                    updateSkill: vi.fn(),
                    cloneSkill: vi.fn(),
                    deleteSkill,
                }}
                agents={[{ id: 'agent-one', skill_ids: ['user.research'] }]}
                onAgentsChanged={vi.fn()}
            />,
        );

        const deleteButton = [...container.querySelectorAll('.ai-resource-card__actions button')]
            .find(button => button.textContent.includes('common.delete'));
        await act(async () => {
            deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(deleteSkill).toHaveBeenCalledWith(skill);
        expect(container.textContent).toContain('settings.ai.resources.delete_conflict_title');
        expect(container.textContent).toContain('settings.ai.resources.unassign_and_delete');
    });
});
