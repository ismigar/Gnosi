import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiTestStorage } from '../../../tests/api-request';
import { usePlanningWorklogs } from './usePlanningData';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

function Worklogs() {
  const query = usePlanningWorklogs();
  return <output data-state={query.status}>{query.data?.actualHoursByTask.task ?? ''}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => { root.unmount(); });
  client.clear();
  container.remove();
  resetApiTestStorage();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('planning cloud read recovery', () => {
  it('keeps unavailable history pending and retries after the server delay', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(
        { detail: { code: 'planning_storage_pending', message: 'Downloading' } },
        { status: 503, headers: { 'Retry-After': '3' } },
      ))
      .mockResolvedValue(Response.json({ worklogs: [], actualHoursByTask: { task: 2 } }));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Worklogs /></QueryClientProvider>);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('output')?.getAttribute('data-state')).toBe('pending');
    expect(container.textContent).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('2');
    expect(container.querySelector('output')?.getAttribute('data-state')).toBe('success');
  });

  it('stops on a failed download instead of retrying forever or showing empty history', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { detail: { code: 'planning_storage_unavailable' } }, { status: 503 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Worklogs /></QueryClientProvider>);
      await vi.advanceTimersByTimeAsync(120_000);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('output')?.getAttribute('data-state')).toBe('error');
    expect(container.textContent).toBe('');
  });

  it.each([401, 403, 404])('does not retry a permanent %s response', async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { detail: 'Unavailable' }, { status },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Worklogs /></QueryClientProvider>);
      await vi.advanceTimersByTimeAsync(120_000);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('output')?.getAttribute('data-state')).toBe('error');
  });
});
