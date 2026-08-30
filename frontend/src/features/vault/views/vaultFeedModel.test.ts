import { describe, expect, it } from 'vitest';
import i18next from 'i18next';

import {
  feedDateGroup,
  feedMetadataValue,
  feedModifiedDate,
  feedNoteTitle,
  feedValueString,
  prepareFeedBody,
  resolveVaultFeedSettings,
  splitFeedHighlight,
  visibleFeedColumns,
} from './vaultFeedModel';
import type { VaultViewConfig, VaultViewPage } from '../../../shared/records/hooks/useVaultViewData';


describe('vaultFeedModel', () => {
  it('removes complete and truncated file embeds while preserving line breaks', () => {
    expect(prepareFeedBody('Before<br><file src="asset">after</file>'))
      .toBe('Before\nafter');
    expect(prepareFeedBody('Text <file src="truncated'))
      .toBe('Text');
  });

  it('splits accent-preserving visible matches without losing punctuation', () => {
    expect(splitFeedHighlight('Project Alpha, ready', 'alpha ready')).toEqual([
      { highlighted: false, text: 'Project ' },
      { highlighted: true, text: 'Alpha' },
      { highlighted: false, text: ', ' },
      { highlighted: true, text: 'ready' },
    ]);
  });

  it('normalizes legacy and current feed view settings', () => {
    expect(resolveVaultFeedSettings({
      excerpt_lines: '8',
      feed_focus: true,
      pill_limit: 3,
      summary_model: 'local/model',
    })).toEqual({
      excerptLines: 8,
      feedFocus: true,
      pillLimit: 3,
      summaryModel: 'local/model',
    });
  });

  it('reads open metadata without copying or serializing opaque/cyclic values', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const opaque = new Map([['key', new Date(0)]]);
    const method = () => opaque;
    const page: VaultViewPage = {
      id: 'open', extension: cycle, metadata: { cycle, opaque, method, big: 9n },
    };
    expect(feedMetadataValue(page, 'cycle')).toBe(cycle);
    expect(feedMetadataValue(page, 'opaque')).toBe(opaque);
    expect(feedMetadataValue(page, 'method')).toBe(method);
    expect(feedMetadataValue(page, 'big')).toBe(9n);
    expect(feedMetadataValue({ id: 'null', metadata: null }, 'missing')).toBeUndefined();
    expect(feedMetadataValue({ id: 'absent' }, 'missing')).toBeUndefined();
  });

  it.each([
    { title: 'Text', expected: 'Text' },
    { title: 42, expected: '42' },
    { title: 9n, expected: '9' },
    { title: true, expected: 'true' },
    { title: false, expected: '' },
    { title: 0, expected: '' },
    { title: null, expected: '' },
    { title: undefined, expected: '' },
  ])('keeps scalar title coercion and the falsy fallback: $title', ({ title, expected }) => {
    expect(feedNoteTitle({ id: 'title', title })).toBe(expected);
  });

  it('uses native String coercion, including the receiver and thrown errors', () => {
    const value = {
      text: 'Before<br>after',
      toString() { return this.text; },
    };
    expect(feedValueString(value)).toBe(value.text);
    expect(prepareFeedBody(value)).toBe('Before\nafter');
    expect(feedValueString([value, 9n])).toBe('Before<br>after,9');
    expect(feedValueString(Symbol.for('feed'))).toBe('Symbol(feed)');
    const failure = new Error('coercion failed');
    expect(() => feedValueString({ toString() { throw failure; } })).toThrow(failure);
  });

  it('preserves native numeric, null, Date and custom timestamp conversion', () => {
    const instant = new Date('2026-08-30T10:00:00Z');
    const custom = { valueOf() { return instant.getTime(); } };
    for (const value of [instant, instant.getTime(), custom, instant.toISOString()]) {
      expect(feedModifiedDate({ id: 'date', last_modified: value }).getTime())
        .toBe(instant.getTime());
    }
    expect(feedModifiedDate({ id: 'epoch', last_modified: null }).getTime()).toBe(0);
    expect(feedModifiedDate({ id: 'epoch', last_modified: 0 }).getTime()).toBe(0);
    expect(feedModifiedDate({ id: 'missing' }).getTime()).toBeNaN();
    expect(() => feedModifiedDate({ id: 'symbol', last_modified: Symbol('date') }))
      .toThrow(TypeError);
    const failure = new Error('date coercion failed');
    expect(() => feedModifiedDate({
      id: 'throw', last_modified: { valueOf() { throw failure; } },
    })).toThrow(failure);
  });

  it('groups numeric and Date timestamps identically with the real translation contract', async () => {
    const translator = i18next.createInstance();
    await translator.init({ lng: 'en', showSupportNotice: false, resources: { en: { translation: {} } } });
    const today = new Date(2026, 7, 30, 12);
    expect(feedDateGroup(today.getTime(), 'en', translator.t, today)).toBe('feed.group_today');
    expect(feedDateGroup(today, 'en', translator.t, today)).toBe('feed.group_today');
    expect(feedDateGroup(0, 'en', translator.t, today))
      .toBe(new Date(0).toLocaleDateString('en', { month: 'long', year: 'numeric' }));
  });

  it('keeps unknown view extensions intact through main-view/column readers', () => {
    const extension = new Map([['opaque', new Set(['value'])]]);
    const schema = { One: 'text', Two: 'text', Three: 'text', Four: 'text' };
    const view: VaultViewConfig = {
      id: extension, name: extension, order: extension, table_id: extension,
      extension, is_main: true,
    };
    expect(visibleFeedColumns(schema, view).map(([field]) => field))
      .toEqual(['One', 'Two', 'Three', 'Four']);
    expect(visibleFeedColumns(schema, { ...view, is_main: false }).length).toBe(3);
    expect(visibleFeedColumns(schema, { name: 'Taula Principal' }).length).toBe(4);
    expect(visibleFeedColumns(schema, { id: 'default' }).length).toBe(4);
    expect(visibleFeedColumns(schema, { locked: extension }).length).toBe(4);
    expect(visibleFeedColumns(schema, {
      ...view, columns: [{ fieldKey: 'Four', extension }, extension, 'One'],
    })).toEqual([['Four', 'text'], ['One', 'text']]);
    expect(view.extension).toBe(extension);
  });

  it('keeps the shared main-view reader short-circuiting before unused getters', () => {
    const view = {
      id: 'default',
      get name(): never { throw new Error('Unused view name must not be read'); },
    };
    expect(visibleFeedColumns({ One: 'text', Two: 'text', Three: 'text', Four: 'text' }, view).length)
      .toBe(4);
  });

  it('reads imported column properties with the native receiver, without adding a has check', () => {
    const property = new Proxy({}, {
      get: (_target, key) => key === 'fieldKey' ? 'Imported' : undefined,
      has: () => { throw new Error('This imported object does not support has'); },
    });
    expect(visibleFeedColumns({ Imported: 'text' }, { columns: [property] }))
      .toEqual([['Imported', 'text']]);
    const failure = new Error('column reader failed');
    expect(() => visibleFeedColumns({}, {
      columns: [{ get fieldKey() { throw failure; } }],
    })).toThrow(failure);
  });
});
