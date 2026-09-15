import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { mailListMessageIdentity } from './mail-list/mailListModel';
import type { MailListMessage } from './mail-list/mailListTypes';
import { message, mocks, response, setupMailListTestHarness } from './MailList.test-harness';

const harness = setupMailListTestHarness();
afterEach(() => { vi.useRealTimers(); });

async function key(value: string): Promise<void> {
  await act(async () => {
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: value }));
    await Promise.resolve();
  });
}
async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function setup() {
  const onSelectMail = vi.fn<(mail: MailListMessage) => void>();
  mocks.fetchMessages.mockResolvedValue(response([message('one'), message('two'), message('three')]));
  await harness.render({ onSelectMail });
  vi.useFakeTimers();
  return onSelectMail;
}

function row(index: number): HTMLElement {
  const element = harness.container.querySelector(`[data-mail-index="${String(index)}"]`);
  if (!(element instanceof HTMLElement)) throw new Error('Missing mail row');
  return element;
}

describe('Mail keyboard reading', () => {
  it('opens only the row where arrows pause for 500 ms, even with an open viewer', async () => {
    const onSelectMail = await setup();
    const viewer = document.createElement('div');
    viewer.dataset.role = 'mail-viewer-scroll';
    const scrollBy = vi.fn();
    viewer.scrollBy = scrollBy;
    harness.container.append(viewer);
    await key('ArrowDown');
    await advance(300);
    await key('ArrowDown');
    await advance(499);
    expect(onSelectMail).not.toHaveBeenCalled();
    await advance(1);
    expect(onSelectMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'two' }));
    expect(scrollBy).not.toHaveBeenCalled();
    expect(row(1).className).toContain('ring-1');
    await key('ArrowUp');
    await advance(500);
    expect(onSelectMail).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'one' }));
  });

  it('handles consecutive key events without losing a move between renders', async () => {
    const onSelectMail = await setup();
    act(() => {
      dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    await advance(500);
    expect(onSelectMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'three' }));
  });

  it.each(['folder', 'search', 'composer'])('cancels an opening when changing %s', async change => {
    const onSelectMail = await setup();
    await key('ArrowDown');
    await advance(300);
    await harness.rerender({
      onSelectMail,
      ...(change === 'folder' ? { folder: 'INBOX' } : change === 'search' ? { searchQuery: 'two' } : { isComposing: true }),
    });
    await advance(500);
    expect(onSelectMail).not.toHaveBeenCalled();
  });

  it('opens immediately on click or Enter and cancels the deferred opening', async () => {
    const onSelectMail = await setup();
    await key('ArrowDown');
    await advance(300);
    await harness.click(row(1));
    expect(onSelectMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'two' }));
    await advance(500);
    expect(onSelectMail).toHaveBeenCalledTimes(1);
    await key('ArrowDown');
    await key('Enter');
    expect(onSelectMail).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'three' }));
    await advance(500);
    expect(onSelectMail).toHaveBeenCalledTimes(2);
  });

  it('retains read rows and pending keyboard focus when another message becomes read', async () => {
    const onSelectMail = await setup();
    const selectedMailIdentity = mailListMessageIdentity(message('one'));
    await harness.rerender({ onSelectMail, selectedMailIdentity });
    await key('ArrowDown');
    await advance(300);
    await harness.rerender({ onSelectMail, selectedMailIdentity, readMail: message('one') });
    await advance(200);
    expect(onSelectMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'two' }));
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(3);
    expect(row(1).className).toContain('ring-1');
  });

  it('cancels when focus enters an input and leaves typing alone', async () => {
    const onSelectMail = await setup();
    await key('ArrowDown');
    const input = document.createElement('input');
    harness.container.append(input);
    act(() => { input.focus(); });
    await advance(500);
    await key('ArrowDown');
    await advance(500);
    expect(onSelectMail).not.toHaveBeenCalled();
  });

  it('follows the displayed group order rather than the ungrouped sort order', async () => {
    const onSelectMail = vi.fn<(mail: MailListMessage) => void>();
    mocks.fetchMessages.mockResolvedValue(response([
      { ...message('one'), sender: 'Alice', subject: '1' },
      { ...message('two'), sender: 'Bob', subject: '2' },
      { ...message('three'), sender: 'Alice', subject: '3' },
    ]));
    await harness.render({ onSelectMail, activeView: {
      id: 'grouped', name: 'Grouped', actions: [], fields: [], filters: [],
      filter_logic: 'AND', group_by: 'sender', sort_by: 'subject', sort_dir: 'asc',
      created_at: null, updated_at: null,
    } });
    vi.useFakeTimers();
    await key('ArrowDown');
    await key('ArrowDown');
    await advance(500);
    expect(onSelectMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'three' }));
    expect(row(1).textContent).toContain('3');
    expect(row(1).className).toContain('ring-1');
  });

  it('cancels if the pending message is removed instead of opening its replacement', async () => {
    const onSelectMail = await setup();
    await key('ArrowDown');
    await advance(300);
    await harness.rerender({ onSelectMail, removedMail: message('one') });
    await advance(500);
    expect(onSelectMail).not.toHaveBeenCalled();
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(2);
  });

  it('cancels when the window loses focus', async () => {
    const onSelectMail = await setup();
    await key('ArrowDown');
    act(() => { dispatchWindowEvent(new Event('blur')); });
    await advance(500);
    expect(onSelectMail).not.toHaveBeenCalled();
  });
});
