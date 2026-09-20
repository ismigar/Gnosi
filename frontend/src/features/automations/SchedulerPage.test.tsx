import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import SchedulerPage from './SchedulerPage';

it('redirects legacy scheduler links to the system schedules without executing work', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
    await act(async () => { await Promise.resolve(); root.render(<MemoryRouter initialEntries={['/@example/automations']}><SchedulerPage /><Location /></MemoryRouter>); });
    expect(container.textContent).toBe('/dashboard?tab=schedulers&kind=system');
    act(() => { root.unmount(); });
    vi.unstubAllGlobals();
});
