import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { fetchVaultLinkNeighborhood } from '../../../shared/api/vault-neighborhood';
import { currentRequestContext, USER_ID_STORAGE_KEY } from '../../../shared/api/request-context';
import { fetchVaultPage, fetchVaultPagesByTable, fetchHomeKnowledgeCatalog, type VaultPageSummary } from '../../../shared/api/vaults';
import { fetchPageViews, fetchVaultViews } from '../../../shared/api/vault-views';
import { writeStorage, removeStorage } from '../../../shared/platform/browser-storage';
import { activateVault } from '../../../shared/routing/vaultRouting';
import { recordPersonalNoteEdit } from '../../../shared/records/personalNoteEdits';
import KnowledgeBlocks from './KnowledgeBlocks';

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('../../../shared/api/vaults', () => ({
  fetchVaultPage: vi.fn(), fetchVaultPagesByTable: vi.fn(), fetchHomeKnowledgeCatalog: vi.fn(),
}));
vi.mock('../../../shared/api/vault-views', () => ({ fetchVaultViews: vi.fn(), fetchPageViews: vi.fn() }));
vi.mock('../../../shared/api/vault-neighborhood', () => ({ fetchVaultLinkNeighborhood: vi.fn() }));

const selectScope = (id: string) => activateVault({ id, slug: id, name: id });
const page = (id: string, title: string, metadata: Record<string, unknown> = {}, timestamp = ''): VaultPageSummary =>
  ({ id, title, metadata, folder: 'Wiki', is_database: false, last_modified: timestamp, size: 1 });

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  writeStorage(USER_ID_STORAGE_KEY, 'test-member');
  selectScope('first');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(fetchVaultViews).mockResolvedValue([]);
  vi.mocked(fetchPageViews).mockResolvedValue({ page_id: 'a', sections: [] });
  vi.mocked(fetchVaultLinkNeighborhood).mockResolvedValue({ incoming: [], outgoing: [], incoming_complete: true });
});
afterEach(() => { client.clear(); removeStorage(USER_ID_STORAGE_KEY); vi.useRealTimers(); });

