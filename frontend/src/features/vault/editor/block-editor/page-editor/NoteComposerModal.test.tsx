import { dispatchWindowEvent } from '../../../../../shared/platform/browser-events';
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import { resetApiTestStorage, writeApiTestStorage } from '../../../../../../tests/api-request';
import { fetchVaultPage } from '../../../../../shared/api/vaults';
import { applyNoteComposition, previewNoteComposition, type ComposerPreview } from '../../../../../shared/api/vault-composer';
import { GnosiApiError } from '../../../../../shared/api/errors';
import { NoteComposerModal } from './NoteComposerModal';

vi.mock('../../../../../shared/api/vaults', () => ({ fetchVaultPage: vi.fn() }));
vi.mock('../../../../../shared/api/vault-composer', () => ({ applyNoteComposition: vi.fn(), previewNoteComposition: vi.fn() }));
vi.mock('../../../../../shared/ui/createPanePortal', () => ({ createPanePortal: (children: ReactElement) => children }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const cleanups: (() => void)[] = [];
const preview: ComposerPreview = { request: { source_id: 'source', mode: 'extract', selection: 'note', heading: '', title: 'New', target_id: 'new' }, token: 'a'.repeat(64), rewritten_links: 1,
  changes: [{ id: 'source', title: 'Source', before: 'Original', after: '![[new]]', etag: 'old', created: false }, { id: 'new', title: 'New', before: '', after: 'Original', etag: null, created: true }] };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  vi.mocked(fetchVaultPage).mockResolvedValue({ id: 'source', content: 'Original\n\nOther', title: 'Source', metadata: {}, folder: '', etag: 'old' });
  vi.mocked(previewNoteComposition).mockResolvedValue(preview);
  vi.mocked(applyNoteComposition).mockResolvedValue({ source_id: 'source', target_id: 'new', changes: preview.changes });
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); resetApiTestStorage(); vi.unstubAllGlobals(); });
async function mount(flush = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)) {
  const onApplied = vi.fn(); const onClose = vi.fn(); const onFlushed = vi.fn();
  let view: ReturnType<typeof mountTestComponent> | undefined;
  await act(async () => { view = mountTestComponent(<NoteComposerModal sourceId="source" idToTitle={{ source: 'Source', target: 'Target' }} flush={flush} onFlushed={onFlushed} onClose={onClose} onApplied={onApplied} />); await Promise.resolve(); });
  if (!view) throw new Error('Missing view');
  cleanups.push(view.unmount);
  const container = view.container;
  const button = (text: string) => {
    const found = [...container.querySelectorAll('button')].find(item => item.textContent === text);
    if (!found) throw new Error(`Missing button ${text}`);
    return found;
  };
  const input = container.querySelector('input');
  if (!input) throw new Error('Missing title');
  const title = (value: string) => { act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }); };
  return { container, button, title, onApplied, onClose, onFlushed, flush };
}

describe('Note Composer review flow', () => {
  it.each(['gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email'])(
    'hides source and preview when another tab changes %s', async key => {
      writeApiTestStorage(key, 'original');
      const view = await mount();
      view.title('New');
      await act(async () => { view.button('composer.preview').click(); await Promise.resolve(); });
      expect(view.container.textContent).toContain('Original');
      act(() => { writeApiTestStorage(key, 'different'); dispatchWindowEvent(new StorageEvent('storage', { key })); });
      expect(view.container.textContent).toBe('');
      expect(view.onClose).toHaveBeenCalledOnce();
      expect(applyNoteComposition).not.toHaveBeenCalled();
    },
  );
  it('does not dispatch a preview after a context change while pending edits are saving', async () => {
    const view = await mount();
    view.title('New');
    let finish: ((saved: boolean) => void) | undefined;
    view.flush.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => { view.button('composer.preview').click(); });
    await act(async () => {
      writeApiTestStorage('gnosi_user_id', 'different');
      dispatchWindowEvent(new Event('focus'));
      finish?.(true);
      await Promise.resolve();
    });
    expect(view.container.textContent).toBe('');
    expect(previewNoteComposition).not.toHaveBeenCalled();
  });
  it('does not apply an old-scope response or seed its ETag into the new context', async () => {
    const view = await mount();
    view.title('New');
    await act(async () => { view.button('composer.preview').click(); await Promise.resolve(); });
    let finish: ((result: Awaited<ReturnType<typeof applyNoteComposition>>) => void) | undefined;
    vi.mocked(applyNoteComposition).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => { view.button('composer.apply').click(); });
    await act(async () => {
      writeApiTestStorage('gnosi_workspace_id', 'different');
      dispatchWindowEvent(new StorageEvent('storage', { key: 'gnosi_workspace_id' }));
      finish?.({ source_id: 'source', target_id: 'new', changes: preview.changes });
      await Promise.resolve();
    });
    expect(view.container.textContent).toBe('');
    expect(view.onApplied).not.toHaveBeenCalled();
    expect(fetchVaultPage).toHaveBeenCalledOnce();
  });
  it('flushes first, requires a preview, shows all changes, then applies the reviewed request', async () => {
    const view = await mount();
    expect(view.flush).toHaveBeenCalledOnce(); expect(view.onFlushed).toHaveBeenCalledOnce();
    expect(view.button('composer.apply').disabled).toBe(true);
    view.title('New');
    await act(async () => { view.button('composer.preview').click(); await Promise.resolve(); });
    expect(view.container.textContent).toContain('![[new]]');
    expect(view.container.textContent).toContain('composer.before');
    await act(async () => { view.button('composer.apply').click(); await Promise.resolve(); });
    expect(applyNoteComposition).toHaveBeenCalledWith(preview, expect.any(Object));
    expect(view.onApplied).toHaveBeenCalledOnce();
  });
  it('invalidates the preview after selection changes or a conflict', async () => {
    const view = await mount(); view.title('New');
    await act(async () => { view.button('composer.preview').click(); await Promise.resolve(); });
    view.title('Different');
    expect(view.button('composer.apply').disabled).toBe(true);
    await act(async () => { view.button('composer.preview').click(); await Promise.resolve(); });
    vi.mocked(applyNoteComposition).mockRejectedValueOnce(new GnosiApiError(new Response('{}', { status: 409 }), {}));
    await act(async () => { view.button('composer.apply').click(); await Promise.resolve(); });
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('composer.conflict');
    expect(view.button('composer.apply').disabled).toBe(true);
    expect(view.onApplied).not.toHaveBeenCalled();
  });
  it('never previews or locks the editor after a failed save', async () => {
    const view = await mount(vi.fn<() => Promise<boolean>>().mockResolvedValue(false));
    expect(fetchVaultPage).not.toHaveBeenCalled();
    expect(view.onFlushed).not.toHaveBeenCalled();
    expect(view.button('composer.preview').disabled).toBe(true);
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('composer.save_error');
  });
  it('moves selected whole Markdown lines from the source preview', async () => {
    const view = await mount(); view.title('New');
    const textarea = view.container.querySelector('textarea');
    textarea?.setSelectionRange(0, 9);
    act(() => { view.button('composer.use_selection').click(); });
    await act(async () => { view.button('composer.preview').click(); await Promise.resolve(); });
    expect(previewNoteComposition).toHaveBeenCalledWith(expect.objectContaining({ selection: 'lines', start_line: 1, end_line: 1 }), expect.any(Object));
  });
});
