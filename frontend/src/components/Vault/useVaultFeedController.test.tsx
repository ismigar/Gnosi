import { act, useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultViewPage } from '../../hooks/useVaultViewData';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import { mountTestComponent } from '../../test/mount-react';
import { useVaultFeedController, type VaultFeedController } from './useVaultFeedController';
import type { VaultFeedProps, VaultFeedUpdate } from './vaultFeedTypes';

const fixture = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  locale: { currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en', decimalSymbol: '.', numberLocale: 'en' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fixture.t, i18n: { language: 'en' } }) }));
vi.mock('../../hooks/useLocaleSettings', () => ({ useLocaleSettings: () => fixture.locale }));
vi.mock('./useTitlePreview', () => ({ useTitlePreview: () => ({ getTitleProps: () => ({}), preview: null }) }));
vi.mock('../../shared/api/vault-summary', () => ({ fetchVaultSummarySettings: vi.fn(), summarizeVaultRecord: vi.fn(), updateVaultSummarySettings: vi.fn() }));
vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mountController(extra: VaultFeedProps = {}) {
  let current: VaultFeedController | undefined;
  const props: VaultFeedProps = {
    activeView: { id: 'feed-contract', summaryModel: 'fixture/model' },
    notes: [{ id: 'a', title: 'Alpha', metadata: {} }],
    schema: { Tags: 'multi_select', Status: 'status' },
    ...extra,
  };
  function Probe({ input }: { readonly input: VaultFeedProps }) {
    const model = useVaultFeedController(input);
    useLayoutEffect(() => { current = model; });
    return null;
  }
  const mounted = mountTestComponent(<Probe input={props} />);
  return {
    ...mounted,
    model: () => { if (!current) throw new Error('Feed controller missing'); return current; },
    rerender: (input: VaultFeedProps) => { mounted.render(<Probe input={{ ...props, ...input }} />); },
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Feed open input controller', () => {
  it('preserves row, metadata, timestamps and view extensions through filtering/sorting', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const instant = new Date('2026-08-30T10:00:00Z');
    const first: VaultViewPage = {
      id: 'a', title: 42, last_modified: instant, created_time: instant,
      extension: cycle, metadata: { Rank: 2, Status: 'Open', opaque: new Map() },
    };
    const second: VaultViewPage = { id: 'b', title: 42n, metadata: { Rank: 1, Status: 'Open' } };
    const excluded: VaultViewPage = { id: 'c', title: 42, metadata: null };
    const view = {
      id: 'feed-contract', summaryModel: 'fixture/model', extension: cycle,
      filters: [{ field: 'Status', operator: 'equals', value: 'Open' }],
      sorts: [{ field: 'Rank', direction: 'asc' }],
    };
    const feed = mountController({ notes: [first, second, excluded], activeView: view, searchTerm: '42' });
    expect(feed.model().sortedNotes).toEqual([second, first]);
    expect(feed.model().sortedNotes[0]).toBe(second);
    expect(feed.model().sortedNotes[1]).toBe(first);
    expect(feed.model().sortedNotes[1]?.metadata).toBe(first.metadata);
    expect(feed.model().sortedNotes[1]?.last_modified).toBe(instant);
    expect(feed.model().activeView).toBe(view);
    feed.rerender({ searchTerm: 'no-match' });
    expect(feed.model().sortedNotes).toEqual([]);
    expect(first.extension).toBe(cycle);
  });

  it('delegates cyclic metadata search to the shared reader without dropping the original data', () => {
    const cycle: Record<string, unknown> = { text: 'query' };
    cycle.self = cycle;
    const note = { id: 'a', metadata: { cycle } };
    const feed = mountController({ notes: [note] });
    expect(feed.model().sortedNotes[0]).toBe(note);
    expect(feed.model().sortedNotes[0]?.metadata?.cycle).toBe(cycle);
    feed.rerender({ searchTerm: 'query' });
    expect(feed.model().sortedNotes[0]).toBe(note);
    expect(feed.model().sortedNotes[0]?.metadata?.cycle).toBe(cycle);
    feed.rerender({ searchTerm: 'missing' });
    expect(feed.model().sortedNotes).toEqual([]);
  });

  it('resolves system timestamps without normalizing unrelated metadata', () => {
    const instant = new Date('2026-08-30T10:00:00Z');
    const metadata = { Modified: instant, opaque: new Map([['a', 3n]]) };
    const note: VaultViewPage = { id: 'a', last_modified: 0, metadata };
    const feed = mountController({ notes: [note], schema: { Modified: 'last_edited_time' } });
    expect(feed.model().sortedNotes[0]?.metadata).toBe(metadata);
    expect(feed.model().sortedNotes[0]?.last_modified).toBe(instant);
    expect(note.last_modified).toBe(0);
  });

  it('marks/open records with optional callbacks and leaves missing update inert', () => {
    const feed = mountController();
    act(() => { feed.model().openFeedRecord('a'); });
    expect(feed.model().readIds.has('a')).toBe(true);
    expect(feed.model().lastRecordId).toBe('a');
    act(() => { feed.model().selection.selectAll(); });
    act(() => { feed.model().applyBulkField('Status', 'Done'); });
    expect(feed.model().bulkProposal).toBeNull();
    const select = vi.fn<(id: string) => void>();
    feed.rerender({ onNoteSelect: select });
    act(() => { feed.model().openFeedRecord('a'); });
    expect(select).toHaveBeenCalledWith('a');
  });

  it('emits a mutable Set copy when deleting selected notes', () => {
    const onDeleteSelected = vi.fn((ids: Set<string>) => { ids.add('external'); });
    const feed = mountController({ onDeleteSelected });
    act(() => { feed.model().selection.selectAll(); });
    const original = feed.model().selection.selectedIds;
    act(() => { feed.model().handleBulkDelete(); });
    const emitted = onDeleteSelected.mock.calls[0]?.[0];
    expect(emitted).toBeInstanceOf(Set);
    expect(emitted).not.toBe(original);
    expect(original).toEqual(new Set(['a']));
    expect(feed.model().selection.selectedIds.size).toBe(0);
  });

  it('keeps the per-note delete fallback with scalar and absent titles', () => {
    const onDeletePage = vi.fn<(id: string, title?: string) => void>();
    const feed = mountController({ notes: [{ id: 'a', title: 42 }, { id: 'b', metadata: null }], onDeletePage });
    act(() => { feed.model().selection.selectAll(); });
    act(() => { feed.model().handleBulkDelete(); });
    expect(onDeletePage.mock.calls).toEqual([['a', '42'], ['b', '']]);
  });

  it('keeps opaque previous/next array entries by identity through save and undo', async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const opaque = new Map([['date', new Date(0)]]);
    const method = () => opaque;
    const symbol = Symbol('tag');
    const previous = Object.freeze([cycle, opaque, method, symbol, 4n, 'New']);
    const metadata = Object.freeze({ Tags: previous });
    const onUpdateNote = vi.fn<(id: string, patch: VaultFeedUpdate) => unknown>(() => opaque);
    const feed = mountController({ notes: [{ id: 'a', metadata }], onUpdateNote });
    act(() => { feed.model().selection.selectAll(); });
    act(() => { feed.model().applyBulkField('Tags', 'New'); });
    const proposal = feed.model().bulkProposal;
    const next = proposal?.changes[0]?.next;
    expect(proposal?.changes[0]?.previous).toBe(previous);
    expect(next).toEqual(previous);
    expect(next).not.toBe(previous);
    if (!Array.isArray(next)) throw new Error('Append must produce an array');
    expect(next[0]).toBe(cycle);
    expect(next[1]).toBe(opaque);
    expect(next[2]).toBe(method);
    expect(next[3]).toBe(symbol);
    await act(async () => { await feed.model().confirmBulkField(); });
    expect(onUpdateNote.mock.calls[0]?.[1].metadata.Tags).toBe(next);
    expect(feed.model().pendingBulkUndo).toBe(proposal?.changes);
    expect(feed.model().bulkSaveState).toBe('saved');
    expect(feed.model().bulkProposal).toBeNull();
    expect(feed.model().selection.selectedIds.size).toBe(0);
    await act(async () => { await feed.model().undoBulkField(); });
    expect(onUpdateNote.mock.calls[1]?.[1].metadata.Tags).toBe(previous);
    expect(metadata.Tags).toBe(previous);
    expect(feed.model().pendingBulkUndo).toBeNull();
  });

  it.each([
    { label: 'missing metadata', note: { id: 'a' }, previous: undefined },
    { label: 'null metadata', note: { id: 'a', metadata: null }, previous: undefined },
    { label: 'null value', note: { id: 'a', metadata: { Status: null } }, previous: null },
    { label: 'false value', note: { id: 'a', metadata: { Status: false } }, previous: false },
    { label: 'zero value', note: { id: 'a', metadata: { Status: 0 } }, previous: 0 },
  ])('undo retains the exact value for $label with async callbacks', async ({ note, previous }) => {
    const onUpdateNote = vi.fn<(id: string, patch: VaultFeedUpdate) => unknown>(() => Promise.resolve({ saved: true }));
    const feed = mountController({ notes: [note], onUpdateNote });
    act(() => { feed.model().selection.selectAll(); });
    act(() => { feed.model().applyBulkField('Status', 'Done'); });
    await act(async () => { await feed.model().confirmBulkField(); });
    await act(async () => { await feed.model().undoBulkField(); });
    const undo = onUpdateNote.mock.calls[1]?.[1].metadata;
    expect(undo).toHaveProperty('Status', previous);
    expect(undo?.Status).toBe(previous);
  });

  it.each(['sync', 'async'])('reports %s save failures and clears selection/proposal without inventing undo', async mode => {
    const failure = new Error('save failed');
    const onUpdateNote = vi.fn<(id: string, patch: VaultFeedUpdate) => unknown>(() => {
      if (mode === 'sync') throw failure;
      return Promise.reject(failure);
    });
    const feed = mountController({ onUpdateNote });
    act(() => { feed.model().selection.selectAll(); });
    act(() => { feed.model().applyBulkField('Status', 'Done'); });
    await act(async () => { await feed.model().confirmBulkField(); });
    expect(feed.model().bulkSaveState).toBe('error');
    expect(feed.model().bulkProposal).toBeNull();
    expect(feed.model().pendingBulkUndo).toBeNull();
    expect(feed.model().selection.selectedIds.size).toBe(0);
    expect(logError).toHaveBeenCalledWith('vault-feed.bulk-save', failure);
    expect(toast.error).toHaveBeenCalledWith('Some changes could not be saved');
  });

  it.each(['sync', 'async'])('retains undo identity on %s rejection and supports retry', async mode => {
    const previous = new Set(['opaque']);
    const onUpdateNote = vi.fn<(id: string, patch: VaultFeedUpdate) => unknown>(() => undefined);
    const feed = mountController({ notes: [{ id: 'a', metadata: { Status: previous } }], onUpdateNote });
    act(() => { feed.model().selection.selectAll(); });
    act(() => { feed.model().applyBulkField('Status', 'Done'); });
    await act(async () => { await feed.model().confirmBulkField(); });
    const undo = feed.model().pendingBulkUndo;
    const failure = new Error('undo failed');
    onUpdateNote.mockImplementationOnce(() => {
      if (mode === 'sync') throw failure;
      return Promise.reject(failure);
    });
    await act(async () => { await feed.model().undoBulkField(); });
    expect(feed.model().pendingBulkUndo).toBe(undo);
    expect(feed.model().bulkSaveState).toBe('error');
    expect(logError).toHaveBeenCalledWith('vault-feed.bulk-undo', failure);
    await act(async () => { await feed.model().undoBulkField(); });
    expect(onUpdateNote.mock.calls[1]?.[1].metadata.Status).toBe(previous);
    expect(onUpdateNote.mock.calls[2]?.[1].metadata.Status).toBe(previous);
    expect(feed.model().bulkSaveState).toBe('saved');
    expect(feed.model().pendingBulkUndo).toBeNull();
  });
});
