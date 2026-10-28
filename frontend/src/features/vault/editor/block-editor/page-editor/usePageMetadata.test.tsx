import { act, useRef, useState } from 'react';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import { patchVaultPage } from '../../../../../shared/api/vaults';
import { usePageMetadata } from './usePageMetadata';
import type { PageMetadata, SaveStatus } from './types';

vi.mock('../../../../../shared/api/vaults', () => ({ patchVaultPage: vi.fn() }));
const patch = vi.mocked(patchVaultPage);
const cleanups: (() => void)[] = [];
const t = createInstance().t;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  patch.mockResolvedValue({ id: 'record', content: '', metadata: {}, title: 'Renamed', folder: '', message: '', status: 'ok' });
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await act(async () => { await Promise.resolve(); });
  vi.clearAllTimers(); vi.useRealTimers();
});
function mountEditor(mode: 'primary' | 'wiki' | 'without-title' = 'primary') {
  const update = vi.fn();
  function Editor() {
    const [metadata, setMetadata] = useState<PageMetadata>({ title: 'Old', Title: 'Old', ...(mode === 'wiki' ? {} : { table_id: 'table' }), local: false });
    const metadataRef = useRef(metadata);
    const [, setSaveStatus] = useState<SaveStatus>('idle');
    const controller = usePageMetadata({
      allTables: mode === 'wiki' ? [] : [{ id: 'table', properties: mode === 'primary'
        ? [{ id: 'fld_title', name: 'Title', type: 'title' }] : [{ id: 'fld_status', name: 'Status', type: 'text' }] }],
      isEditor: true, noteFilename: 'record', metaSaveInFlightRef: useRef<Promise<boolean> | null>(null),
      pendingMetaRef: useRef<PageMetadata | null>(null), pendingRemoveKeysRef: useRef<string[] | null>(null),
      setSaveStatus, t, onUpdate: update, metadataRef,
      metaSaveTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null), setMetadata,
      onUpdatePageMetadata: undefined,
    });
    return <><textarea aria-label="Record title" value={metadata.title} onChange={controller.handleTitleChange} />
      <button onClick={() => { controller.handleMetaChange('fld_title', 'Property rename'); }}>Rename property</button>
      {['icon', 'cover', 'localText'].map(key => <button key={key} data-field={key} onClick={() => { controller.handleMetaChange(key, 'Changed'); }}>{key}</button>)}</>;
  }
  const mounted = mountTestComponent(<Editor />); cleanups.push(mounted.unmount);
  const input = mounted.container.querySelector('textarea');
  if (!input) throw new Error('Missing title input');
  const rename = () => { act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!set) throw new Error('Missing native value setter');
    set.call(input, 'Renamed'); input.dispatchEvent(new Event('input', { bubbles: true }));
  }); };
  return { ...mounted, input, rename, update };
}
it('autosaves a header rename with the registered title and unrelated metadata intact', async () => {
  const editor = mountEditor(); editor.rename();
  expect(editor.update).toHaveBeenLastCalledWith('record', undefined, expect.objectContaining({ title: 'Renamed', metadata: expect.objectContaining({ title: 'Renamed', Title: 'Renamed', local: false }) }));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(patch).toHaveBeenCalledWith('record', expect.objectContaining({ title: 'Renamed', metadata: expect.objectContaining({ title: 'Renamed', Title: 'Renamed', local: false }) }));
});
it('flushes the latest header title when the record closes before the debounce ends', async () => {
  const editor = mountEditor(); editor.rename(); editor.unmount();
  await act(async () => { await Promise.resolve(); });
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith('record', expect.objectContaining({ title: 'Renamed', metadata: expect.objectContaining({ Title: 'Renamed' }) }));
});
it('keeps the canonical header title in sync when the registered property is edited by immutable ID', async () => {
  const editor = mountEditor();
  act(() => { editor.container.querySelector('button')?.click(); });
  expect(editor.input.value).toBe('Property rename');
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(patch).toHaveBeenCalledWith('record', expect.objectContaining({ title: 'Property rename', metadata: expect.objectContaining({ title: 'Property rename', Title: 'Property rename', local: false }) }));
});

it.each(['wiki', 'without-title'] as const)('preserves the header when ordinary string metadata changes in %s pages', async mode => {
  for (const key of ['icon', 'cover', 'localText']) {
    patch.mockClear();
    const editor = mountEditor(mode);
    await act(async () => { editor.container.querySelector<HTMLButtonElement>(`[data-field="${key}"]`)?.click(); await vi.advanceTimersByTimeAsync(600); });
    expect(editor.input.value).toBe('Old');
    expect(patch).toHaveBeenCalledWith('record', expect.objectContaining({ title: 'Old', metadata: expect.objectContaining({ title: 'Old', Title: 'Old', [key]: 'Changed' }) }));
    editor.unmount();
  }
});
