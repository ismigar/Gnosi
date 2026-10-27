import { act, useRef, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { useAppKeyboardScroll } from '../../../shared/hooks/useAppKeyboardScroll';
import { useMailListNavigation } from './mail-list/useMailListNavigation';
import type { MailListMessage } from './mail-list/mailListTypes';

const messages: MailListMessage[] = ['one', 'two'].map(id => ({ id, account: 'reader@example.invalid', date: '2026-10-01', has_attachments: false, imap_folder: 'INBOX', imap_uid: id, is_read: false, is_starred: false, sender: 'sender@example.invalid', snippet: id, subject: id, thread_id: id, timestamp: 1 }));
function MailPane({ onOpen }: { onOpen: (message: MailListMessage) => void }) {
  const ref = useRef<HTMLDivElement>(null), [selectedIds, setSelectedIds] = useState(new Set<string>());
  useMailListNavigation({ blocked: false, listRef: ref, messages, onSelectMail: onOpen, onTrashMessage: () => {}, onTrashSelected: () => {}, scope: 'test', selectedIds, setSelectedIds });
  return <div ref={ref} tabIndex={0} data-role="mail-list-scroll" style={{ overflowY: 'auto' }}><output>{selectedIds.size}</output></div>;
}
function App({ show, onOpen }: { show: boolean; onOpen: (message: MailListMessage) => void }) {
  const ref = useRef<HTMLElement>(null); useAppKeyboardScroll(ref, 'mail');
  return <main ref={ref}>{show && <MailPane onOpen={onOpen} />}</main>;
}
function key(target: HTMLElement, value: string) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });
}
afterEach(() => { vi.useRealTimers(); });

test('real late-mounted mail navigation owns arrows, delayed opening and Space while unclaimed PageDown scrolls', async () => {
  vi.useFakeTimers(); const onOpen = vi.fn();
  const view = mountTestComponent(<App show={false} onOpen={onOpen} />);
  view.render(<App show onOpen={onOpen} />);
  const list = view.container.querySelector<HTMLElement>('[data-role="mail-list-scroll"]');
  if (!list) throw new Error('Missing real mail list region');
  const scrollBy = vi.fn();
  Object.defineProperties(list, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 }, scrollBy: { value: scrollBy } });
  list.focus(); key(list, 'ArrowDown'); key(list, 'ArrowDown');
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'two' }));
  key(list, ' '); expect(list.querySelector('output')?.textContent).toBe('1'); expect(scrollBy).not.toHaveBeenCalled();
  key(list, 'PageDown'); expect(scrollBy).toHaveBeenCalledOnce(); view.unmount();
});
