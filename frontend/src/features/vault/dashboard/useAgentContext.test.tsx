import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { expect, it } from 'vitest';
import { useAgentContext } from './useAgentContext';
import type { DashboardActions } from './useDashboardActions';
import { subscribeAppEvent, type ModuleContextRef } from '../../../shared/platform/app-events';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('republishes the same open page after navigation changes its location key', () => {
    const page = { id: 'project', title: 'Project', content: '```gnosi-view\n{"view_id":"tasks"}\n```' };
    const context = { activeTabId: 'project', activeTableId: '', activeViewId: '', pages: [page], tabs: [page],
        viewMode: 'editor', resolvePageTableId: () => '', registry: {
            tables: [{ id: 'table', name: 'Tasks' }], views: [{ id: 'tasks', table_id: 'table', name: 'Planning' }],
        } } as unknown as DashboardActions;
    function Probe() {
        useAgentContext(context);
        const navigate = useNavigate();
        return <button onClick={() => { void navigate('/knowledge?tab=project'); }}>Navigate</button>;
    }
    const published: (readonly ModuleContextRef[])[] = [];
    const stop = subscribeAppEvent('gnosi:module-context', refs => { published.push(refs); });
    const element = document.createElement('div'); document.body.appendChild(element);
    const root = createRoot(element);
    try {
        act(() => { root.render(<MemoryRouter initialEntries={['/knowledge']}><Probe /></MemoryRouter>); });
        expect(published).toHaveLength(1);
        act(() => { element.querySelector('button')?.click(); });
        expect(published).toHaveLength(2);
        expect(published[1]).toEqual([
            expect.objectContaining({ type: 'page', ref: 'project' }),
            expect.objectContaining({ type: 'table', ref: 'table', scope: { view_id: 'tasks', view_name: 'Planning', page_id: 'project' } }),
        ]);
    } finally {
        act(() => { root.unmount(); }); stop(); element.remove();
    }
});
