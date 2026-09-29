import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PageTable } from './types';
import { emitAppEvent } from '../../../../../shared/platform/app-events';
import { dispatchWindowEvent } from '../../../../../shared/platform/browser-events';
import { readStorage, spellEnabledKey, writeStorage } from './preferences';
import {
  advance, container, element, fixture, initialMetadata, innerProps,
  mount, pageViewClose, patches, requests, root, setPatchResponse, state,
} from './pageEditor.test-harness';

describe('outer page editor metadata persistence', () => {
  it('does not write on mount and debounces the latest metadata for 600 ms', async () => {
    await mount();
    await advance(1200);
    expect(patches()).toEqual([]);
    act(() => { state().handleMetaChange('title', 'First'); });
    await advance(300);
    act(() => { state().handleMetaChange('title', 'Latest'); });
    await advance(599);
    expect(patches()).toEqual([]);
    await advance(1);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.body).toEqual({ force: false, title: 'Latest', metadata: { ...initialMetadata, title: 'Latest' } });
  });
  it('keeps one request in flight and flushes only the latest queued snapshot', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    setPatchResponse(() => new Promise(resolve => { resolveFirst = resolve; }));
    await mount();
    act(() => { state().handleSaveMetadata({ title: 'First' }, { immediate: true }); });
    await advance(0);
    act(() => { state().handleSaveMetadata({ title: 'Skipped' }, { immediate: true }); state().handleSaveMetadata({ title: 'Last' }, { immediate: true }); });
    expect(patches()).toHaveLength(1);
    setPatchResponse(undefined);
    await act(async () => { resolveFirst?.(Response.json({ status: 'success' })); await Promise.resolve(); });
    expect(patches()).toHaveLength(2);
    expect(patches()[1]?.body).toEqual({ force: false, title: 'Last', metadata: { title: 'Last' } });
  });
  it('flushes the latest draft when the editor unmounts', async () => {
    await mount();
    act(() => { state().handleMetaChange('title', 'Leaving'); });
    await act(async () => { root.render(null); await Promise.resolve(); });
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.body).toMatchObject({ title: 'Leaving' });
    await advance(600);
    expect(patches()).toHaveLength(1);
  });
  it('immediately saves icon and cover changes and emits optimistic metadata updates', async () => {
    const update = vi.fn();
    await mount({ onUpdatePageMetadata: update });
    act(() => { state().handleMetaChange('icon', 'lucide:Brain:blue'); });
    await advance(0);
    expect(update).toHaveBeenCalledWith('fixture', { icon: 'lucide:Brain:blue' });
    expect(patches()).toHaveLength(1);
  });
  it('includes explicit remove_metadata_keys when deleting local properties', async () => {
    await mount();
    await act(async () => { await state().handleRemoveProperty('custom'); });
    await advance(0);
    expect(patches()[0]?.body).toEqual({ force: false, title: 'Fixture page', metadata: { title: 'Fixture page', tags: ['one'] }, remove_metadata_keys: ['custom'] });
  });
  it('rolls back a failed relation removal and reports the save failure', async () => {
    await mount({ initialMetadata: { title: 'Fixture', related: ['first', 'second'] } });
    setPatchResponse(() => Promise.resolve(Response.json({ detail: 'fixture failure' }, { status: 500 })));
    let saved = true;
    await act(async () => { saved = await state().handleRelationRemove('related', 'first'); });
    expect(saved).toBe(false);
    expect(state().metadata.related).toEqual(['first', 'second']);
    expect(state().saveStatus).toBe('error');
    expect(fixture.notifyError).toHaveBeenCalledOnce();
  });
  it('applies relation events only to the matching page without a redundant PATCH', async () => {
    await mount();
    act(() => { emitAppEvent('gnosi:relation-value-applied', { pageId: 'other', metadataKey: 'related', value: ['ignored'] }); });
    expect(state().metadata.related).toBeUndefined();
    act(() => { emitAppEvent('gnosi:relation-value-applied', { pageId: 'fixture', metadataKey: 'related', value: 'one, two' }); });
    expect(state().metadata.related).toEqual(['one', 'two']);
    expect(patches()).toEqual([]);
  });
});

