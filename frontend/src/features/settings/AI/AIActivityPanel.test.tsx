import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIActivityPanel } from './AIActivityPanel';

const mocks = vi.hoisted(() => ({
    runs: vi.fn(), reload: vi.fn(), refreshApprovals: vi.fn(), vault: 'first',
    resources: { skills: [], tools: [], automations: [], approvals: [], jobs: [], auditEvents: [], resourceErrors: {}, error: '', loading: false },
}));
vi.mock('./useAIResources', () => ({ useAIResources: () => ({ ...mocks.resources, reload: mocks.reload, refreshApprovals: mocks.refreshApprovals }) }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => mocks.vault }));
vi.mock('../../../shared/api/configuration', () => ({ fetchConfiguration: () => Promise.resolve({ ai: { agents: [{ id: 'brain', name: 'Assistant' }] } }) }));
vi.mock('../../../shared/api/ai-activity', () => ({ fetchAutomationRuns: mocks.runs, fetchAgentRuns: () => Promise.resolve([]), changeAgentRun: vi.fn(), fetchAgentTeamProposals: () => Promise.resolve([]), agentTraceRetention: () => Promise.resolve(30) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key, i18n: { resolvedLanguage: 'en' } }) }));
let root: Root;
let container: HTMLDivElement;
function Route({ tab = 'history' }: { readonly tab?: string }) {
    const location = useLocation();
    return <><output>{location.search}</output><AIActivityPanel tab={tab} aiEnabled automationsEnabled canEdit systemPanel={null} systemHistory={[
        { id: '1', task_name: 'run_capability_automations', status: 'completed', started_at: '2026-09-19T08:00:00Z', duration_seconds: 1, description: null, finished_at: null, message: null },
        { id: 'social-run', task_name: 'publish_scheduled_social', status: 'success', started_at: '2026-09-19T07:00:00Z', duration_seconds: 0.01, description: null, finished_at: null, message: 'Task publish_scheduled_social completed successfully.' },
    ]} systemHistoryMore={null} systemDiagnostics={<p>Diagnostics</p>} systemHistoryError="" /></>;
}
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.vault = 'first'; mocks.resources.error = ''; mocks.resources.resourceErrors = {};
    mocks.runs.mockReset(); mocks.refreshApprovals.mockReset();
    mocks.runs.mockResolvedValue({ runs: [{ id: 'run', automation_id: 'auto', automation_name: 'Morning briefing', agent_id: 'brain', skill_id: 'brief', status: 'completed', started_at: 1789804800, finished_at: 1789804802, ai_calls: 1, confirmation_count: 0, result_text: 'Useful final result' }], total: 1, offset: 0 });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { await Promise.resolve(); root.unmount(); }); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(tab = 'history') { await act(async () => { await Promise.resolve(); root.render(<MemoryRouter><Route tab={tab} /></MemoryRouter>); }); }

describe('Unified AI activity', () => {
    it('uses the accessible app switch to reveal internal runs', async () => {
        await mount();
        const toggle = container.querySelector<HTMLElement>('[role="switch"][aria-label="activity.internal_activity"]');
        expect(toggle?.getAttribute('aria-checked')).toBe('false');
        expect(container.textContent).not.toContain('run capability automations');
        await act(async () => { toggle?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); await Promise.resolve(); });
        expect(toggle?.getAttribute('aria-checked')).toBe('true');
        expect(container.textContent).toContain('run capability automations');
    });
    it('refreshes history when visible and on focus, with an icon-only fallback', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        await mount();
        const button = container.querySelector<HTMLButtonElement>('button[aria-label="common.refresh"]');
        expect(button?.textContent).toBe('');
        expect(button?.title).toBe('common.refresh');
        expect(button?.querySelector('svg')).not.toBeNull();
        const initial = mocks.runs.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
        expect(mocks.runs).toHaveBeenCalledTimes(initial + 1);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
        expect(mocks.runs).toHaveBeenCalledTimes(initial + 1);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        await act(async () => { dispatchWindowEvent(new Event('focus')); await Promise.resolve(); });
        expect(mocks.runs).toHaveBeenCalledTimes(initial + 2);
        await mount('schedulers');
        await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
        expect(mocks.runs).toHaveBeenCalledTimes(initial + 2);
    });
    it('explains system results and opens the specific service instead of exposing an unexplained ID', async () => {
        await mount();
        const card = [...container.querySelectorAll('article')].find(item => item.textContent.includes('publish scheduled social'));
        expect(card?.textContent).toContain('activity.system_completed');
        expect(card?.textContent).toContain('activity.duration_under_second');
        expect(card?.textContent).toContain('activity.run_reference_help');
        expect(card?.querySelector('code')?.textContent).toBe('social-run');
        const link = [...(card?.querySelectorAll('button') || [])].find(button => button.textContent === 'activity.view_schedule');
        await act(async () => { await Promise.resolve(); link?.click(); });
        expect(container.querySelector('output')?.textContent).toBe('?tab=schedulers&kind=system&task=publish_scheduled_social');
    });
    it('refreshes approvals automatically while visible and stops when leaving the tab', async () => {
        vi.useFakeTimers();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        await mount('approvals');
        const button = container.querySelector('button[aria-label="common.refresh"]');
        expect(button?.getAttribute('title')).toBe('common.refresh');
        expect(button?.textContent).toBe('');
        await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
        expect(mocks.refreshApprovals).toHaveBeenCalledTimes(1);
        visibility.mockReturnValue('hidden');
        await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
        expect(mocks.refreshApprovals).toHaveBeenCalledTimes(1);
        visibility.mockReturnValue('visible');
        await act(async () => { await Promise.resolve(); dispatchWindowEvent(new Event('focus')); });
        expect(mocks.refreshApprovals).toHaveBeenCalledTimes(2);
        await mount('schedulers');
        await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
        expect(mocks.refreshApprovals).toHaveBeenCalledTimes(2);
    });
    it('shows actual results, hides the internal runner and links to its definition', async () => {
        await mount();
        expect(container.textContent).toContain('Morning briefing');
        expect(container.textContent).toContain('Useful final result');
        expect(container.textContent).not.toContain('run capability automations');
        const link = [...container.querySelectorAll('button')].find(button => button.textContent === 'activity.view_schedule');
        await act(async () => { await Promise.resolve(); link?.click(); });
        expect(container.querySelector('output')?.textContent).toBe('?tab=schedulers&kind=personal&automation=auto');
    });
    it('distinguishes a failed history request from an empty history', async () => {
        mocks.runs.mockRejectedValue(new Error('History unavailable'));
        await mount();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('History unavailable');
        expect(container.textContent).not.toContain('activity.no_runs');
    });
    it('discards previous vault results while loading the new scope', async () => {
        await mount();
        mocks.vault = 'second';
        mocks.runs.mockImplementation(() => new Promise(() => undefined));
        await mount();
        expect(container.textContent).not.toContain('Morning briefing');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('common.loading');
    });
});