async function settle() {
  for (let phase = 0; phase < 5; phase += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}

function mount(kind: 'board' | 'graph', settings: Record<string, string> = {}, editing = false) {
  const configure = vi.fn();
  const node = (current: Record<string, string>, edit: boolean) => <QueryClientProvider client={client}><MemoryRouter>
    <KnowledgeBlocks block={{ id: 'block', kind, width: 2, settings: current }} editing={edit} onConfigure={configure} />
  </MemoryRouter></QueryClientProvider>;
  const result = mountTestComponent(node(settings, editing));
  return { ...result, configure, update: (current: Record<string, string>, edit = false) => { result.render(node(current, edit)); } };
}

it('starts with the first accessible dashboard, renders live saved matches and navigates straight to its records', async () => {
  const alpha = page('a', 'Alpha', { is_dashboard: true });
  const boards = [page('z', 'Zulu', { is_dashboard: true }), alpha];
  vi.mocked(fetchHomeKnowledgeCatalog).mockResolvedValue({ pages: boards, complete: true });
  vi.mocked(fetchVaultPage).mockResolvedValue({ ...alpha, content: '{}', etag: 'etag' });
  vi.mocked(fetchPageViews).mockResolvedValue({ page_id: 'a', sections: [
    { section_id: 'tasks', view_id: 'todo', source_table_id: 'items', heading: 'Tasks' },
    { section_id: 'other', source_table_id: 'other', heading: 'Ideas' },
  ] });
  vi.mocked(fetchVaultViews).mockResolvedValue([{ id: 'todo', table_id: 'items', filters: [
    { field: 'State', operator: 'equals', value: 'open' },
  ], sorts: [{ field: 'Rank', direction: 'desc' }] }]);
  vi.mocked(fetchVaultPagesByTable).mockImplementation(table => Promise.resolve(table === 'other' ? [] : [
    page('hidden', 'Unrelated', { State: 'closed', Rank: 30 }),
    page('two', 'Second', { State: 'open', Rank: 2 }), page('ten', 'Tenth', { State: 'open', Rank: 10 }),
  ]));
  const view = mount('board');
  await settle();
  expect(view.container.querySelector('a')?.getAttribute('href')).toBe('/@first/knowledge/dashboard/a');
  expect([...view.container.querySelectorAll('tbody a')].map(a => a.getAttribute('href'))).toEqual([
    '/@first/knowledge/page/ten', '/@first/knowledge/page/two',
  ]);
  expect(view.container.querySelector('input, select, textarea, [contenteditable=true]')).toBeNull();
  expect(view.container.textContent).not.toContain('Unrelated');
  view.update({ boardId: 'a' }, true);
  await settle();
  const select = view.container.querySelectorAll('select')[1];
  if (!select) throw new Error('Missing section control');
  const choice = [...select.options].find(option => option.textContent === 'Tasks');
  if (!choice) throw new Error('Missing Tasks option');
  act(() => { select.value = choice.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(view.configure).toHaveBeenCalledWith({ boardId: 'a', section: choice.value });
  view.update({ boardId: 'a', section: choice.value });
  expect(view.container.textContent).not.toContain('Ideas');
  view.update({ boardId: 'removed' });
  expect(view.container.textContent).toContain('home_canvas.knowledge.missingBoard');
});

it('keeps partial joined matches, retries partial tables, and waits for a complete read before reporting totals or zero matches', async () => {
  const board = page('board', 'Board', { is_dashboard: true });
  let phase: 'wiki' | 'partial' | 'full' = 'wiki';
  let finishFull = () => {};
  const fullRead = new Promise<void>(resolve => { finishFull = resolve; });
  const records = Array.from({ length: 9 }, (_, index) =>
    page(`task-${String(index)}`, `Task ${String(index)}`, { Owner: `person-${String(index)}`, Rank: index }));
  const people = records.map((_, index) => page(`person-${String(index)}`, `Person ${String(index)}`));
  vi.mocked(fetchHomeKnowledgeCatalog).mockImplementation(() => Promise.resolve({ pages: [board], complete: phase === 'full' }));
  vi.mocked(fetchVaultPage).mockResolvedValue({ ...board, content: '{}', etag: 'tag' });
  vi.mocked(fetchPageViews).mockResolvedValue({ page_id: board.id, sections: [
    { section_id: 'joined', view_id: 'joined', source_table_id: 'tasks', heading: 'Joined records' },
    { section_id: 'none', view_id: 'none', source_table_id: 'tasks', heading: 'No matching rank' },
  ] });
  vi.mocked(fetchVaultViews).mockResolvedValue([
    { id: 'joined', table_id: 'tasks', joins: [{ tableId: 'people', leftField: 'Owner', rightField: 'id', type: 'inner' }],
      sorts: [{ field: 'Rank', direction: 'desc' }] },
    { id: 'none', table_id: 'tasks', filters: [{ field: 'Rank', operator: 'equals', value: '99' }] },
  ]);
  vi.mocked(fetchVaultPagesByTable).mockImplementation(async table => {
    if (phase === 'wiki') return [];
    if (phase === 'full') await fullRead;
    if (table === 'tasks') return records;
    return phase === 'partial' ? people.slice(0, 8) : people;
  });
  const view = mount('board');
  const refresh = () => {
    const button = view.container.querySelector<HTMLButtonElement>('.home-knowledge-index-status button');
    if (!button) throw new Error('Missing partial catalog refresh');
    act(() => { button.click(); });
  };
  const status = () => view.container.textContent;
  const rows = () => [...view.container.querySelectorAll('tbody a')].map(link => link.textContent);
  await settle();
  expect(rows()).toEqual([]);
  expect(status()).toContain('home_canvas.knowledge.partialView');
  expect(status()).not.toContain('home_canvas.knowledge.noMatches');
  phase = 'partial';
  refresh();
  await settle();
  expect(rows()).toEqual(['Task 7', 'Task 6', 'Task 5', 'Task 4', 'Task 3', 'Task 2']);
  expect(status()).toContain('home_canvas.knowledge.partialView');
  expect(status()).not.toContain('home_canvas.knowledge.showing');
  expect(status()).not.toContain('home_canvas.knowledge.noMatches');
  phase = 'full';
  refresh();
  await settle();
  expect(status()).not.toContain('home_canvas.knowledge.showing');
  expect(status()).not.toContain('home_canvas.knowledge.noMatches');
  act(() => { finishFull(); });
  await settle();
  expect(rows()).toEqual(['Task 8', 'Task 7', 'Task 6', 'Task 5', 'Task 4', 'Task 3']);
  expect(status()).toContain('home_canvas.knowledge.showing');
  expect(status()).toContain('home_canvas.knowledge.noMatches');
  expect(status()).not.toContain('home_canvas.knowledge.partialView');
});

it('labels a first-open Vault fallback, honors personal recency, provides a configurable pin and clickable directed neighbors', async () => {
  selectScope('graph-defaults');
  const pages = [page('new', 'Newest', {}, '2026-11-19'), page('mine', 'My edit', {}, '2026-11-10'), page('other', 'Linked note')];
  vi.mocked(fetchHomeKnowledgeCatalog).mockResolvedValue({ pages, complete: true });
  vi.mocked(fetchVaultLinkNeighborhood).mockResolvedValue({ incoming: ['other'], outgoing: [], incoming_complete: true });
  const view = mount('graph');
  await settle();
  expect(view.container.textContent).toContain('home_canvas.knowledge.recentVault');
  expect(view.container.querySelector('.home-knowledge-center')?.textContent).toBe('Newest');
  act(() => { recordPersonalNoteEdit(currentRequestContext(), pages[1], 123); });
  await settle();
  expect(view.container.textContent).not.toContain('home_canvas.knowledge.recentVault');
  expect(view.container.querySelector('.home-knowledge-center')?.textContent).toBe('My edit');
  expect(view.container.querySelector('.home-knowledge-neighbors a')?.getAttribute('href')).toBe('/@graph-defaults/knowledge/page/other');
  view.update({}, true);
  const picker = view.container.querySelector('select');
  if (!picker) throw new Error('Missing graph pin control');
  act(() => { picker.value = 'other'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(view.configure).toHaveBeenCalledWith({ pageId: 'other' });
  view.update({ pageId: 'other' });
  await settle();
  expect(view.container.querySelector('.home-knowledge-center')?.textContent).toBe('Linked note');
  view.update({ pageId: 'unavailable' });
  expect(view.container.textContent).toContain('home_canvas.knowledge.missingNote');
});

it('aborts the previous graph read and never renders late cross-Vault results with matching IDs', async () => {
  selectScope('previous');
  vi.mocked(fetchHomeKnowledgeCatalog).mockImplementation((_signal, scope) => Promise.resolve({ complete: true, pages: [
    page('center', scope.vaultId, {}, '2026-11-22'), page('neighbor', 'Neighbor'),
  ] }));
  let finish: (value: Awaited<ReturnType<typeof fetchVaultLinkNeighborhood>>) => void = () => { throw new Error('Missing pending read'); };
  vi.mocked(fetchVaultLinkNeighborhood).mockImplementation((_id, _signal, scope) =>
    scope.vaultId === 'previous' ? new Promise(done => { finish = done; }) : Promise.resolve({ incoming: [], outgoing: [], incoming_complete: true }));
  const view = mount('graph');
  await settle();
  const previousSignal = vi.mocked(fetchVaultLinkNeighborhood).mock.calls[0]?.[1];
  act(() => { selectScope('next'); });
  await settle();
  expect(previousSignal?.aborted).toBe(true);
  act(() => { finish({ incoming: [], outgoing: ['neighbor'], incoming_complete: true }); });
  await settle();
  expect(view.container.querySelector('.home-knowledge-center')?.textContent).toBe('next');
  expect(view.container.querySelector('.home-knowledge-neighbors')).toBeNull();
});

it('shows outgoing links while the incoming index is pending and can refresh its results', async () => {
  vi.mocked(fetchHomeKnowledgeCatalog).mockResolvedValue({ pages: [page('center', 'Center'), page('target', 'Target')], complete: true });
  vi.mocked(fetchVaultLinkNeighborhood)
    .mockResolvedValueOnce({ incoming: [], outgoing: ['target'], incoming_complete: false })
    .mockResolvedValueOnce({ incoming: [], outgoing: [], incoming_complete: false })
    .mockResolvedValue({ incoming: [], outgoing: [], incoming_complete: true });
  const view = mount('graph', { pageId: 'center' });
  await settle();
  expect(view.container.querySelector('.home-knowledge-neighbors a')?.getAttribute('href')).toBe('/@first/knowledge/page/target');
  expect(view.container.textContent).toContain('home_canvas.knowledge.incomingPending');
  const refresh = () => {
    const button = view.container.querySelector<HTMLButtonElement>('button[aria-label="common.refresh"]');
    if (!button) throw new Error('Missing refresh control');
    act(() => { button.click(); });
  };
  refresh();
  await settle();
  expect(view.container.textContent).toContain('home_canvas.knowledge.incomingPending');
  expect(view.container.textContent).not.toContain('home_canvas.knowledge.noLinks');
  refresh();
  await settle();
  expect(view.container.textContent).toContain('home_canvas.knowledge.noLinks');
  expect(view.container.textContent).not.toContain('home_canvas.knowledge.incomingPending');
});
