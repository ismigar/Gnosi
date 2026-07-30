import { describe, expect, it } from 'vitest';

import {
    agentSkillWarnings,
    catalogRows,
    cloneSkillPayload,
    modelToolCompatibility,
    normalizeSkill,
    normalizeTool,
    requiredSkillIdsForAgent,
    skillEffects,
    skillPayload,
} from './aiSettingsUtils';

describe('AI settings catalog normalization', () => {
    it('accepts both wrapped and bare catalog responses', () => {
        const rows = [{ id: 'core.search' }];
        expect(catalogRows(rows, 'skills')).toEqual(rows);
        expect(catalogRows({ skills: rows }, 'skills')).toEqual(rows);
        expect(catalogRows({ items: rows }, 'skills')).toEqual(rows);
    });

    it('normalizes managed skills without making them editable', () => {
        const skill = normalizeSkill({
            id: 'plugin.llm-wiki.query',
            origin: { type: 'plugin', id: 'llm-wiki' },
            tool_ids: ['llm-wiki.query'],
            metadata: { required_for_agent: true },
        });

        expect(skill.origin).toMatchObject({ type: 'plugin', id: 'llm-wiki' });
        expect(skill.toolIds).toEqual(['llm-wiki.query']);
        expect(skill.requiredAgentIds).toEqual(['llm-wiki']);
        expect(skill.editable).toBe(false);
        expect(skill.cloneable).toBe(true);
        expect(skill.assignable).toBe(true);
    });

    it('derives a skill effect summary from registered tools', () => {
        const skill = normalizeSkill({
            id: 'user.research',
            effects: ['read'],
            tool_ids: ['vault.write'],
        });
        const tool = normalizeTool({
            id: 'vault.write',
            effects: ['local_write', 'ai_cost'],
        });
        const toolsById = new Map([[tool.id, tool]]);

        expect(skillEffects(skill, toolsById)).toEqual(['read', 'local_write', 'ai_cost']);
    });
});

describe('agent skill assignment compatibility', () => {
    const toolSkill = normalizeSkill({
        id: 'user.tool-skill',
        tool_ids: ['core.search'],
    });
    const searchTool = normalizeTool({
        id: 'core.search',
        effects: ['read'],
    });

    it('locks plugin-required assignments for their agent', () => {
        const required = normalizeSkill({
            id: 'plugin.llm-wiki.query',
            required_for_agents: ['llm-wiki'],
        });
        expect(requiredSkillIdsForAgent({ id: 'llm-wiki' }, [required])).toEqual(
            new Set(['plugin.llm-wiki.query']),
        );
    });

    it('detects explicit model tool incompatibility', () => {
        const agent = { provider: 'local', model: 'plain', capabilities: { tools: false } };
        expect(modelToolCompatibility(agent, [])).toBe(false);
        expect(agentSkillWarnings(
            agent,
            ['user.tool-skill'],
            [toolSkill],
            [searchTool],
            [],
        )).toContainEqual({ type: 'model_tools' });
    });

    it('does not warn when the configured model advertises tool support', () => {
        const agent = { provider: 'openai', model: 'tool-model' };
        const registry = [{
            provider: 'openai',
            model_id: 'tool-model',
            capabilities: ['tools'],
        }];
        expect(modelToolCompatibility(agent, registry)).toBe(true);
        expect(agentSkillWarnings(
            agent,
            ['user.tool-skill'],
            [toolSkill],
            [searchTool],
            registry,
        )).toEqual([]);
    });

    it('keeps unavailable assigned skills visible as a warning', () => {
        const unavailable = normalizeSkill({
            id: 'plugin.disabled.skill',
            available: false,
            missing_tool_ids: ['plugin.disabled.tool'],
        });
        expect(agentSkillWarnings(
            {},
            [unavailable.id],
            [unavailable],
            [],
            [],
        )).toEqual([{
            type: 'unavailable',
            skillNames: ['plugin.disabled.skill'],
        }]);
    });
});

describe('personal skill mutations', () => {
    it('builds a declarative payload without executable code', () => {
        expect(skillPayload({
            name: ' Research ',
            description: ' Find evidence ',
            instructions: ' Search, then cite. ',
            activation: 'automatic',
            toolIds: ['core.search'],
            code: 'do not send',
        }, 4)).toEqual({
            name: 'Research',
            description: 'Find evidence',
            instructions: 'Search, then cite.',
            kind: 'agent',
            activation: 'automatic',
            tool_ids: ['core.search'],
            expected_revision: 4,
        });
    });

    it('clones managed skills through the create contract', () => {
        const skill = normalizeSkill({
            id: 'core.research',
            name: 'Research',
            description: 'Find evidence',
            instructions: 'Search, then cite.',
            tool_ids: ['core.search'],
        });
        expect(cloneSkillPayload(skill)).toMatchObject({
            name: 'Research copy',
        });
    });
});
