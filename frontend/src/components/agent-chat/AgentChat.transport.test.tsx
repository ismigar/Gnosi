import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentChat from '../AgentChat';
import { readChatStorage, removeChatStorage, writeChatStorage } from './chatPersistence';

const mocks = vi.hoisted(() => ({
  stream: vi.fn<typeof fetch>(),
  transport: vi.fn<typeof fetch>(),
  conversation: vi.fn<() => Promise<{ messages: { role: string; content: string; turn_id: string }[] }>>(),
  t: (key: string, fallback?: unknown): string => typeof fallback === 'string' ? fallback : key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t, i18n: { language: 'en', resolvedLanguage: 'en' } }) }));
vi.mock('lucide-react/dynamic', () => ({ iconNames: [], DynamicIcon: () => null }));
vi.mock('../../shared/api/specialized-transports', () => ({ streamFetch: mocks.stream }));
vi.mock('../../shared/api/transports', () => ({ transportFetch: mocks.transport }));
vi.mock('../../shared/api/notebooks', () => ({ fetchNotebookConversation: mocks.conversation }));
vi.mock('../../shared/api/configuration', () => ({ fetchConfiguration: () => Promise.resolve({ ai: {
  active_agent_id: 'gnosy', agents: [{ id: 'gnosy', name: 'Test Copilot', provider: 'fixture', model: 'fixture', icon: 'G' }],
} }) }));
vi.mock('../../shared/api/vaults', () => ({ fetchVaultPages: () => Promise.resolve([]), fetchVaultTables: () => Promise.resolve([]), fetchVaultDatabases: () => Promise.resolve([]) }));
vi.mock('../../lib/configEvents', () => ({ useConfigChanged: () => undefined }));
vi.mock('../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const scope = 'transport-test:personal:personal';
const scopedKeys = ['agent_chat_sessions_v2', 'agent_chat_active_session_id_v2', 'agent_selected_id_v2', 'agent_pending_checkpoint_deletes_v1', 'agent_session_id_v2', 'agent_selected_llm'].map((key) => `${key}:${scope}`);
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

beforeAll(() => {
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of scopedKeys) removeChatStorage(key);
  writeChatStorage('gnosi_active_vault', 'transport-test');
  writeChatStorage('gnosi_workspace_id', 'personal');
  writeChatStorage('gnosi_user_id', 'personal');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  mocks.transport.mockImplementation(() => Promise.resolve(Response.json({ confirmations: [] })));
  mocks.conversation.mockResolvedValue({ messages: [] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove();
  for (const key of [...scopedKeys, 'gnosi_active_vault', 'gnosi_workspace_id', 'gnosi_user_id']) removeChatStorage(key);
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); await Promise.resolve(); });
}

function requestPath(input: RequestInfo | URL): string {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  return `${url.pathname}${url.search}`;
}

async function submit(text: string): Promise<void> {
  const input = container.querySelector('textarea');
  if (!input) throw new Error('Missing chat composer');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  const form = container.querySelector('form');
  if (!form) throw new Error('Missing chat form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe('AgentChat shared transport integration', () => {
  it('renders split UTF-8 NDJSON and persists the same scoped conversation', async () => {
    mocks.stream.mockImplementation(() => {
      const bytes = new TextEncoder().encode('{"type":"message","sequence":1,"content":"Reunió 🧠"}\n{"type":"done","sequence":2}');
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      } })));
    });
    await render(<AgentChat embedded />);
    await submit('Explain this');
    expect(container.textContent).toContain('Reunió 🧠');
    expect(mocks.stream).toHaveBeenCalledOnce();
    const body = mocks.stream.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON chat body');
    expect(body).toContain('"llm_mode":"agent_default"');
    const stored = readChatStorage(`agent_chat_sessions_v2:${scope}`);
    expect(stored).toContain('Explain this');
    expect(stored).toContain('Reunió 🧠');
  });

  it('resumes a disconnected stream without sending the request or action twice', async () => {
    mocks.transport.mockImplementation((input) => Promise.resolve(requestPath(input).startsWith('/api/chat/streams/')
      ? new Response('{"type":"message","sequence":2,"content":"Recovered answer"}\n{"type":"done","sequence":3}\n')
      : Response.json({ confirmations: [] })));
    mocks.stream.mockImplementation(() => {
      let first = true;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(new TextEncoder().encode('{"type":"stream_open","sequence":1,"stream_id":"resume-fixture"}\n'));
        } else controller.error(new Error('connection lost'));
      } })));
    });
    await render(<AgentChat embedded />);
    await submit('Recover this');
    expect(container.textContent).toContain('Recovered answer');
    expect(mocks.stream).toHaveBeenCalledOnce();
    expect(mocks.transport.mock.calls.some(([input]) => requestPath(input).includes('/api/chat/streams/resume-fixture?') && requestPath(input).includes('after_sequence=1'))).toBe(true);
  });

  it('keeps notebook read-only mode and canonical conversation hydration', async () => {
    mocks.conversation.mockResolvedValue({ messages: [{ role: 'assistant', content: 'Canonical notebook answer', turn_id: 'turn' }] });
    await render(<AgentChat embedded forcedSessionId="notebook-session" forcedAgentId="gnosy" notebookId="notebook" readOnly />);
    expect(container.textContent).toContain('Canonical notebook answer');
    expect(container.textContent).toContain('An editor role is required');
    expect(container.querySelector('form')).toBeNull();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('reconciles an uncertain confirmation without executing it twice', async () => {
    mocks.transport.mockImplementation((input) => {
      const path = requestPath(input);
      if (path.endsWith('/confirm')) return Promise.reject(new Error('connection lost'));
      if (path.startsWith('/api/chat/confirmations/action?')) return Promise.resolve(Response.json({ status: 'completed' }));
      return Promise.resolve(Response.json({ confirmations: [{ confirmation_id: 'action', status: 'pending', details: { body: 'Review this body' } }] }));
    });
    // The intentionally lost response must be reconciled, never replayed.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await render(<AgentChat embedded />);
      const review = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Review and confirm');
      if (!review) throw new Error('Missing confirmation review');
      await act(async () => { review.click(); await Promise.resolve(); });
      expect(document.body.textContent).toContain('Review this body');
      const acknowledgement = document.querySelector('input[type="checkbox"]');
      if (!(acknowledgement instanceof HTMLInputElement)) throw new Error('Missing required acknowledgement');
      await act(async () => { acknowledgement.click(); await Promise.resolve(); });
      const confirm = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Confirm and execute');
      if (!confirm) throw new Error('Missing execution button');
      await act(async () => { confirm.click(); await Promise.resolve(); });
      expect(container.textContent).toContain('Action completed after confirmation.');
      expect(mocks.transport.mock.calls.filter(([input]) => requestPath(input).endsWith('/confirm'))).toHaveLength(1);
    } finally { errorLog.mockRestore(); }
  });
});
