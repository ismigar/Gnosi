import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { fetchBlockEditorBacklinks, fetchBlockEditorOutlinks } from '../../../shared/api/block-editor';
import { currentRequestContext, USER_ID_STORAGE_KEY } from '../../../shared/api/request-context';
import { fetchVaultPage, fetchVaultPagesByTable, fetchVaultSidebarSummary, type VaultPageSummary } from '../../../shared/api/vaults';
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
  fetchVaultPage: vi.fn(), fetchVaultPagesByTable: vi.fn(), fetchVaultSidebarSummary: vi.fn(),
}));
vi.mock('../../../shared/api/vault-views', () => ({ fetchVaultViews: vi.fn(), fetchPageViews: vi.fn() }));
vi.mock('../../../shared/api/block-editor', () => ({ fetchBlockEditorOutlinks: vi.fn(), fetchBlockEditorBacklinks: vi.fn() }));

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
  vi.mocked(fetchBlockEditorBacklinks).mockResolvedValue([]);
  vi.mocked(fetchBlockEditorOutlinks).mockResolvedValue({ links: [], relations: [], unresolved: [] });
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
  vi.mocked(fetchVaultSidebarSummary).mockResolvedValue(boards);
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

it('labels a first-open Vault fallback, honors personal recency, provides a configurable pin and clickable directed neighbors', async () => {
  selectScope('graph-defaults');
  const pages = [page('new', 'Newest', {}, '2026-11-19'), page('mine', 'My edit', {}, '2026-11-10'), page('other', 'Linked note')];
  vi.mocked(fetchVaultSidebarSummary).mockResolvedValue(pages);
  vi.mocked(fetchBlockEditorBacklinks).mockResolvedValue([{ id: 'other', title: 'Linked note', kind: 'link' }]);
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
  vi.mocked(fetchVaultSidebarSummary).mockImplementation((_signal, scope) => Promise.resolve([
    page('center', scope?.vaultId ?? '', {}, '2026-11-22'), page('neighbor', 'Neighbor'),
  ]));
  let finish: (value: Awaited<ReturnType<typeof fetchBlockEditorOutlinks>>) => void = () => { throw new Error('Missing pending read'); };
  vi.mocked(fetchBlockEditorOutlinks).mockImplementation((_id, _signal, scope) =>
    scope?.vaultId === 'previous' ? new Promise(done => { finish = done; }) : Promise.resolve({ links: [], relations: [], unresolved: [] }));
  const view = mount('graph');
  await settle();
  const previousSignal = vi.mocked(fetchBlockEditorOutlinks).mock.calls[0]?.[1];
  act(() => { selectScope('next'); });
  await settle();
  expect(previousSignal?.aborted).toBe(true);
  act(() => { finish({ links: [{ id: 'neighbor', title: 'Old' }], relations: [], unresolved: [] }); });
  await settle();
  expect(view.container.querySelector('.home-knowledge-center')?.textContent).toBe('next');
  expect(view.container.querySelector('.home-knowledge-neighbors')).toBeNull();
});
