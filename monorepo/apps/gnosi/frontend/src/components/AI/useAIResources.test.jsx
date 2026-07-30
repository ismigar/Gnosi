import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { normalizeSkill } from './aiSettingsUtils';
import { useAIResources } from './useAIResources';

const originalFetch = globalThis.fetch;
const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
});

let mountedRoot;
let mountedContainer;

const Harness = ({ onValue }) => {
    const resources = useAIResources(true);
    useEffect(() => onValue(resources), [onValue, resources]);
    return null;
};

const mountHook = async fetchMock => {
    globalThis.fetch = fetchMock;
    let current;
    mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);
    await act(async () => {
        mountedRoot.render(<Harness onValue={value => { current = value; }} />);
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    return () => current;
};

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (mountedRoot) {
        await act(async () => mountedRoot.unmount());
        mountedContainer.remove();
    }
    mountedRoot = null;
    mountedContainer = null;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

describe('useAIResources API contract', () => {
    it('uses the revision-aware create, update, and clone endpoints', async () => {
        const existing = {
            id: 'user.research',
            name: 'Research',
            description: '',
            instructions: 'Find evidence.',
            origin: { type: 'user', id: 'personal' },
            kind: 'agent',
            activation: 'automatic',
            tool_ids: [],
            revision: 'skill-r1',
            editable: true,
            deletable: true,
        };
        const fetchMock = vi.fn(async (url, options = {}) => {
            if (url === '/api/ai/skills' && !options.method) {
                return response({ skills: [existing], catalog_revision: 'catalog-r1' });
            }
            if (url === '/api/ai/tools') return response({ tools: [], catalog_revision: 'tools-r1' });
            if (url === '/api/ai/skills' && options.method === 'POST') {
                return response({ ...existing, id: 'user.created', name: 'Created' }, 201);
            }
            if (url === '/api/ai/skills/user.research' && options.method === 'PUT') {
                return response({ ...existing, name: 'Updated', revision: 'skill-r2' });
            }
            if (url === '/api/ai/skills/user.research/validate' && options.method === 'POST') {
                return response({ valid: true, missing_tool_ids: [] });
            }
            if (url === '/api/ai/skills/user.research/clone' && options.method === 'POST') {
                return response({ ...existing, id: 'user.research-copy', name: 'Research copy' }, 201);
            }
            throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
        });
        const getResources = await mountHook(fetchMock);

        await act(async () => {
            await getResources().createSkill({
                name: 'Created',
                description: '',
                instructions: 'Do it.',
                activation: 'automatic',
                toolIds: [],
            });
        });
        const createdRequest = fetchMock.mock.calls.find(([url, options]) => (
            url === '/api/ai/skills' && options?.method === 'POST'
        ));
        expect(JSON.parse(createdRequest[1].body)).toMatchObject({
            name: 'Created',
            kind: 'agent',
            tool_ids: [],
        });

        await act(async () => {
            await getResources().updateSkill(normalizeSkill(existing), {
                name: 'Updated',
                description: '',
                instructions: 'Find stronger evidence.',
                activation: 'automatic',
                toolIds: [],
            });
        });
        const updateRequest = fetchMock.mock.calls.find(([url, options]) => (
            url === '/api/ai/skills/user.research' && options?.method === 'PUT'
        ));
        expect(JSON.parse(updateRequest[1].body)).toMatchObject({
            expected_revision: 'skill-r1',
        });

        let validation;
        await act(async () => {
            validation = await getResources().validateSkill(normalizeSkill(existing), {
                name: 'Updated',
                description: '',
                instructions: 'Find stronger evidence.',
                activation: 'automatic',
                toolIds: [],
            });
        });
        expect(validation).toEqual({ valid: true, missing_tool_ids: [] });

        await act(async () => {
            await getResources().cloneSkill(normalizeSkill(existing));
        });
        const cloneRequest = fetchMock.mock.calls.find(([url]) => (
            url === '/api/ai/skills/user.research/clone'
        ));
        expect(JSON.parse(cloneRequest[1].body)).toEqual({ name: 'Research copy' });
    });

    it('reads the current agent revision immediately before assigning skills', async () => {
        const fetchMock = vi.fn(async (url, options = {}) => {
            if (url === '/api/ai/skills') return response({ skills: [] });
            if (url === '/api/ai/tools') return response({ tools: [] });
            if (url === '/api/ai/agents/brain/skills' && !options.method) {
                return response({
                    agent_id: 'brain',
                    skill_ids: [],
                    required_skill_ids: [],
                    revision: 'agent-r4',
                });
            }
            if (url === '/api/ai/agents/brain/skills' && options.method === 'PUT') {
                return response({
                    agent_id: 'brain',
                    skill_ids: ['plugin.llm-wiki.query'],
                    required_skill_ids: ['plugin.llm-wiki.query'],
                    revision: 'agent-r5',
                });
            }
            throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
        });
        const getResources = await mountHook(fetchMock);

        let assigned;
        await act(async () => {
            assigned = await getResources().assignAgentSkills(
                'brain',
                ['plugin.llm-wiki.query'],
            );
        });

        expect(assigned).toEqual(['plugin.llm-wiki.query']);
        const putRequest = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
        expect(JSON.parse(putRequest[1].body)).toEqual({
            skill_ids: ['plugin.llm-wiki.query'],
            expected_revision: 'agent-r4',
        });
    });
});
