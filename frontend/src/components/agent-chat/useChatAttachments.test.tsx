import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatAttachments } from './useChatAttachments';
import type { ChatAttachment } from './composerModel';
import type { StoredChatMessage } from './sessionModel';
import type { removeChatAttachment, uploadChatAttachment } from '../../shared/api/chat-attachments';

const api = vi.hoisted(() => ({ upload: vi.fn<typeof uploadChatAttachment>(), remove: vi.fn<typeof removeChatAttachment>() }));
vi.mock('../../shared/api/chat-attachments', () => ({ uploadChatAttachment: api.upload, removeChatAttachment: api.remove }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('./chatDiagnostics', () => ({ logChatError: vi.fn() }));

function Harness() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [messages, setMessages] = useState<readonly StoredChatMessage[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actions = useChatAttachments({ selectedAgentId: 'agent', sessionId: 'session', attachments, isUploadingAttachment, fileInputRef, setAttachments, setMessages, setIsUploadingAttachment });
  return <>
    <input type="file" ref={fileInputRef} onChange={(event) => { void actions.handleAttachmentInputChange(event); }} />
    <button disabled={isUploadingAttachment} onClick={actions.handlePickAttachment}>Pick</button>
    {attachments.map((attachment) => <button key={attachment.id} onClick={() => { actions.removeAttachment(attachment.id); }}>{attachment.name}</button>)}
    <output>{messages.map((message) => message.content).join('\n')}</output>
  </>;
}
let container: HTMLDivElement;
let root: Root;
beforeAll(() => { const target = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; target.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks();
  api.remove.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });

async function pick(files: File[]): Promise<void> {
  const input = container.querySelector('input');
  if (!input) throw new Error('Missing file input');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
  expect(input.value).toBe('');
}

describe('chat attachment lifecycle', () => {
  it('uploads files in order and removes only the selected attachment', async () => {
    api.upload.mockResolvedValueOnce('one.txt').mockResolvedValueOnce('two.txt');
    const one = new File(['one'], 'one.txt'); const two = new File(['two'], 'two.txt');
    await pick([one, two]);
    expect(api.upload.mock.calls.map(([file]) => file.name)).toEqual(['one.txt', 'two.txt']);
    expect(api.upload.mock.calls[0]?.[1]).toEqual({ agent_id: 'agent', session_id: 'session' });
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent === 'one.txt');
    if (!remove) throw new Error('Missing uploaded file');
    await act(async () => { remove.click(); await Promise.resolve(); });
    expect(api.remove).toHaveBeenCalledExactlyOnceWith('one.txt', { agent_id: 'agent', session_id: 'session' });
    expect(container.textContent).toContain('two.txt');
    expect(container.textContent).not.toContain('one.txt');
  });
  it('cleans up already uploaded files if a subsequent upload fails', async () => {
    api.upload.mockResolvedValueOnce('one.txt').mockRejectedValueOnce(new Error('offline'));
    await pick([new File(['one'], 'one.txt'), new File(['two'], 'two.txt')]);
    expect(api.remove).toHaveBeenCalledExactlyOnceWith('one.txt', { agent_id: 'agent', session_id: 'session' });
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('output')?.textContent).toContain('Error uploading attachment');
    expect(container.querySelector('button')?.disabled).toBe(false);
  });
  it('enforces eight attachments and reports skipped files', async () => {
    api.upload.mockImplementation((file) => Promise.resolve(file.name));
    await pick(Array.from({ length: 9 }, (_, index) => new File([], `file-${String(index)}.txt`)));
    expect(api.upload).toHaveBeenCalledTimes(8);
    expect(container.querySelector('output')?.textContent).toContain('exceed the size or count limit');
  });
});
