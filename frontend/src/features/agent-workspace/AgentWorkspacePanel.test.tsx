import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWorkspacePanel } from './AgentWorkspacePanel';

const mocks = vi.hoisted(() => ({
  request: vi.fn<(path: string, identity: unknown, body?: unknown, method?: string, signal?: AbortSignal) => Promise<unknown>>(),
  pages: vi.fn(), native: vi.fn(),
  translation: { t: (key: string) => key, i18n: { language: 'en' } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => mocks.translation }));
vi.mock('../../shared/api/agent-workspace', () => ({ workspaceRequest: mocks.request, uploadWorkspaceFile: vi.fn(), checkedWorkspaceDownload: vi.fn() }));
vi.mock('../../shared/api/vaults', () => ({ fetchVaultPages: mocks.pages }));
vi.mock('./useVoiceConversation', () => ({ useVoiceConversation: () => ({ active: false, supported: false, failed: false, toggle: vi.fn(), stop: vi.fn(), output: { state: 'idle', error: false } }) }));
vi.mock('../../shared/speech/SpeechSettings', () => ({ SpeechSettings: () => null }));
let container: HTMLDivElement;
let root: Root;
const props = { scopeKey: 'vault-a', agentId: 'agent', sessionId: 'session', readOnly: false,
  onPrompt: vi.fn(), onVoicePrompt: vi.fn(), latestAssistantReply: '', isAgentBusy: false };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function render(overrides: Partial<typeof props> = {}) {
  await act(async () => { root.render(<AgentWorkspacePanel {...props} {...overrides} />); await Promise.resolve(); });
  await settle();
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => { button.click(); await Promise.resolve(); }); await settle();
}
async function open() {
  const details = container.querySelector('details');
  if (!details) throw new Error('Missing workspace');
  await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); await Promise.resolve(); }); await settle();
}
async function select(index: number, value: string) {
  const control = container.querySelectorAll('select')[index];
  if (!control) throw new Error('Missing select');
  await act(async () => { control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); }); await settle();
}
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  mocks.request.mockImplementation(async (path, _identity, _body, method) => {
    await Promise.resolve();
    if (path === 'status') return { connected: true };
    if (path === 'native-scope') return { scope_key: 'native-a' };
    if (path === 'grants') return [{ id: 'folder-a', name: 'Authorized folder' }];
    if (path === 'documents' && method === 'GET') return [];
    if (path === 'documents') return { id: 'capture', page_id: 'page-a', title: 'Captured page', content: 'Original' };
    if (path === 'documents/capture/preview') return { diff: '-Original\n+Edited' };
    if (path === 'documents/capture/apply') return { status: 'conflict' };
    return [];
  });
  mocks.pages.mockResolvedValue([{ id: 'page-a', title: 'Existing page' }]);
  mocks.native.mockResolvedValue({ status: 'completed' });
});
afterEach(async () => {
  await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove(); Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});
describe('scoped agent workspace panel', () => {
  it('does not load or initialize native permissions while closed or read-only', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { workspaceOperation: mocks.native } });
    await render(); expect(mocks.request).not.toHaveBeenCalled();
    await render({ readOnly: true }); expect(container.querySelector('details')).toBeNull();
    await settle(); expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.native).not.toHaveBeenCalled();
  });
  it('loads grants, status, document history and analysis only when opened', async () => {
    await render(); await open();
    expect(mocks.request.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['grants', 'status', 'documents', 'analysis']));
    expect(container.textContent).toContain('Authorized folder');
    for (const call of mocks.request.mock.calls) expect(call[1]).toEqual({ agent_id: 'agent', session_id: 'session' });
  });
  it('revokes an initialized native scope and resets the panel when the vault changes', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { workspaceOperation: mocks.native } });
    await render(); await open(); await select(0, 'native');
    await click('agent_workbench.read_browser');
    expect(mocks.native).toHaveBeenCalledWith(expect.objectContaining({ action: 'browser-snapshot', scopeKey: 'native-a' }));
    await render({ scopeKey: 'vault-b' });
    expect(container.querySelector('details')?.open).toBe(false);
    expect(mocks.native).toHaveBeenCalledWith(expect.objectContaining({ action: 'revoke', scopeKey: 'native-a' }));
  });
  it('requires preview before apply, displays conflicts, and retains the request identity on retry', async () => {
    await render(); await open(); await select(0, 'document');
    expect(container.textContent).not.toContain('agent_workbench.apply_changes');
    await click('agent_workbench.choose_page'); await select(3, 'page-a');
    await click('agent_workbench.open_document');
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('Missing document content');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    await act(async () => { descriptor?.set?.call(textarea, 'Edited'); textarea.dispatchEvent(new Event('input', { bubbles: true })); await Promise.resolve(); });
    await click('agent_workbench.review_changes');
    expect(container.textContent).toContain('-Original');
    await click('agent_workbench.apply_changes');
    expect(container.textContent).toContain('agent_workbench.document_status.conflict');
    await click('agent_workbench.apply_changes');
    const applies = mocks.request.mock.calls.filter(call => call[0] === 'documents/capture/apply');
    expect(applies).toHaveLength(2);
    expect(applies[0]?.[2]).toEqual(applies[1]?.[2]);
    expect(applies[0]?.[2]).toHaveProperty('content', 'Edited');
    expect(applies[0]?.[2]).toHaveProperty('request_id');
  });
  it('discards a diff when the document changes before preview returns', async () => {
    let release: ((value: unknown) => void) | undefined;
    const original = mocks.request.getMockImplementation();
    if (!original) throw new Error('Missing fixture implementation');
    mocks.request.mockImplementation((...args) => args[0].endsWith('/preview')
      ? new Promise(resolve => { release = resolve; }) : original(...args));
    await render(); await open(); await select(0, 'document');
    await click('agent_workbench.choose_page'); await select(3, 'page-a');
    await click('agent_workbench.open_document');
    await click('agent_workbench.review_changes');
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('Missing document content');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    await act(async () => {
      descriptor?.set?.call(textarea, 'Changed during preview');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { release?.({ diff: 'Diff for original content' }); await Promise.resolve(); });
    await settle();
    expect(container.textContent).not.toContain('Diff for original content');
    expect(container.textContent).not.toContain('agent_workbench.apply_changes');
    expect(mocks.request.mock.calls.some(call => call[0].endsWith('/apply'))).toBe(false);
  });
  it('aborts loads from an old scope and discards a late result', async () => {
    let release: ((value: unknown) => void) | undefined;
    mocks.request.mockImplementation((path) => path === 'grants' ? new Promise(resolve => { release = resolve; }) : Promise.resolve(path === 'status' ? {} : []));
    await render(); await open();
    const signal = mocks.request.mock.calls.find(call => call[0] === 'grants')?.[4];
    await render({ scopeKey: 'vault-b' }); expect(signal?.aborted).toBe(true);
    await act(async () => { release?.([{ id: 'stale', name: 'Private old folder' }]); await Promise.resolve(); });
    expect(container.textContent).not.toContain('Private old folder');
  });
});
