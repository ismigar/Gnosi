import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MeetingRecorder from './MeetingRecorder';
import MeetingReminderWatcher from './MeetingReminderWatcher';
import type { MeetingRecorderController } from './useMeetingRecorder';


const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  navigate: vi.fn(),
  recorder: vi.fn(),
  reminders: vi.fn(),
  vaultPath: vi.fn(),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));


vi.mock('../../lib/vaultRouting', () => ({
  vaultPath: mocks.vaultPath,
}));


vi.mock('../../shared/api/useCalendarData', () => ({
  useDismissMeetingReminder: () => ({ mutateAsync: mocks.dismiss }),
  useMeetingReminders: mocks.reminders,
}));


vi.mock('./useMeetingRecorder', () => ({
  useMeetingRecorder: mocks.recorder,
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
  mocks.dismiss.mockResolvedValue({ status: 'ok' });
  mocks.vaultPath.mockReturnValue('/vault/calendar');
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


function buttonWithText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}


function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  );
  const boundSetter = descriptor?.set?.bind(input);
  if (!boundSetter) throw new Error('Native input setter is unavailable');
  boundSetter(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}


function recorderController(
  overrides: Partial<MeetingRecorderController> = {},
): MeetingRecorderController {
  return {
    closePanel: vi.fn(),
    errMsg: '',
    mode: 'presencial',
    open: false,
    openMinutes: vi.fn(),
    openPanel: vi.fn(),
    pageId: null,
    phase: 'idle',
    reset: vi.fn(),
    retryUpload: vi.fn(),
    seconds: 0,
    setMode: vi.fn(),
    setTitle: vi.fn(),
    stageLabel: 'Processing',
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn(),
    title: '',
    ...overrides,
  };
}


describe('meeting controls', () => {
  it('opens an agenda and navigates after dismissing its reminder', async () => {
    mocks.reminders.mockReturnValue({
      data: {
        reminders: [{
          agenda: 'Review the migration checklist',
          id: 'meeting-1',
          location: 'Studio',
          minutes_until: 5,
          title: 'Gnosi 3 review',
        }],
      },
    });
    act(() => {
      root.render(<MeetingReminderWatcher />);
    });

    expect(container.textContent).not.toContain('Review the migration checklist');
    act(() => {
      buttonWithText('Agenda').click();
    });
    expect(container.textContent).toContain('Review the migration checklist');

    await act(async () => {
      buttonWithText('View in calendar').click();
      await Promise.resolve();
    });
    expect(mocks.vaultPath).toHaveBeenCalledWith('calendar');
    expect(mocks.navigate).toHaveBeenCalledWith('/vault/calendar');
    expect(mocks.dismiss).toHaveBeenCalledWith('meeting-1');
  });

  it('preserves the recorder launcher and typed idle controls', async () => {
    const closed = recorderController();
    mocks.recorder.mockReturnValue(closed);
    act(() => {
      root.render(<MeetingRecorder />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="meeting.launcher_title"]',
      )?.click();
    });
    expect(closed.openPanel).toHaveBeenCalledOnce();

    const opened = recorderController({ open: true });
    mocks.recorder.mockReturnValue(opened);
    act(() => {
      root.render(<MeetingRecorder />);
    });
    const titleInput = container.querySelector('input');
    if (!(titleInput instanceof HTMLInputElement)) {
      throw new Error('Meeting title input was not rendered');
    }
    act(() => {
      setInputValue(titleInput, 'Architecture review');
      buttonWithText('meeting.mode_online').click();
    });
    await act(async () => {
      buttonWithText('meeting.start').click();
      await Promise.resolve();
    });

    expect(opened.setTitle).toHaveBeenCalledWith('Architecture review');
    expect(opened.setMode).toHaveBeenCalledWith('online');
    expect(opened.startRecording).toHaveBeenCalledOnce();
  });
});
