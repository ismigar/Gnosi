import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { usePageToolbar } from './usePageToolbar';
import type { DashboardActions } from './useDashboardActions';
import { fetchResourceProcessingStatus } from '../../../shared/api/resource-processing';
import { getResourceProcessingTasks, resetResourceProcessingTasks } from '../../literature';

vi.mock('./useVaultHome', () => ({ useVaultHome: () => ({ homeReady: false, homeId: null }) }));
vi.mock('../../../shared/api/resource-processing', () => ({ fetchResourceProcessingStatus: vi.fn() }));

it.each([
    ['error', false, false], ['partial', true, false], ['error', true, false],
    ['done', true, true], ['idle', false, false],
] as const)('uses durable %s status after reload (processed=%s)', async (phase, processed, force) => {
    resetResourceProcessingTasks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(fetchResourceProcessingStatus).mockResolvedValue({ phase, running: false, error: 'Durable processing failure', created: [], updated: [] });
    const setResourceToProcess = vi.fn();
    const sourceConfig = { source_tables: [{ table_id: 'resources' }] };
    const isPluginEnabled = () => true;
    const translate = (_key: string, fallback: string) => fallback;
    let actions: ReturnType<typeof usePageToolbar>['pageActions'] | undefined;
    function Harness() {
        const [llmWikiJobs, setLlmWikiJobs] = useState<DashboardActions['llmWikiJobs']>({});
        const context = {
            activeTabId: 'source', viewMode: 'editor',
            pages: [{ id: 'source', title: 'Book', metadata: processed ? { 'Processat pel Cervell': '2026-09-27' } : {} }],
            tabs: [{ id: 'source' }], registry: { tables: [{ id: 'resources' }] },
            codeViewByTabId: {}, editLockedByPageId: {}, resolvePageTableId: () => 'resources',
            llmWikiConfig: sourceConfig, llmWikiJobs, setLlmWikiJobs, isPluginEnabled, setResourceToProcess,
            t: translate,
        } as unknown as DashboardActions;
        actions = usePageToolbar(context).pageActions;
        return null;
    }
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => { root.render(<Harness />); await Promise.resolve(); });
        expect(actions?.canProcessResource).toBe(true);
        if (phase === 'error' || phase === 'partial') {
            expect(actions?.processResourceLabel).toBe('Resume interrupted processing');
            expect(getResourceProcessingTasks()).toEqual([expect.objectContaining({
                noteId: 'source', state: 'error', background: true, error: 'Durable processing failure',
            })]);
            expect(getResourceProcessingTasks()[0]?.job?.created).toEqual([]);
            expect(getResourceProcessingTasks()[0]?.job?.updated).toEqual([]);
        } else {
            expect(getResourceProcessingTasks()).toHaveLength(0);
        }
        act(() => { actions?.onProcessResource(); });
        expect(setResourceToProcess).toHaveBeenCalledExactlyOnceWith({
            noteId: 'source', title: 'Book', sourceTableId: 'resources', force,
        });
    } finally {
        act(() => { root.unmount(); });
        resetResourceProcessingTasks();
        vi.unstubAllGlobals();
    }
});
