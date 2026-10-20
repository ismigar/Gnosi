import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PageEditorProps, PageTable } from './types';
import {
  advance, container, element, fixture, mount, patches, requests,
  root, setPatchResponse, state,
} from './pageEditor.test-harness';

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

  it('replaces a source section with one option from the same source', async () => {
    const source = { llm_wiki_resource_id: 'book', llm_wiki_source_table_id: 'sources' };
    await mountProperties({
      initialMetadata: { ...metadata, ...source, Apartat: ['opening'] },
      allTables: [{ id: 'table', properties: [{ name: 'Apartat', type: 'relation',
        config: { relation_database_id: 'sections', source_sections: true } }] }],
      allNotes: [
        { id: 'opening', title: 'Book › Opening', resolved_table_id: 'sections', metadata: { ...source, llm_wiki_section_path: 'Opening' } },
        { id: 'ending', title: 'Book › Ending', resolved_table_id: 'sections', metadata: { ...source, llm_wiki_section_path: 'Ending' } },
        { id: 'foreign', title: 'Other book › Foreign', resolved_table_id: 'sections', metadata: { ...source, llm_wiki_resource_id: 'other-book', llm_wiki_section_path: 'Foreign' } },
      ],
    });
    const picker = value('Apartat').querySelector<HTMLElement>('[role="combobox"]');
    expect(picker).not.toBeNull();
    act(() => { picker?.click(); });
    const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options.map(option => option.textContent)).toEqual(['Opening', 'Ending']);
    act(() => { options[1]?.click(); });
    expect(state().metadata.Apartat).toEqual(['ending']);
    await advance(1600);
    expect(patches().at(-1)?.body).toMatchObject({ metadata: { Apartat: ['ending'] } });
  });

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
    setPatchResponse(() => new Promise<Response>(resolve => { finish = resolve; }));
    act(() => { state().handleSaveMetadata(undefined, { immediate: true }); });
    await advance(0);
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => { first = state().handleRemoveProperty('FirstLocal'); second = state().handleRemoveProperty('SecondLocal'); });
    expect(patches()).toHaveLength(1);
    setPatchResponse(undefined);
    await act(async () => { finish?.(Response.json({ status: 'success' })); await first; await second; });
    expect(patches()).toHaveLength(3);
    expect(patches()[1]?.body).toMatchObject({ remove_metadata_keys: ['FirstLocal'] });
    expect(patches()[2]?.body).toMatchObject({ remove_metadata_keys: ['SecondLocal'] });
    expect(state().metadata).not.toHaveProperty('FirstLocal');
    expect(state().metadata).not.toHaveProperty('SecondLocal');
  });

  it('restores local values after a failed deletion and cannot delete schema fields', async () => {
    await mountProperties({ initialMetadata: { ...metadata, Subítem: ['keep'] } });
    setPatchResponse(() => Promise.resolve(Response.json({ detail: 'fixture failure' }, { status: 500 })));
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
