import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AutomationsSettingsPanel, OperationsHistoryPanel } from './AIOperationsSettings';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values: { count?: unknown } = {}) => (
            typeof values.count === 'number'
                ? `${key}:${values.count.toString()}`
                : key
        ),
        i18n: { language: 'en', resolvedLanguage: 'en' },
    }),
}));

const { toastMock } = vi.hoisted(() => {
    const mock = { success: vi.fn(), error: vi.fn() };
    return { toastMock: mock };
});
vi.mock('../../lib/toast', () => ({ toast: toastMock }));
vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));


interface RenderedRoot {
    container: HTMLDivElement;
    root: Root;
}


const roots: RenderedRoot[] = [];
const render = (element: ReactElement): HTMLDivElement => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });
    act(() => {
        root.render(element);
    });
    return container;
};

beforeAll(() => {
    const reactTestGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    while (roots.length) {
        const rendered = roots.pop();
        if (!rendered) break;
        const { root, container } = rendered;
        act(() => {
            root.unmount();
        });
        container.remove();
    }
    vi.clearAllMocks();
});

describe('AI governed operations settings', () => {
    it('only offers skills assigned to the selected agent', () => {
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
        const container = render(
            <AutomationsSettingsPanel
                resources={resources}
                agents={[{ id: 'brain', name: 'Brain', skill_ids: ['core.assigned'] }]}
            />,
        );
        const newButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('new_automation'));
        if (!newButton) throw new Error('New automation action was not rendered');
        act(() => {
            newButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        const selects = container.querySelectorAll('select');
        const agentSelect = selects.item(0);
        act(() => {
            agentSelect.value = 'brain';
            agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(container.textContent).toContain('Assigned');
        expect(container.textContent).not.toContain('Hidden');
    });

    it('renders durable jobs and metadata-only audit events', () => {
        const container = render(<OperationsHistoryPanel resources={{
            approvals: [],
            resolveApproval: vi.fn(),
            jobs: [{ job_id: 'reader:job-1', provider: 'reader', status: 'completed' }],
            auditEvents: [{
                id: 'event-1', tool_name: 'search_reader_articles', status: 'completed',
                agent_id: 'brain', duration_ms: 12, created_at: 1,
            }],
        }} />);

        expect(container.textContent).toContain('reader:job-1');
        expect(container.textContent).toContain('settings.ai.operations.capability_event');
        expect(container.textContent).not.toContain('body_text');
    });

    it('routes an automation approval with its exact agent and session scope', async () => {
        const resolveApproval = vi.fn().mockResolvedValue({});
        const approval = {
            confirmation_id: 'a'.repeat(32), action: 'governed_tool',
            agent_id: 'brain', session_id: 'automation:1:run:2', details: { tool: 'Publish' },
        };
        const container = render(<OperationsHistoryPanel resources={{
            approvals: [approval], resolveApproval,
            jobs: [], auditEvents: [],
        }} />);
        const approve = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('operations.approve'));
        if (!approve) throw new Error('Approval action was not rendered');
        await act(async () => {
            approve.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });
        expect(resolveApproval).toHaveBeenCalledWith(approval, 'confirm');
    });
});
