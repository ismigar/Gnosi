// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ recorder: vi.fn(), reminders: vi.fn() }));
vi.mock('./MeetingRecorder', () => { loaded.recorder(); return { default: () => null }; });
vi.mock('./MeetingReminderWatcher', () => { loaded.reminders(); return { default: () => null }; });
import { MeetingRecorder, MeetingReminderWatcher } from './index';

describe('meetings public entry', () => {
  it('keeps recorder and reminder implementations deferred independently', () => {
    expect(MeetingRecorder).toBeDefined();
    expect(MeetingReminderWatcher).toBeDefined();
    expect(MeetingRecorder).not.toBe(MeetingReminderWatcher);
    expect(loaded.recorder).not.toHaveBeenCalled();
    expect(loaded.reminders).not.toHaveBeenCalled();
  });
});
