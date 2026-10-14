import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposerResult } from '../../../../../shared/api/vault-composer';
import { clearPageEtag, getCachedPageEtag } from '../../../../../shared/api/page-etag';
import { patchVaultPage } from '../../../../../shared/api/vault-page-mutations';
import { innerProps, mount, state } from './pageEditor.test-harness';

const result: ComposerResult = {
  source_id: 'fixture', target_id: 'target', changes: [{
    id: 'fixture', title: 'Fixture', before: 'Original', after: '![[target]]', etag: 'composed', created: false,
  }],
};

afterEach(() => { clearPageEtag('fixture'); });

describe('composed page content and external updates', () => {
  it('shows a saved edit immediately and then accepts a later parent revision', async () => {
    const onUpdate = vi.fn();
    const props = { view: true, initialContent: 'Original', onUpdate };
    await mount(props);
    act(() => { state().onUpdate('fixture', 'Saved local edit'); });
    expect(innerProps?.initialContent).toBe('Saved local edit');
    expect(onUpdate).toHaveBeenCalledWith('fixture', 'Saved local edit', undefined);
    await mount({ ...props, initialContent: 'New server revision' });
    expect(innerProps?.initialContent).toBe('New server revision');
    await mount(props);
    expect(innerProps?.initialContent).toBe('Original');
  });

  it('uses the composition result for remounting and follows subsequent external changes', async () => {
    const onUpdate = vi.fn();
    const onRefreshNotes = vi.fn();
    const props = { view: true, initialContent: 'Original', onUpdate, onRefreshNotes };
    await mount(props);
    act(() => { state().lockComposer(); state().finishComposition(result); });
    expect(innerProps?.initialContent).toBe('![[target]]');
    expect(innerProps?.isEditable).toBe(true);
    expect(state().composerRevision).toBe(1);
    expect(getCachedPageEtag('fixture')).toBe('composed');
    expect(onUpdate).toHaveBeenCalledWith('fixture', '![[target]]');
    expect(onRefreshNotes).toHaveBeenCalledOnce();
    await mount({ ...props, initialContent: '![[target]]\n\nNew paragraph' });
    expect(innerProps?.initialContent).toBe('![[target]]\n\nNew paragraph');
    await mount(props);
    expect(innerProps?.initialContent).toBe('Original');
  });

  it('protects the composed body with its own version when another writer edits afterward', async () => {
    await mount({ view: true, initialContent: 'Original' });
    let serverContent = '![[target]]\n\nConcurrent paragraph';
    const serverEtag = 'concurrent-version';
    const fetchMock = vi.fn<typeof fetch>(async input => {
      const request = input instanceof Request ? input : new Request(input);
      const payload = await request.json() as { expected_etag?: string; content: string };
      if (payload.expected_etag !== serverEtag) {
        return Response.json({ detail: { error: 'etag_mismatch', current_etag: serverEtag } }, { status: 409 });
      }
      serverContent = payload.content;
      return Response.json({ id: 'fixture', status: 'success', etag: 'saved' });
    });
    vi.stubGlobal('fetch', fetchMock);
    act(() => { state().finishComposition(result); });
    expect(innerProps?.initialContent).toBe('![[target]]');
    await expect(patchVaultPage('fixture', { content: '![[target]]\n\nLocal paragraph' }))
      .rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(serverContent).toContain('Concurrent paragraph');
  });

  it('does not carry an edited body into a different note with the same initial content', async () => {
    await mount({ view: true, initialContent: 'Original' });
    act(() => { state().onUpdate('fixture', 'Saved local edit'); });
    await mount({ view: true, noteFilename: 'another', initialContent: 'Original' });
    expect(innerProps?.noteFilename).toBe('another');
    expect(innerProps?.initialContent).toBe('Original');
  });

  it('preserves a completed composition across unrelated metadata updates', async () => {
    const props = { view: true, initialContent: 'Original' };
    await mount(props);
    act(() => { state().finishComposition(result); });
    await mount({ ...props, initialMetadata: { title: 'Renamed' } });
    expect(innerProps?.initialContent).toBe('![[target]]');
  });
});
