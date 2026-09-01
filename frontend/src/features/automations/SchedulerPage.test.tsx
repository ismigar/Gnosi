import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SchedulerPage from './SchedulerPage';
import { formatTaskInterval, hoursToMinutes, minutesToHours } from './schedulerPageUtils';

const updateTask = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../../shared/ui/layout/AppHeader', () => ({
  AppHeader: ({ title }: { title: ReactNode }) => <header>{title}</header>,
}));
vi.mock('../../shared/api/useSchedulerTasks', () => ({
  useScheduledTasks: () => ({
    data: [{ description: 'Refresh the index', enabled: true, interval_minutes: 30,
      name: 'refresh_index', status: 'idle' }],
    error: null, isLoading: false, refetch: vi.fn(),
  }),
  useUpdateScheduledTask: () => ({ mutateAsync: updateTask }),
}));

let container: HTMLDivElement;
let root: Root;
beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.resetAllMocks();
  updateTask.mockResolvedValue({ success: true });
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('automation scheduler page', () => {
  it('preserves interval conversions and toggles a scheduled task', async () => {
    expect(formatTaskInterval(0.5)).toBe('30 s');
    expect(formatTaskInterval(60)).toBe('1 h');
    expect(minutesToHours(90)).toBe('1.5');
    expect(hoursToMinutes('1.5')).toBe(90);
    act(() => { root.render(<SchedulerPage />); });
    const toggle = container.querySelector('input[type="checkbox"]');
    if (!(toggle instanceof HTMLInputElement)) {
      throw new Error('Scheduler toggle was not rendered');
    }
    await act(async () => { toggle.click(); await Promise.resolve(); });
    expect(updateTask).toHaveBeenCalledWith({
      name: 'refresh_index', update: { enabled: false, interval_minutes: 30 },
    });
  });
});
