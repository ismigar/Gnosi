import {act, useEffect, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import Dashboard from '../Dashboard';
import {useDashboard, type DashboardState} from './useDashboard';
import {useDashboardKeyboard} from './useDashboardKeyboard';
import {DirectivesDialog} from './DirectivesDialog';
import {DirectiveEditor} from './DirectiveEditor';
import {PermissionsDialog} from './PermissionsDialog';
import * as scheduler from '../../../shared/api/scheduler';
import * as analytics from '../../../shared/api/analytics';
import {fetchConfiguration} from '../../../shared/api/configuration';
import toast from '../../../shared/notifications/toast';
import {readStorage, writeStorage, removeStorage} from '../../../shared/platform/browser-storage';
import {USER_ROLE_STORAGE_KEY, WORKSPACE_ID_STORAGE_KEY} from '../../../shared/api/request-context';
import {dispatchWindowEvent} from '../../../shared/platform/browser-events';

const mocks = vi.hoisted(() => ({
    apiFetch: vi.fn<(url: string, options?: RequestInit) => Promise<unknown>>(),
    refetch: vi.fn(), clear: vi.fn(), enabled: true,
    task: {name: 'fixture_task', description: 'Synthetic task', enabled: true, interval_minutes: 60, status: 'idle'},
    directive: {name: 'fixture_directive', path: 'docs/fixture.md', category: 'Memory', size_bytes: 1024, trap_count: 1},
    member: {user_id: 'fixture-user', name: 'Fixture member', email: 'member@example.test', role: 'editor', joined_at: '2026-08-01', permissions: {capabilities: ['read'], custom: 'kept'}},
}));
vi.mock('react-i18next', () => {
    const t = (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key;
    return {useTranslation: () => ({t})};
});
vi.mock('../../../shared/api/use-api', () => ({useApi: () => ({apiFetch: mocks.apiFetch, role: 'owner'})}));
vi.mock('../../../shared/plugins/usePlugins', () => ({usePlugins: () => ({isEnabled: () => mocks.enabled})}));
vi.mock('../../../shared/ui/layout/AppHeader', () => ({AppHeader: ({children, title}: {children?: ReactNode; title: string}) => <header>{title}{children}</header>}));
vi.mock('../releases/ReleaseNotesDialog', () => ({ReleaseNotesDialog: () => null}));
vi.mock('../../../shared/notifications/toast', () => ({default: {error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 'fixture-toast')}}));
vi.mock('../../../shared/api/configuration', () => ({fetchConfiguration: vi.fn()}));
vi.mock('../../../shared/api/scheduler', () => ({
    fetchScheduledTasks: vi.fn(), fetchSchedulerHistory: vi.fn(),
    updateScheduledTask: vi.fn(), runScheduledTask: vi.fn(), clearSchedulerHistory: vi.fn(),
}));
vi.mock('../../../shared/api/analytics', () => ({
    fetchAnalyticsOverview: vi.fn(), fetchDirectiveAnalytics: vi.fn(), fetchTrapAnalytics: vi.fn(),
    fetchDirectiveContent: vi.fn(), saveDirectiveContent: vi.fn(), deleteDirective: vi.fn(),
}));
vi.mock('../../../shared/api/useSystemData', () => ({
    useSystemNotifications: () => ({data: {items: [], total: 0}, isFetching: false, refetch: mocks.refetch}),
    useClearSystemNotifications: () => ({mutateAsync: mocks.clear}),
}));
let container: HTMLDivElement;
let root: Root;
let current: DashboardState | null;
function state(): DashboardState {if (!current) throw new Error('Dashboard not mounted'); return current;}
function Harness() {
    const dashboard = useDashboard();
    useDashboardKeyboard(dashboard);
    useEffect(() => {current = dashboard;});
    return <><DirectivesDialog state={dashboard}/><DirectiveEditor state={dashboard}/><PermissionsDialog state={dashboard}/></>;
}
async function run(action: () => void | Promise<void>) {await act(async () => {await action();});}
function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(element => element.textContent.includes(label));
    if (!button) throw new Error('Missing button: ' + label);
    button.click();
}
beforeAll(() => {(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;});
beforeEach(() => {
    vi.clearAllMocks();
    current = null; mocks.enabled = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    writeStorage(WORKSPACE_ID_STORAGE_KEY, 'fixture-workspace');
    mocks.apiFetch.mockImplementation((url) => {
        if (url === '/api/workspaces') return Promise.resolve([{id: 'fixture-workspace', role: 'owner'}]);
        if (url.endsWith('/members')) return Promise.resolve([mocks.member]);
        if (url.endsWith('/vaults')) return Promise.resolve([]);
        return Promise.resolve([]);
    });
    vi.mocked(fetchConfiguration).mockResolvedValue({settings: {gnosi_mode: 'org'}});
    vi.mocked(scheduler.fetchScheduledTasks).mockResolvedValue([mocks.task]);
    vi.mocked(scheduler.fetchSchedulerHistory).mockResolvedValue({items: [], total: 31, limit: 15, offset: 0, has_more: true});
    vi.mocked(analytics.fetchDirectiveAnalytics).mockResolvedValue({directives: [mocks.directive], total: 25, limit: 12, offset: 0, has_more: true});
    vi.mocked(analytics.fetchTrapAnalytics).mockResolvedValue({traps: [], total: 0, limit: 15, offset: 0, has_more: false});
    vi.mocked(analytics.fetchDirectiveContent).mockResolvedValue({content: 'fixture content', path: mocks.directive.path});
});
afterEach(async () => {
    await run(() => {root.unmount();}); container.remove(); vi.useRealTimers();
    removeStorage(WORKSPACE_ID_STORAGE_KEY); removeStorage(USER_ROLE_STORAGE_KEY);
});
describe('Dashboard behavior', () => {
    it('renders task controls and organization members without changing scheduler payloads', async () => {
        await run(() => {root.render(<Dashboard/>);});
        expect(container.textContent).toContain('fixture task');
        expect(container.textContent).toContain('Synthetic task');
        expect(readStorage(USER_ROLE_STORAGE_KEY)).toBe('owner');
        const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!toggle) throw new Error('Missing scheduler toggle');
        await run(() => {toggle.click();});
        expect(scheduler.updateScheduledTask).toHaveBeenCalledWith({name: 'fixture_task', update: {enabled: false, interval_minutes: 60}});
        await run(() => {click('dashboard.tab_admin');});
        expect(container.textContent).toContain('Fixture member');
        expect(mocks.apiFetch).toHaveBeenCalledWith('/api/workspaces/fixture-workspace/members');
    });
    it('retains history offsets, polling intervals and cleanup', async () => {
        vi.useFakeTimers();
        await run(() => {root.render(<Harness/>);});
        await run(async () => {await state().fetchTaskHistory(2); state().setSelectedControlTab('history');});
        expect(scheduler.fetchSchedulerHistory).toHaveBeenLastCalledWith({limit: 15, offset: 30});
        await run(async () => {await vi.advanceTimersByTimeAsync(30000);});
        expect(scheduler.fetchScheduledTasks).toHaveBeenCalledTimes(2);
        expect(mocks.refetch).toHaveBeenCalledTimes(1);
        expect(mocks.apiFetch.mock.calls.filter(([url]) => url === '/api/tools/pending')).toHaveLength(3);
        await run(() => {root.unmount();});
        expect(vi.getTimerCount()).toBe(0);
        root = createRoot(container);
    });
    it('edits directives, preserves pagination and does not submit while typing multiline content', async () => {
        await run(() => {root.render(<Harness/>);});
        await run(async () => {await state().fetchDirectives(1); state().setIsDirectivesModalOpen(true); await state().handleEditDirective(mocks.directive);});
        expect(analytics.fetchDirectiveAnalytics).toHaveBeenCalledWith({limit: 12, offset: 12});
        const textarea = container.querySelector('textarea');
        if (!textarea) throw new Error('Missing directive editor');
        textarea.focus();
        await run(() => {dispatchWindowEvent(new KeyboardEvent('keydown', {key: 'Enter'}));});
        expect(analytics.saveDirectiveContent).not.toHaveBeenCalled();
        await run(() => {state().setEditorContent('updated fixture');});
        await run(async () => {await state().handleSaveDirective();});
        expect(analytics.saveDirectiveContent).toHaveBeenCalledWith({path: 'docs/fixture.md', content: 'updated fixture'});
        expect(state().editingDirective).toBeNull();
        await run(() => {dispatchWindowEvent(new KeyboardEvent('keydown', {key: 'Escape'}));});
        expect(state().isDirectivesModalOpen).toBe(false);
    });
    it('keeps invitation, role and per-vault access contracts', async () => {
        await run(() => {root.render(<Harness/>);});
        await run(() => {state().setNewMemberEmail('new@example.test'); state().setNewMemberRole('admin');});
        await run(async () => {await state().handleAddMember();});
        expect(mocks.apiFetch).toHaveBeenCalledWith('/api/workspaces/fixture-workspace/members', {method: 'POST', body: JSON.stringify({email: 'new@example.test', role: 'admin'})});
        await run(() => {state().setSelectedMember(mocks.member); state().setIsPermissionsModalOpen(true);});
        expect(container.textContent).toContain('Fixture member');
        await run(async () => {await state().handleUpdatePermissions('fixture-user', mocks.member.permissions, 'admin'); await state().toggleVaultAccess('fixture-user', 'fixture-vault');});
        expect(mocks.apiFetch).toHaveBeenCalledWith('/api/workspaces/fixture-workspace/members/fixture-user/role', {method: 'PUT', body: JSON.stringify({permissions: mocks.member.permissions, role: 'admin'})});
        expect(mocks.apiFetch).toHaveBeenCalledWith('/api/workspaces/fixture-workspace/members/fixture-user/vaults', {method: 'POST', body: JSON.stringify({vault_id: 'fixture-vault', permissions: {capabilities: ['read']}})});
    });
    it('retains data on background failure and reports directive errors without closing the editor', async () => {
        await run(() => {root.render(<Harness/>);});
        vi.mocked(scheduler.fetchScheduledTasks).mockRejectedValueOnce(new Error('offline'));
        await run(async () => {await state().fetchSchedulers();});
        expect(state().schedulers).toEqual([mocks.task]); expect(state().schedulerLoading).toBe(false);
        await run(async () => {await state().handleEditDirective(mocks.directive);});
        vi.mocked(analytics.saveDirectiveContent).mockRejectedValueOnce(new Error('save failed'));
        await run(async () => {await state().handleSaveDirective();});
        expect(toast.error).toHaveBeenCalledWith('dashboard.directive_save_error');
        expect(state().editingDirective?.path).toBe('docs/fixture.md');
    });
});