describe('page shell, navigation and knowledge contracts', () => {
  it('keeps schema management visible and safely handles an optional callback', async () => {
    const table: PageTable = { id: 'table', name: 'Fixture table', properties: [] };
    const props = { view: true, allTables: [table], initialMetadata: { title: 'Fixture', table_id: table.id } };
    await mount(props);
    act(() => { state().setIsPropertiesOpen(true); });
    const button = Array.from(container.querySelectorAll('button')).find(node => node.textContent && node.textContent.includes('editor.manage_fields'));
    if (!button) throw new Error('Missing schema management button');
    act(() => { button.click(); });
    const onEditSchema = vi.fn();
    await mount({ ...props, onEditSchema });
    act(() => { button.click(); });
    expect(onEditSchema).toHaveBeenCalledOnce();
    expect(onEditSchema).toHaveBeenCalledWith(table);
    expect(onEditSchema.mock.calls[0]?.[0]).toBe(table);
    expect(patches()).toEqual([]);
  });
  it('renders the original shell and passes the typed body bridge', async () => {
    await mount({ view: true });
    expect(container.querySelector('.vault-page-hero')).not.toBeNull();
    expect(element('.vault-page-title', HTMLTextAreaElement).value).toBe('Fixture page');
    expect(container.querySelector('.vault-page-summary-grid')).not.toBeNull();
    expect(container.querySelector('[data-inner-editor]')).not.toBeNull();
    expect(innerProps?.metadata).toEqual(initialMetadata);
    expect(innerProps?.isEditable).toBe(true);
    expect(patches()).toEqual([]);
  });
  it('keeps code mode separate and respects the locked body bridge', async () => {
    await mount({ view: true, isEditLocked: true });
    expect(innerProps?.isEditable).toBe(false);
    await mount({ view: true, isCodeView: true });
    expect(container.querySelector('[data-code-editor]')).not.toBeNull();
    expect(container.querySelector('[data-inner-editor]')).toBeNull();
  });
  it('stores a per-page language and restores automatic detection without losing metadata', async () => {
    await mount({ view: true });
    const select = element('select[aria-label="editor.spellcheck_language"]', HTMLSelectElement);
    expect(select.value).toBe('auto');
    act(() => { select.value = 'es'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(innerProps?.forcedSpellLang).toBe('es');
    expect(state().metadata).toEqual({ ...initialMetadata, spell_language: 'es' });
    act(() => { select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(innerProps?.forcedSpellLang).toBeUndefined();
    expect(state().metadata.custom).toEqual(initialMetadata.custom);
  });
  it('persists spelling preference under its exact key and shares language state', async () => {
    expect(spellEnabledKey.name).toBe('gnosi_spell_enabled');
    expect(writeStorage(spellEnabledKey, '0')).toBe(true);
    await mount({ view: true });
    expect(innerProps?.spellEnabled).toBe(false);
    act(() => { state().setSpellEnabled(true); state().setSpellLang('es'); });
    expect(readStorage(spellEnabledKey)).toBe('1');
    expect(innerProps?.spellLang).toBe('es');
  });
  it('gives the compact spelling control a descriptive accessible name and readable inactive color', async () => {
    expect(writeStorage(spellEnabledKey, '0')).toBe(true);
    await mount({ view: true });
    const spellButton = container.querySelector<HTMLButtonElement>('.vault-page-spell-action');
    expect(spellButton?.getAttribute('aria-label')).toBe('editor.spellcheck_disabled');
    expect(spellButton?.className).toContain('text-[var(--text-secondary)]');
  });
  it('hides knowledge panels and skips their requests on dashboard pages', async () => {
    await mount({ view: true, initialMetadata: { title: 'Dashboard', is_dashboard: true } });
    expect(container.querySelector('.vault-page-summary-grid')).toBeNull();
    expect(requests).toEqual([]);
  });
  it('separates and deduplicates wiki backlinks and both directions of schema relations', async () => {
    await mount();
    expect(state().incomingLinks).toEqual([{ id: 'incoming', title: 'Shared title' }]);
    expect(state().relatedPages).toEqual([{ id: 'related', title: 'Related' }, { id: 'second', title: 'Second' }]);
    expect(state().unlinkedMentions).toHaveLength(1);
    expect(state().outgoingLinks).toEqual([{ id: 'outgoing', title: 'Outgoing page', resolved: true }]);
  });
  it('preserves mention-linking payloads and refreshes after the action', async () => {
    const refresh = vi.fn();
    await mount({ onRefreshNotes: refresh });
    await act(async () => { await state().handleLinkMentions('mention'); });
    expect(requests.find(request => request.method === 'POST')?.body).toEqual({ target_id: 'fixture', source_id: 'mention' });
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('keeps hidden metadata out of local properties and honors empty nested option catalogs', async () => {
    const property = { id: 'status', name: 'Status', type: 'select', options: ['old'], config: { options: [] } };
    await mount({ initialMetadata: { title: 'Fixture', table_id: 'table', local: 'value', created_by: 'fixture', llm_wiki_index: 'hidden', 'Zotero Extras': { keep: true } }, allTables: [{ id: 'table', properties: [property] }] });
    expect(state().adhocProperties).toEqual(['local']);
    expect(state().getPropOptions(property)).toEqual([]);
    expect(state().zoteroExtras).toEqual({ keep: true });
  });
  it('loads shared catalog options for status properties', async () => {
    const property = { id: 'status', name: 'Estat', type: 'status', config: { catalog_ref: 'status' } };
    await mount({ initialMetadata: { title: 'Fixture', table_id: 'table' }, allTables: [{ id: 'table', properties: [property] }] });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(requests.some(request => request.path === '/api/vault/option-catalogs')).toBe(true);
    expect(state().getPropOptions(property)).toEqual([
      { name: 'Esborrany', color: 'gray' },
      { name: 'Publicat', color: 'green' },
    ]);
  });
  it('preserves history and focus-mode signals', async () => {
    await mount({ view: true, historyOpenSignal: 1 });
    expect(state().isHistoryOpen).toBe(true);
    act(() => { dispatchWindowEvent(new Event('gnosi:toggle-focus-mode')); });
    expect(container.querySelector('.vault-page-editor--focus')).not.toBeNull();
  });
  it('applies saved view sections to the original block and increments the refresh nonce', async () => {
    const refresh = vi.fn();
    const apply = vi.fn();
    await mount({ view: true, onRefreshNotes: refresh });
    const block = { id: 'block', props: { view_id: 'view', heading_level: '2' } };
    act(() => { state().applyViewSectionRef.current = apply; state().openPageViewModalFromContext('table', block); });
    expect(state().modalEditingBlock?.props?.heading_level).toBe(2);
    expect(state().pageViewEditingBlock).toBe(block);
    const saved = { view_id: 'view', heading: 'Saved' };
    act(() => { pageViewClose?.(true, saved); });
    expect(apply).toHaveBeenCalledWith(saved, block);
    expect(state().viewSectionNonce).toBe(1);
    expect(state().pageViewEditingBlock).toBeNull();
    expect(state().pageViewPreselectedTable).toBe('');
    expect(state().isPageViewModalOpen).toBe(false);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('keeps compact previews open until their original 120 ms close delay', async () => {
    await mount();
    act(() => { state().openCompactPanelPreview('properties'); state().scheduleCompactPanelPreviewClose(); });
    await advance(119);
    expect(state().compactPanelPreview).toBe('properties');
    await advance(1);
    expect(state().compactPanelPreview).toBeNull();
  });
  it('reports only matching external-file conflicts without saving or reloading', async () => {
    await mount();
    act(() => { emitAppEvent('pageEtagConflict', { pageId: 'other', message: 'Other', originalRequest: new Request('https://fixture.invalid') }); });
    expect(fixture.toast.error).not.toHaveBeenCalled();
    act(() => { emitAppEvent('pageEtagConflict', { pageId: 'fixture', message: 'Changed', originalRequest: new Request('https://fixture.invalid') }); });
    expect(fixture.toast.error).toHaveBeenCalledWith('Changed', { duration: 8000, id: 'etag-conflict-fixture' });
    expect(patches()).toEqual([]);
  });
  it('selects properties and moves focus between title and body through the bridge', async () => {
    await mount({ view: true });
    const focus = vi.fn();
    act(() => { state().registerEditorApi({ focusFirstBlock: focus }); state().openPropertiesNav(); });
    await advance(20);
    expect(state().activeProp).not.toBeNull();
    expect(document.activeElement?.getAttribute('data-prop-row')).toBe(state().activeProp);
    act(() => { state().focusBody(); });
    expect(focus).toHaveBeenCalledOnce();
    act(() => { state().focusTitle(); });
    expect(document.activeElement).toBe(element('.vault-page-title', HTMLTextAreaElement));
  });
  it('notifies title changes immediately and saves them after the debounce', async () => {
    const update = vi.fn();
    await mount({ view: true, onUpdate: update });
    const input = element('.vault-page-title', HTMLTextAreaElement);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, 'Renamed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(update).toHaveBeenCalledWith('fixture', undefined, { title: 'Renamed', metadata: { ...initialMetadata, title: 'Renamed' } });
    expect(patches()).toEqual([]);
    await advance(600);
    expect(patches()).toHaveLength(1);
  });
});

