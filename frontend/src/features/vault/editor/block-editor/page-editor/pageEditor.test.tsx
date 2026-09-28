import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageEditorController, type PageEditorController } from './usePageEditorController';
import { PageEditorView } from './PageEditorView';
import type { PageEditorBodyProps, PageEditorProps, PageTable } from './types';
import type { PageViewModalProps } from '../../../view-config/page-view-modal/types';
import { resetApiTestStorage } from '../../../../../../tests/api-request';
import { emitAppEvent } from '../../../../../shared/platform/app-events';
import { dispatchWindowEvent } from '../../../../../shared/platform/browser-events';
import { readStorage, spellEnabledKey, writeStorage } from './preferences';

const fixture = vi.hoisted(() => ({
  role: 'owner', t: (key: string) => key, planning: {},
  notifyError: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: fixture.t }) }));
vi.mock('../../../../../shared/api/use-api', () => ({ useApi: () => ({ role: fixture.role }) }));
vi.mock('../../../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => false, getPluginSettings: () => fixture.planning }) }));
vi.mock('../../../../../shared/hooks/useTheme', () => ({ useTheme: () => ({ effectiveTheme: 'light' }) }));
vi.mock('../../../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ numberLocale: 'en-US', dateLocale: 'en-US' }) }));
vi.mock('../../../../../shared/notifications/notifyError', () => ({ notifyError: fixture.notifyError, logError: vi.fn() }));
vi.mock('../../../../../shared/notifications/toast', () => ({ toast: fixture.toast }));
vi.mock('../../CollaborationPresence', () => ({ CollaborationPresence: () => null }));
vi.mock('../../PageHistory', () => ({ default: () => null }));
vi.mock('../../../view-config/PageViewModal', () => ({ PageViewModal: (props: PageViewModalProps) => {
  useLayoutEffect(() => { pageViewClose = props.onClose; });
  return null;
} }));
vi.mock('../../IconPicker', () => ({ IconPicker: () => null }));
vi.mock('../../CoverPicker', () => ({ CoverPicker: () => null }));
vi.mock('../../../../literature/records/MetadataLookupModal', () => ({ MetadataLookupModal: () => null }));
vi.mock('../../../content/InsertContentModal', () => ({ InsertContentModal: () => null }));
vi.mock('../MarkdownCodeEditor', () => ({ MarkdownCodeEditor: () => <div data-code-editor /> }));

interface RequestLog { path: string; method: string; body: unknown }
let root: Root;
let container: HTMLDivElement;
let controller: PageEditorController | undefined;
let innerProps: PageEditorBodyProps | undefined;
let requests: RequestLog[];
let patchResponse: (() => Promise<Response>) | undefined;
let pageViewClose: PageViewModalProps['onClose'] | undefined;
const idToTitle = { outgoing: 'Outgoing page' };
const initialMetadata = { title: 'Fixture page', tags: ['one'], custom: { preserve: true } };
const allTables: PageTable[] = [];
function Inner(props: PageEditorBodyProps) {
  useLayoutEffect(() => { innerProps = props; });
  return <div data-inner-editor data-editable={props.isEditable} />;
}
function Harness(props: PageEditorProps & { view?: boolean }) {
  const value = usePageEditorController(props);
  useLayoutEffect(() => { controller = value; });
  return props.view ? <PageEditorView context={value} /> : null;
}
function state() {
  if (!controller) throw new Error('Page controller not mounted');
  return controller;
}
async function mount(props: Partial<PageEditorProps> & { view?: boolean } = {}) {
  await act(async () => {
    root.render(<MemoryRouter><Harness noteFilename="fixture" initialContent="[[outgoing]]" initialMetadata={initialMetadata} idToTitle={idToTitle} allTables={allTables} EditorInner={Inner} {...props} /></MemoryRouter>);
    await Promise.resolve();
  });
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function patches() { return requests.filter(request => request.method === 'PATCH'); }
function element<T extends Element>(selector: string, type: { new(): T }): T {
  const node = container.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`Missing ${selector}`);
  return node;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetApiTestStorage();
  fixture.role = 'owner';
  vi.clearAllMocks();
  controller = undefined;
  innerProps = undefined;
  requests = [];
  patchResponse = undefined;
  pageViewClose = undefined;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const body: unknown = text ? JSON.parse(text) : null;
    requests.push({ path, method: request.method, body });
    if (request.method === 'PATCH') return patchResponse ? patchResponse() : Response.json({ status: 'success' });
    if (path === '/api/vault/open-resource') return Response.json({ status: 'success' });
    if (path === '/api/vault/backlinks') return Response.json([
      { id: 'fixture', title: 'Self', kind: 'link' },
      { id: 'incoming', title: 'Shared title', kind: 'link' },
      { id: 'incoming', title: 'Duplicate', kind: 'link' },
      { id: 'related', title: 'Related', kind: 'relation' },
    ]);
    if (path === '/api/vault/outlinks') return Response.json({ links: [], relations: [{ id: 'related', title: 'Related' }, { id: 'second', title: 'Second' }], unresolved: [] });
    if (path === '/api/vault/unlinked-mentions') return Response.json([{ id: 'mention', title: 'Mention', count: 2, snippet: 'Fixture text' }]);
    if (path === '/api/vault/link-unlinked-mentions') return Response.json({ status: 'success', target_id: 'fixture', target_title: 'Fixture page', notes_changed: 1, total_replacements: 2, changed_notes: [{ id: 'mention', title: 'Mention', replacements: 2 }] });
    throw new Error(`Unexpected fixture request ${path}`);
  }));
});
afterEach(async () => {
  await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove();
  vi.useRealTimers();
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

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
    patchResponse = () => new Promise(resolve => { resolveFirst = resolve; });
    await mount();
    act(() => { state().handleSaveMetadata({ title: 'First' }, { immediate: true }); });
    await advance(0);
    act(() => { state().handleSaveMetadata({ title: 'Skipped' }, { immediate: true }); state().handleSaveMetadata({ title: 'Last' }, { immediate: true }); });
    expect(patches()).toHaveLength(1);
    patchResponse = undefined;
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
    patchResponse = () => Promise.resolve(Response.json({ detail: 'fixture failure' }, { status: 500 }));
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

// These integration cases mount the complete editor and all 24 property types.
describe('typed page properties', { timeout: 20_000 }, () => {
  const properties = [
    { id: 'fld_title', name: 'Name', type: 'title' },
    { name: 'Text', type: 'text' }, { name: 'Long text', type: 'rich_text' },
    { id: 'fld_score', name: 'Score', type: 'number' },
    { id: 'fld_system', name: 'Sistema', type: 'checkbox' },
    { name: 'Select', type: 'select', options: [{ name: 'Blue', color: 'blue' }] },
    { name: 'Tags', type: 'multi_select', options: ['One', 'Two'] },
    { name: 'Status', type: 'status', options: ['Done'] },
    { name: 'Related', type: 'relation', config: { relation_database_id: 'target' } },
    { name: 'Authors', type: 'autoria' }, { name: 'Date', type: 'date' },
    { name: 'Date time', type: 'datetime' }, { name: 'Period', type: 'period' },
    { name: 'URL', type: 'url' }, { name: 'Zotero', type: 'zotero' },
    { name: 'Files', type: 'files' }, { name: 'Picture', type: 'image' },
    { name: 'Formula', type: 'formula', config: { formula: '{Score} + 2' } },
    { name: 'Rollup', type: 'rollup', relationField: 'Related', targetProperty: 'Score', aggregation: 'sum' },
    { name: 'Derived', type: 'virtual' },
    { name: 'Created', type: 'created_time' }, { name: 'Edited', type: 'last_edited_time' },
    { name: 'Creator', type: 'created_by' }, { name: 'Editor', type: 'last_edited_by' },
  ];
  const metadata = {
    title: 'Property fixture', table_id: 'table', Text: 'Plain text', 'Long text': 'First line\nSecond line',
    Score: 0, Sistema: true, Select: 'Blue', Tags: ['One', 'Two'], Status: 'Done', Related: ['related'],
    Authors: [{ nom: 'Ada', cognom1: 'Lovelace' }], Date: '2026-09-28', 'Date time': '2026-09-28T10:30',
    Period: { start: '2026-09-28', end: '2026-09-30' }, URL: 'https://example.org',
    Zotero: '[Source](zotero://select/library/items/ABCD1234)', Files: 'Assets/test.pdf',
    Picture: 'https://example.org/cover.png', Derived: false,
    Created: '2026-09-01T10:30:00Z', Edited: '2026-09-28T10:30:00Z',
    created_by: { name: 'Creator name' }, last_edited_by: 'Editor name',
  };
  const table: PageTable = { id: 'table', properties };
  async function mountProperties(props: Partial<PageEditorProps> = {}) {
    await mount({ view: true, initialMetadata: metadata, allTables: [table, { id: 'target', properties: [{ id: 'fld_target_score', name: 'Score', type: 'number' }] }],
      allNotes: [{ id: 'related', title: 'Related page', resolved_table_id: 'target', metadata: { fld_target_score: 8 } }], ...props });
    act(() => { state().setIsPropertiesOpen(true); });
  }
  function value(name: string) { return element(`[data-prop-value="${name}"]`, HTMLDivElement); }

  it('uses configured field order for rows, keyboard navigation and preview after a schema reorder', async () => {
    const configured = (names: string[]) => names.map(name => {
      const field = properties.find(property => property.name === name);
      if (!field) throw new Error(`Missing schema field: ${name}`);
      return field;
    });
    const fields = configured(['Name', 'Sistema', 'Score', 'Text']);
    const props = { initialMetadata: { ...metadata, Name: 'Property fixture', Subítem: [] }, allTables: [{ ...table, properties: fields }] };
    await mountProperties(props);
    const expectOrder = (names: string[]) => {
      expect(Array.from(container.querySelectorAll('[data-prop-value]')).map(node => node.getAttribute('data-prop-value'))).toEqual(names);
      expect(state().navProps.slice(0, names.length).map(prop => prop.name)).toEqual(names);
      expect(state().compactPropertyPreviewItems.slice(0, names.length).map(prop => prop.name)).toEqual(names);
      expect(state().adhocProperties).not.toContain('Name');
      expect(state().adhocProperties).toContain('Subítem');
    };
    expectOrder(['Sistema', 'Score', 'Text']);
    await mountProperties({ ...props, allTables: [{ ...table, properties: configured(['Name', 'Score', 'Text', 'Sistema']) }] });
    expectOrder(['Score', 'Text', 'Sistema']);
    expect(patches()).toEqual([]);
  });

  it('lists local fields in Manage Fields, persists a deletion and keeps the table configuration accessible', async () => {
    const onEditSchema = vi.fn();
    await mountProperties({ onEditSchema, initialMetadata: { ...metadata, Name: 'Property fixture', Subítem: [], 'Local value': 'Keep me' } });
    const manage = Array.from(container.querySelectorAll('button')).find(button => button.textContent.trim() === 'editor.manage_fields');
    if (!manage) throw new Error('Missing field management');
    act(() => { state().setActiveProp('Sistema'); });
    await advance(20);
    act(() => { manage.focus(); manage.click(); });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('editor.page_only_fields_description');
    expect(dialog?.querySelector('[data-local-property="Name"]')).toBeNull();
    act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(state().activeProp).toBe('Sistema');
    expect(dialog?.querySelector('[data-local-property="Local value"]')?.textContent).toContain('Keep me');
    await act(async () => { dialog?.querySelector<HTMLButtonElement>('[data-local-property="Subítem"] button')?.click(); await Promise.resolve(); });
    await advance(0);
    expect(state().metadata).not.toHaveProperty('Subítem');
    expect(state().metadata['Local value']).toBe('Keep me');
    expect(state().metadata.Name).toBe('Property fixture');
    expect(patches().at(-1)?.body).toMatchObject({ remove_metadata_keys: ['Subítem'], metadata: { Sistema: true, Score: 0 } });
    expect(dialog?.querySelector('[data-local-property="Subítem"]')).toBeNull();
    const configure = Array.from(dialog?.querySelectorAll('button') || []).find(button => button.textContent === 'editor.configure_table_fields');
    act(() => { configure?.click(); });
    expect(onEditSchema).toHaveBeenCalledWith(table);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('serializes local deletions during a save without losing either removal', async () => {
    await mountProperties({ initialMetadata: { ...metadata, FirstLocal: 1, SecondLocal: 2 } });
    let finish: ((response: Response) => void) | undefined;
    patchResponse = () => new Promise<Response>(resolve => { finish = resolve; });
    act(() => { state().handleSaveMetadata(undefined, { immediate: true }); });
    await advance(0);
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => { first = state().handleRemoveProperty('FirstLocal'); second = state().handleRemoveProperty('SecondLocal'); });
    expect(patches()).toHaveLength(1);
    patchResponse = undefined;
    await act(async () => { finish?.(Response.json({ status: 'success' })); await first; await second; });
    expect(patches()).toHaveLength(3);
    expect(patches()[1]?.body).toMatchObject({ remove_metadata_keys: ['FirstLocal'] });
    expect(patches()[2]?.body).toMatchObject({ remove_metadata_keys: ['SecondLocal'] });
    expect(state().metadata).not.toHaveProperty('FirstLocal');
    expect(state().metadata).not.toHaveProperty('SecondLocal');
  });

  it('restores local values after a failed deletion and cannot delete schema fields', async () => {
    await mountProperties({ initialMetadata: { ...metadata, Subítem: ['keep'] } });
    patchResponse = () => Promise.resolve(Response.json({ detail: 'fixture failure' }, { status: 500 }));
    await act(async () => { expect(await state().handleRemoveProperty('Subítem')).toBe(false); });
    expect(state().metadata.Subítem).toEqual(['keep']);
    expect(fixture.notifyError).toHaveBeenCalledOnce();
    await act(async () => { expect(await state().handleRemoveProperty('Sistema')).toBe(false); });
    expect(patches()).toHaveLength(1);
    expect(state().metadata.Sistema).toBe(true);
  });

  it('keeps successive field changes in the same event before deleting a local field', async () => {
    await mountProperties({ initialMetadata: { ...metadata, Subítem: [] } });
    act(() => { state().handleMetaChange('Score', 3); state().handleMetaChange('Text', 'Changed'); });
    await act(async () => { expect(await state().handleRemoveProperty('Subítem')).toBe(true); });
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.body).toMatchObject({ metadata: { Score: 3, Text: 'Changed' }, remove_metadata_keys: ['Subítem'] });
    await advance(600);
    expect(patches()).toHaveLength(1);
  });

  it.each([true, false, 'true', 'false', 1, 0, null])('renders and saves checkbox %s as a boolean, including keyboard changes and reopen', async initial => {
    await mountProperties({ initialMetadata: { ...metadata, Sistema: initial } });
    const checked = initial === true || initial === 'true' || initial === 1;
    const toggle = value('Sistema').querySelector<HTMLElement>('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe(String(checked));
    expect(value('Sistema').querySelector('input')).toBeNull();
    expect(value('Score').querySelector('input')?.value).toBe('0');
    act(() => { toggle?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    await advance(600);
    expect(state().metadata.Sistema).toBe(!checked);
    expect(patches().at(-1)?.body).toMatchObject({ metadata: { Sistema: !checked, Score: 0 } });
    const saved = state().metadata;
    await act(async () => { root.render(null); await Promise.resolve(); });
    await mountProperties({ initialMetadata: saved });
    expect(value('Sistema').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe(String(!checked));
  });

  it('uses stable IDs without duplicate local fields and saves current names without stale IDs', async () => {
    await mountProperties({ initialMetadata: { ...metadata, Sistema: false, fld_system: true, fld_score: 0 } });
    expect(state().adhocProperties).not.toContain('fld_system');
    expect(state().adhocProperties).not.toContain('fld_score');
    expect(value('Sistema').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    act(() => { value('Sistema').querySelector<HTMLElement>('[role="switch"]')?.click(); });
    await advance(600);
    expect(state().metadata.Sistema).toBe(false);
    expect(state().metadata.fld_system).toBeUndefined();
    expect(state().metadata.fld_score).toBeUndefined();
    expect(patches().at(-1)?.body).toMatchObject({ metadata: { Sistema: false, Score: 0 } });
  });

  it('renders all schema types with their own controls, values and icons', async () => {
    await mountProperties();
    expect(container.querySelectorAll('[data-prop-value]')).toHaveLength(properties.length - 1);
    expect(value('Text').querySelector('input')?.value).toBe('Plain text');
    expect(value('Long text').querySelector('textarea')?.value).toBe('First line\nSecond line');
    for (const name of ['Select', 'Tags', 'Status', 'Related']) expect(value(name).querySelector('[role="combobox"]')).not.toBeNull();
    expect(value('Related').textContent).toContain('Related page');
    expect(Array.from(value('Authors').querySelectorAll('input')).map(input => input.value)).toContain('Ada');
    expect(value('Date').querySelector('input[type="date"]')?.getAttribute('value')).toBe('2026-09-28');
    expect(value('Date time').querySelector('input[type="datetime-local"]')).not.toBeNull();
    expect(value('Period').querySelector('input')).not.toBeNull();
    expect(value('URL').querySelector('a')?.href).toBe('https://example.org/');
    expect(value('Zotero').textContent).toContain('table.open_zotero');
    expect(value('Files').textContent).toContain('test.pdf');
    expect(value('Picture').querySelector('img')?.src).toBe('https://example.org/cover.png');
    expect(value('Formula').textContent).toBe('2');
    expect(value('Rollup').textContent).toBe('8');
    expect(value('Derived').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(value('Creator').textContent).toBe('Creator name');
    expect(value('Editor').textContent).toBe('Editor name');
    for (const name of ['Formula', 'Rollup', 'Derived', 'Created', 'Edited', 'Creator', 'Editor']) {
      expect(value(name).querySelector('input,textarea')).toBeNull();
      expect(value(name).textContent === '' ? value(name).querySelector('[role="switch"]') : value(name).textContent).toBeTruthy();
    }
    for (const prop of properties.filter(prop => !['text', 'title'].includes(prop.type))) {
      const icon = container.querySelector(`[data-prop-row="${prop.name}"] svg`);
      expect(icon).not.toBeNull();
      expect(icon?.classList.contains('lucide-type')).toBe(false);
    }
    expect(patches()).toEqual([]);
  });

  it.each(['locked', 'viewer'])('protects all controls in %s pages, including empty dates and periods', async mode => {
    if (mode === 'viewer') fixture.role = 'viewer';
    await mountProperties({ isEditLocked: mode === 'locked', initialMetadata: { ...metadata, Date: '', 'Date time': '' } });
    for (const node of container.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('[data-prop-value] input,[data-prop-value] textarea')) expect(node.disabled).toBe(true);
    for (const name of ['Date', 'Date time', 'Period']) expect(value(name).querySelector('input,button')).toBeNull();
    expect(value('Period').textContent).toContain('→');
    for (const name of ['Select', 'Tags', 'Status']) {
      const selector = value(name).querySelector<HTMLElement>('[role="combobox"]');
      expect(selector?.getAttribute('aria-disabled')).toBe('true');
      act(() => { selector?.click(); });
      expect(selector?.getAttribute('aria-expanded')).toBe('false');
    }
    expect(value('Related').querySelector('[role="combobox"]')).toBeNull();
    expect(value('Related').querySelector('button')?.closest('[aria-disabled="true"]')).toBeNull();
    expect(value('Related').querySelectorAll('button')).toHaveLength(1);
    act(() => { value('Sistema').querySelector<HTMLElement>('[role="switch"]')?.click(); state().handleMetaChange('Date', '2027-01-01'); });
    await advance(700);
    expect(state().metadata.Sistema).toBe(true);
    expect(state().metadata.Date).toBe('');
    expect(patches()).toEqual([]);
  });

  it('preserves numeric save types, recalculates formulas and protects read-only fields from paste', async () => {
    await mountProperties();
    const input = value('Score').querySelector('input');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '12.5');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(state().metadata.Score).toBe(12.5);
    expect(value('Formula').textContent).toBe('14.5');
    await advance(600);
    expect(patches().at(-1)?.body).toMatchObject({ metadata: { Score: 12.5 } });
    const before = patches().length;
    state().propClipboardRef.current = { value: 'overwrite', type: 'text' };
    for (const name of ['Formula', 'Rollup', 'Derived', 'Created', 'Edited', 'Creator', 'Editor']) {
      await act(async () => { await state().pastePropValue(name); state().handleMetaChange(name, 'overwrite'); });
    }
    await advance(700);
    expect(patches()).toHaveLength(before);
  });

  it('opens a Zotero resource with the same parsed target as a table', async () => {
    await mountProperties({ isEditLocked: true });
    await act(async () => { value('Zotero').querySelector('button')?.click(); await Promise.resolve(); });
    expect(requests.find(request => request.path === '/api/vault/open-resource')?.body).toEqual({ zotero_uri: 'zotero://select/library/items/ABCD1234', file_path: null, attachments: null });
    expect(patches()).toEqual([]);
  });
});
