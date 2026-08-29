import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ContentCalendar from './ContentCalendar';
import SchedulerPage from './SchedulerPage';
import {
  localDateKey,
  postsForLocalDay,
  weekDaysFor,
} from './contentCalendarUtils';
import {
  formatTaskInterval,
  hoursToMinutes,
  minutesToHours,
} from './schedulerPageUtils';


const mocks = vi.hoisted(() => ({
  cancelPost: vi.fn(),
  toastSuccess: vi.fn(),
  updateTask: vi.fn(),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../i18n', () => ({ default: { language: 'en' } }));


vi.mock('../components/AppHeader', () => ({
  AppHeader: ({ title }: { title: React.ReactNode }) => <header>{title}</header>,
}));


vi.mock('../components/ConfirmModal', () => ({
  default: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => unknown;
  }) => isOpen
    ? (
        <button
          type="button"
          onClick={() => {
            void onConfirm();
          }}
        >
          Confirm cancellation
        </button>
      )
    : null,
}));


vi.mock('../lib/toast', () => ({
  toast: { error: vi.fn(), success: mocks.toastSuccess },
}));


vi.mock('../shared/api/useSocialData', () => ({
  useCancelScheduledSocialPost: () => ({ mutateAsync: mocks.cancelPost }),
  useScheduledSocialPosts: () => ({
    data: [{
      content: 'Scheduled update',
      id: 'post-1',
      networks: ['mastodon'],
      scheduled_time: new Date().toISOString(),
      status: 'pending',
    }],
    isLoading: false,
  }),
}));


vi.mock('../shared/api/useSchedulerTasks', () => ({
  useScheduledTasks: () => ({
    data: [{
      description: 'Refresh the index',
      enabled: true,
      interval_minutes: 30,
      name: 'refresh_index',
      status: 'idle',
    }],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useUpdateScheduledTask: () => ({ mutateAsync: mocks.updateTask }),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.resetAllMocks();
  mocks.cancelPost.mockResolvedValue({ status: 'cancelled' });
  mocks.updateTask.mockResolvedValue({ success: true });
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


describe('operational pages', () => {
  it('groups scheduled posts by local date and cancels from the calendar', async () => {
    const now = new Date();
    const sundayWeek = weekDaysFor(new Date(2026, 7, 30));
    expect(sundayWeek.map(localDateKey)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
    expect(localDateKey(now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(postsForLocalDay([{
      content: 'Scheduled update',
      id: 'post-1',
      networks: ['mastodon'],
      scheduled_time: now.toISOString(),
      status: 'pending',
    }], now)).toHaveLength(1);

    act(() => {
      root.render(<ContentCalendar />);
    });
    const cancelButton = container.querySelector('button[title="Cancel"]');
    if (!(cancelButton instanceof HTMLButtonElement)) {
      throw new Error('Calendar cancel button was not rendered');
    }
    act(() => {
      cancelButton.click();
    });
    await act(async () => {
      const confirmButton = [...container.querySelectorAll('button')]
        .find((button) => button.textContent.includes('Confirm cancellation'));
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(mocks.cancelPost).toHaveBeenCalledWith('post-1');
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
  });

  it('preserves interval conversions and toggles a scheduled task', async () => {
    expect(formatTaskInterval(0.5)).toBe('30 s');
    expect(formatTaskInterval(60)).toBe('1 h');
    expect(minutesToHours(90)).toBe('1.5');
    expect(hoursToMinutes('1.5')).toBe(90);

    act(() => {
      root.render(<SchedulerPage />);
    });
    const toggle = container.querySelector('input[type="checkbox"]');
    if (!(toggle instanceof HTMLInputElement)) {
      throw new Error('Scheduler toggle was not rendered');
    }
    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });
    expect(mocks.updateTask).toHaveBeenCalledWith({
      name: 'refresh_index',
      update: { enabled: false, interval_minutes: 30 },
    });
  });
});
