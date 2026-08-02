import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AutomationsSettingsPanel, OperationsHistoryPanel } from './AIOperationsSettings';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, values = {}) => values.count === undefined ? key : `${key}:${values.count}`,
    }),
}));

const { toastMock } = vi.hoisted(() => {
    const mock = { success: vi.fn(), error: vi.fn() };
    return { toastMock: mock };
});
vi.mock('../../lib/toast', () => ({ toast: toastMock }));

const roots = [];
const render = async element => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });
    await act(async () => root.render(element));
    return container;
};

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    while (roots.length) {
        const { root, container } = roots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
    vi.clearAllMocks();
});

describe('AI governed operations settings', () => {
    it('only offers skills assigned to the selected agent', async () => {
        const resources = {
            automations: [],
            skills: [
                { id: 'core.assigned', name: 'Assigned', assignable: true },
                { id: 'core.hidden', name: 'Hidden', assignable: true },
            ],
            loading: false,
            reload: vi.fn(),
            saveAutomation: vi.fn(),
            deleteAutomation: vi.fn(),
            runAutomation: vi.fn(),
        };
        const container = await render(
            <AutomationsSettingsPanel
                resources={resources}
                agents={[{ id: 'brain', name: 'Brain', skill_ids: ['core.assigned'] }]}
            />,
        );
        const newButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('new_automation'));
        await act(async () => newButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        const selects = container.querySelectorAll('select');
        await act(async () => {
            selects[0].value = 'brain';
            selects[0].dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(container.textContent).toContain('Assigned');
        expect(container.textContent).not.toContain('Hidden');
    });

    it('renders durable jobs and metadata-only audit events', async () => {
        const container = await render(<OperationsHistoryPanel resources={{
            loading: false,
            reload: vi.fn(),
            approvals: [],
            resolveApproval: vi.fn(),
            jobs: [{ job_id: 'reader:job-1', provider: 'reader', status: 'completed' }],
            auditEvents: [{
                id: 'event-1', tool_name: 'search_reader_articles', status: 'completed',
                agent_id: 'brain', duration_ms: 12, created_at: 1,
            }],
        }} />);

        expect(container.textContent).toContain('reader:job-1');
        expect(container.textContent).toContain('search_reader_articles');
        expect(container.textContent).not.toContain('body_text');
    });

    it('routes an automation approval with its exact agent and session scope', async () => {
        const resolveApproval = vi.fn().mockResolvedValue({});
        const approval = {
            confirmation_id: 'a'.repeat(32), action: 'governed_tool',
            agent_id: 'brain', session_id: 'automation:1:run:2', details: { tool: 'Publish' },
        };
        const container = await render(<OperationsHistoryPanel resources={{
            loading: false, reload: vi.fn(), approvals: [approval], resolveApproval,
            jobs: [], auditEvents: [],
        }} />);
        const approve = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('operations.approve'));
        await act(async () => approve.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(resolveApproval).toHaveBeenCalledWith(approval, 'confirm');
    });
});
