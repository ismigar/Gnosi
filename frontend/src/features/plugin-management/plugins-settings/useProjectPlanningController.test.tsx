import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../../tests/api-request';
import { ACTIVE_VAULT_ID_KEY, getActiveVaultId } from '../../../shared/api/vault-context';
import { useProjectPlanningController } from './useProjectPlanningController';
import type { ProjectPlanningController } from './projectPlanningModel';

const api = vi.hoisted(() => ({
    fetchVaultTables: vi.fn(), fetchVaultPageReferencesByTable: vi.fn(),
}));
const plugins = vi.hoisted(() => ({
    config: { task_table_id: 'tasks', project_table_id: 'projects' },
    setPluginSettings: vi.fn(),
}));
const planning = vi.hoisted(() => ({ data: undefined, isFetching: false, refetch: vi.fn() }));
vi.mock('../../../shared/api/vaults', () => api);
vi.mock('../../../shared/api/usePlanningData', () => ({ usePlanningState: () => planning }));
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({
    getPluginSettings: () => plugins.config, setPluginSettings: plugins.setPluginSettings,
}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
    i18n: { language: 'en' }, t: (key: string) => key,
}) }));
let controller: ProjectPlanningController;
let root: Root;
function Harness() {
    const value = useProjectPlanningController();
    useLayoutEffect(() => { controller = value; });
    return null;
}
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    writeApiTestStorage(ACTIVE_VAULT_ID_KEY, 'vault-a');
    plugins.config = { task_table_id: 'tasks', project_table_id: 'projects' };
    api.fetchVaultTables.mockResolvedValue([]);
    api.fetchVaultPageReferencesByTable.mockImplementation((id: string) => Promise.resolve([
        { id: `${id}-b`, title: 'Zulu' }, { id: `${id}-a`, title: 'Alpha' },
    ]));
    root = createRoot(document.createElement('div'));
});
afterEach(() => {
    act(() => { root.unmount(); });
    resetApiTestStorage();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

it('loads every project and task label through the compact API and preserves sorting and assignment identities', async () => {
    await act(async () => { root.render(<Harness />); await Promise.resolve(); });
    expect(api.fetchVaultPageReferencesByTable.mock.calls).toEqual([
        ['tasks', { include_templates: false }, expect.any(AbortSignal)],
        ['projects', { include_templates: false }, expect.any(AbortSignal)],
    ]);
    expect(controller.sortedTasks.map(page => page.id)).toEqual(['tasks-a', 'tasks-b']);
    expect(controller.sortedProjects.map(page => page.id)).toEqual(['projects-a', 'projects-b']);
    expect(controller.taskPages.map(page => page.title)).toEqual(['Zulu', 'Alpha']);
    expect(controller.projectPages.map(page => page.title)).toEqual(['Zulu', 'Alpha']);
    expect(plugins.setPluginSettings).not.toHaveBeenCalled();
});

it('does not fetch unconfigured tables', async () => {
    plugins.config = { task_table_id: '', project_table_id: '' };
    await act(async () => { root.render(<Harness />); await Promise.resolve(); });
    expect(api.fetchVaultPageReferencesByTable).not.toHaveBeenCalled();
    expect(controller.taskPages).toEqual([]);
    expect(controller.projectPages).toEqual([]);
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function queuedReads() {
    return {
        tables: deferred<{ id: string; name: string }[]>(),
        tasks: deferred<{ id: string; title: string }[]>(),
        projects: deferred<{ id: string; title: string }[]>(),
    };
}

function resolveReads(reads: ReturnType<typeof queuedReads>, label: string) {
    reads.tables.resolve([{ id: 'same-table', name: `${label} table` }]);
    reads.tasks.resolve([{ id: 'same-task', title: `${label} task` }]);
    reads.projects.resolve([{ id: 'same-project', title: `${label} project` }]);
}

function installVaultReads(first: ReturnType<typeof queuedReads>, second: ReturnType<typeof queuedReads>) {
    api.fetchVaultTables.mockImplementation(() => (
        getActiveVaultId() === 'vault-a' ? first : second
    ).tables.promise);
    api.fetchVaultPageReferencesByTable.mockImplementation((tableId: string) => {
        const reads = getActiveVaultId() === 'vault-a' ? first : second;
        return tableId === 'tasks' ? reads.tasks.promise : reads.projects.promise;
    });
}

function expectCurrentRows(label: string) {
    expect(controller.tables.map(table => table.name)).toEqual([`${label} table`]);
    expect(controller.sortedTasks.map(page => page.title)).toEqual([`${label} task`]);
    expect(controller.sortedProjects.map(page => page.title)).toEqual([`${label} project`]);
    expect(controller.loading).toBe(false);
}

it('clears another vault from the open editor before loading the same table IDs', async () => {
    const first = queuedReads();
    const second = queuedReads();
    installVaultReads(first, second);
    await act(async () => {
        root.render(<Harness />);
        resolveReads(first, 'Alpha');
        await Promise.resolve();
    });
    expectCurrentRows('Alpha');
    writeApiTestStorage(ACTIVE_VAULT_ID_KEY, 'vault-b');
    act(() => { root.render(<Harness />); });
    expect(controller.tables).toEqual([]);
    expect(controller.projectPages).toEqual([]);
    expect(controller.taskPages).toEqual([]);
    expect(controller.loading).toBe(true);
    expect(api.fetchVaultTables).toHaveBeenCalledTimes(2);
    expect(api.fetchVaultPageReferencesByTable).toHaveBeenCalledTimes(4);
    expect(api.fetchVaultTables.mock.calls[0]?.[1]).toHaveProperty('aborted', true);
    expect(api.fetchVaultPageReferencesByTable.mock.calls[0]?.[2]).toHaveProperty('aborted', true);
    expect(api.fetchVaultPageReferencesByTable.mock.calls[1]?.[2]).toHaveProperty('aborted', true);
    await act(async () => { resolveReads(second, 'Beta'); await Promise.resolve(); });
    expectCurrentRows('Beta');
    expect(plugins.config).toEqual({ task_table_id: 'tasks', project_table_id: 'projects' });
    expect(plugins.setPluginSettings).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)('ignores old-vault requests that %s after the new vault is ready', async (completion) => {
    const first = queuedReads();
    const second = queuedReads();
    installVaultReads(first, second);
    await act(async () => { root.render(<Harness />); await Promise.resolve(); });
    writeApiTestStorage(ACTIVE_VAULT_ID_KEY, 'vault-b');
    await act(async () => {
        root.render(<Harness />);
        resolveReads(second, 'Beta');
        await Promise.resolve();
    });
    expectCurrentRows('Beta');
    await act(async () => {
        // Simulate a transport that does not honor AbortSignal cancellation.
        if (completion === 'resolve') resolveReads(first, 'Alpha');
        else {
            first.tables.reject(new Error('Old vault unavailable'));
            first.tasks.reject(new Error('Old vault unavailable'));
            first.projects.reject(new Error('Old vault unavailable'));
        }
        await Promise.resolve();
    });
    expectCurrentRows('Beta');
    expect(plugins.config).toEqual({ task_table_id: 'tasks', project_table_id: 'projects' });
    expect(plugins.setPluginSettings).not.toHaveBeenCalled();
});
