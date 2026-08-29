import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { normalizeSkill } from './aiSettingsUtils';
import { useAIResources } from './useAIResources';


type AIResources = ReturnType<typeof useAIResources>;


interface HarnessProps {
    readonly onValue: (value: AIResources) => void;
}


const response = (payload: unknown, status = 200): Promise<Response> => (
    Promise.resolve(Response.json(payload, { status }))
);


const requestPath = (input: RequestInfo | URL): string => {
    if (input instanceof Request) return new URL(input.url).pathname;
    if (input instanceof URL) return input.pathname;
    return input;
};


const requestBody = (
    call: Parameters<typeof fetch> | undefined,
): unknown => {
    const body = call?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    return JSON.parse(body) as unknown;
};


let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;


const Harness = ({ onValue }: HarnessProps) => {
    const resources = useAIResources(true);
    useEffect(() => {
        onValue(resources);
    }, [onValue, resources]);
    return null;
};

const mountHook = async (
    fetchMock: typeof fetch,
): Promise<() => AIResources> => {
    vi.stubGlobal('fetch', fetchMock);
    let current: AIResources | undefined;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedContainer = container;
    mountedRoot = root;
    await act(async () => {
        root.render(<Harness onValue={(value) => { current = value; }} />);
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    });
    return () => {
        if (!current) throw new Error('AI resources hook did not publish a value');
        return current;
    };
};

beforeAll(() => {
    const reactTestGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    if (mountedRoot) {
        act(() => {
            mountedRoot?.unmount();
        });
        mountedContainer?.remove();
    }
    mountedRoot = null;
    mountedContainer = null;
    vi.unstubAllGlobals();
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
        const fetchMock = vi.fn<typeof fetch>((input, options) => {
            const url = requestPath(input);
            if (url === '/api/ai/skills' && !options?.method) {
                return response({ skills: [existing], catalog_revision: 'catalog-r1' });
            }
            if (url === '/api/ai/tools') return response({ tools: [], catalog_revision: 'tools-r1' });
            if (url === '/api/ai/skills' && options?.method === 'POST') {
                return response({ ...existing, id: 'user.created', name: 'Created' }, 201);
            }
            if (url === '/api/ai/skills/user.research' && options?.method === 'PUT') {
                return response({ ...existing, name: 'Updated', revision: 'skill-r2' });
            }
            if (url === '/api/ai/skills/user.research/validate' && options?.method === 'POST') {
                return response({ valid: true, missing_tool_ids: [] });
            }
            if (url === '/api/ai/skills/user.research/clone' && options?.method === 'POST') {
                return response({ ...existing, id: 'user.research-copy', name: 'Research copy' }, 201);
            }
            throw new Error(`Unexpected request: ${options?.method ?? 'GET'} ${url}`);
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
        const createdRequest = fetchMock.mock.calls.find(([input, options]) => (
            requestPath(input) === '/api/ai/skills' && options?.method === 'POST'
        ));
        expect(requestBody(createdRequest)).toMatchObject({
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
        const updateRequest = fetchMock.mock.calls.find(([input, options]) => (
            requestPath(input) === '/api/ai/skills/user.research'
            && options?.method === 'PUT'
        ));
        expect(requestBody(updateRequest)).toMatchObject({
            expected_revision: 'skill-r1',
        });

        let validation: unknown;
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
        const cloneRequest = fetchMock.mock.calls.find(([input]) => (
            requestPath(input) === '/api/ai/skills/user.research/clone'
        ));
        expect(requestBody(cloneRequest)).toEqual({ name: 'Research copy' });
    });

    it('reads the current agent revision immediately before assigning skills', async () => {
        const fetchMock = vi.fn<typeof fetch>((input, options) => {
            const url = requestPath(input);
            if (url === '/api/ai/skills') return response({ skills: [] });
            if (url === '/api/ai/tools') return response({ tools: [] });
            if (url === '/api/ai/agents/brain/skills' && !options?.method) {
                return response({
                    agent_id: 'brain',
                    skill_ids: [],
                    required_skill_ids: [],
                    revision: 'agent-r4',
                });
            }
            if (url === '/api/ai/agents/brain/skills' && options?.method === 'PUT') {
                return response({
                    agent_id: 'brain',
                    skill_ids: ['plugin.llm-wiki.query'],
                    required_skill_ids: ['plugin.llm-wiki.query'],
                    revision: 'agent-r5',
                });
            }
            throw new Error(`Unexpected request: ${options?.method ?? 'GET'} ${url}`);
        });
        const getResources = await mountHook(fetchMock);

        let assigned: string[] | undefined;
        await act(async () => {
            assigned = await getResources().assignAgentSkills(
                'brain',
                ['plugin.llm-wiki.query'],
            );
        });

        expect(assigned).toEqual(['plugin.llm-wiki.query']);
        const putRequest = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
        expect(requestBody(putRequest)).toEqual({
            skill_ids: ['plugin.llm-wiki.query'],
            expected_revision: 'agent-r4',
        });
    });
});
