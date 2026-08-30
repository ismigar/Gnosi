import { expect, it, vi } from 'vitest';
import { logChatError } from './chatDiagnostics';

const notify = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/notifyError', () => ({ notifyError: notify }));

it('keeps background errors local without posting system notifications', () => {
  const error = new Error('offline');
  logChatError('agent-chat-history', error);
  expect(notify).toHaveBeenCalledExactlyOnceWith('agent-chat-history', error, undefined, { toast: false, persist: false });
});
