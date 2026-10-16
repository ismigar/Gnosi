import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkSortMode, VaultBookmark } from './bookmarks';
import { BookmarksSection } from './BookmarksSection';
import { storageSet } from '../api/vault-context';
import type { BookmarkPage } from './BookmarkForm';
import { dragBookmark, groupedBookmarks } from './bookmark-order';

const fixture = vi.hoisted((): {
  route: string | null; entries: VaultBookmark[]; sortMode: BookmarkSortMode; isReady: boolean; isPending: boolean; error: boolean;
  save: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; reorder: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; setSortMode: ReturnType<typeof vi.fn>;
} => ({
  route: null, entries: [], sortMode: 'manual', isReady: true, isPending: false, error: false,
  save: vi.fn(), remove: vi.fn(), reorder: vi.fn(), refresh: vi.fn(), setSortMode: vi.fn(),
}));
vi.mock('./bookmark-routes', async (importOriginal) => ({ ...await importOriginal<typeof import('./bookmark-routes')>(), currentBookmarkRoute: () => fixture.route }));
vi.mock('./useBookmarks', () => ({ useBookmarks: () => fixture }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: string | { defaultValue?: string }) => typeof options === 'string' ? options : options?.defaultValue ?? key }) }));
vi.mock('../page-search/EmbeddedVaultSearch', () => ({ EmbeddedVaultSearch: ({ query }: { query: string }) => <div data-search-preview={query} /> }));
vi.mock('../editor/VaultMarkdown', () => ({ default: ({ md }: { md: string }) => <div data-section-preview={md} /> }));

const note: VaultBookmark = { id: 'note', kind: 'page', target: 'page-a', label: 'My alias', group: 'Work' };
const pages = [{ id: 'page-a', title: 'Original title', metadata: { icon: '📖' } }];
let root: Root;
let container: HTMLDivElement;
const onPageSelect = vi.fn();
const render = async (visiblePages: readonly BookmarkPage[] = pages) => { await act(async () => { root.render(<BookmarksSection pages={visiblePages} activePageId="page-a" onPageSelect={onPageSelect} />); await Promise.resolve(); }); };
const button = (label: string) => {
  const result = [...container.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
};
const click = async (label: string) => { await act(async () => { button(label).click(); await Promise.resolve(); }); };
const field = (label: string) => {
  const element = [...container.querySelectorAll('label')].find((item) => item.firstChild?.textContent === label)?.querySelector('input,select');
  if (!element) throw new Error(`Missing field ${label}`);
  return element as HTMLInputElement | HTMLSelectElement;
};
const change = async (label: string, value: string) => {
  const element = field(label);
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    await Promise.resolve();
  });
};
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  fixture.route = null; fixture.entries = []; fixture.sortMode = 'manual'; fixture.isReady = true; fixture.isPending = false; fixture.error = false;
  fixture.save.mockReset().mockImplementation((entry: VaultBookmark) => { fixture.entries = [...fixture.entries.filter((item) => item.id !== entry.id), entry]; return Promise.resolve(); });
  fixture.remove.mockReset().mockImplementation((id: string) => { fixture.entries = fixture.entries.filter((entry) => entry.id !== id); return Promise.resolve(); });
  fixture.reorder.mockReset().mockResolvedValue(undefined); fixture.refresh.mockReset().mockResolvedValue(undefined);
  fixture.setSortMode.mockReset().mockImplementation((mode: BookmarkSortMode) => { fixture.sortMode = mode; return Promise.resolve(); });
  onPageSelect.mockReset();
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); document.body.replaceChildren(); storageSet('gnosi_active_vault_slug', ''); });

describe('unified bookmarks section', () => {
  it.each(['page', 'dashboard'])('captures a plain %s view as canonical page membership', async resource => {
    fixture.route = `/knowledge/${resource}/page-a`;
    await render(); await click('Save current view');
    expect(field('Type').value).toBe('page');
    await change('Name', 'Preserved alias'); await change('Group', 'Reading'); await click('Save');
    expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'page', target: 'page-a', label: 'Preserved alias', group: 'Reading' }));
  });
  it('normalizes manually entered plain page routes while retaining the alias and group', async () => {
    await render(); await click('Add bookmark'); await change('Type', 'route');
    await change('View address', '/knowledge/page/page-a'); await change('Name', 'My alias'); await change('Group', 'Work'); await click('Save');
    expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'page', target: 'page-a', label: 'My alias', group: 'Work' }));
  });
  it('keeps one titled empty section and adds the current page with an alias and group', async () => {
    await render();
    expect(container.querySelectorAll('section[aria-label="Bookmarks"]')).toHaveLength(1);
    expect(container.textContent).toContain('Save a note with its star');
    await click('Bookmarks'); expect(container.querySelector('select')).toBeNull();
    await click('Add bookmark');
    expect(button('Bookmarks').getAttribute('aria-expanded')).toBe('true');
    expect(field('Name').value).toBe('Original title');
    await change('Name', 'My alias'); await change('Group', 'Work'); await click('Save');
    expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'page', label: 'My alias', group: 'Work', target: 'page-a' }));
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Work');
    await click('My alias'); expect(onPageSelect).toHaveBeenCalledWith('page-a');
    expect(button('My alias').getAttribute('aria-current')).toBe('page');
    expect(container.textContent).toContain('📖');
  });
  it('renders a dashboard as a bookmarked page and preserves its page id and custom icon', async () => {
    fixture.entries = [{ ...note, id: 'dashboard', target: 'dashboard-a', label: 'Overview' }];
    const dashboard = { id: 'dashboard-a', title: 'Dashboard title', metadata: { is_dashboard: true } };
    await render([...pages, dashboard]);
    expect(container.querySelector('svg.lucide-layout-dashboard')).not.toBeNull();
    await click('Overview'); expect(onPageSelect).toHaveBeenCalledWith('dashboard-a');
    await render([...pages, { ...dashboard, metadata: { ...dashboard.metadata, icon: '📊' } }]);
    expect(container.querySelector('svg.lucide-layout-dashboard')).toBeNull();
    expect(container.textContent).toContain('📊');
  });
  it('captures the current app view into a reviewable route draft and resolves it in the selected vault', async () => {
    storageSet('gnosi_active_vault_slug', 'synthetic');
    fixture.route = '/knowledge/table/table-one/view/view-one?filter=open#row-one';
    await render(); await click('Save current view');
    expect(fixture.save).not.toHaveBeenCalled();
    expect(field('Name').value).toBe('Original title');
    expect(field('Type').value).toBe('route');
    expect(field('View address').value).toBe(fixture.route);
    await change('Name', 'Open records'); await change('Group', 'Work'); await click('Save');
    expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'route', target: fixture.route, label: 'Open records', group: 'Work' }));
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Open records"]');
    expect(link?.getAttribute('href')).toBe('/@synthetic/knowledge/table/table-one/view/view-one?filter=open#row-one');
    expect(link?.getAttribute('target')).toBeNull();
    expect(onPageSelect).not.toHaveBeenCalled();
    await click('Edit Open records'); await change('View address', '//outside.example/knowledge'); await click('Save');
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(field('View address').value).toBe('//outside.example/knowledge');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('retains a failed save or delete draft and disables editing while persistence is pending', async () => {
    fixture.entries = [note]; await render(); await click('Edit My alias'); await change('Name', 'New alias');
    let reject: (error: Error) => void = () => undefined;
    fixture.save.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await click('Save');
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(button('Add bookmark').disabled).toBe(true);
    await act(async () => { reject(new Error('offline')); await Promise.resolve(); });
    expect(field('Name').value).toBe('New alias');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('draft has been kept');
    expect(container.querySelector('fieldset')?.disabled).toBe(false);
    fixture.remove.mockRejectedValueOnce(new Error('offline')); await click('Delete');
    expect(field('Name').value).toBe('New alias'); expect(fixture.entries).toEqual([note]);
    await click('Delete'); expect(container.querySelector('form')).toBeNull(); expect(fixture.entries).toEqual([]);
  });
  it('prevents writes before synchronization and exposes refresh after a failed load', async () => {
    fixture.isReady = false; fixture.error = true; await render();
    expect(button('Add bookmark').disabled).toBe(true); expect(field('Sort bookmarks').disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('synchronized');
    await click('Refresh'); expect(fixture.refresh).toHaveBeenCalledOnce(); expect(fixture.save).not.toHaveBeenCalled();
  });
  it('opens section/search previews and retains web and graph destinations', async () => {
    storageSet('gnosi_active_vault_slug', 'research');
    fixture.entries = [note,
      { ...note, id: 'section', kind: 'section', label: 'Passage', target: 'page-a#^block' },
      { ...note, id: 'search', kind: 'search', label: 'Tasks', target: 'task:todo' },
      { ...note, id: 'graph', kind: 'graph', label: 'Graph', target: '/graph' },
      { ...note, id: 'web', kind: 'url', label: 'Website', target: 'https://example.com' },
    ]; await render();
    await click('Passage'); expect(container.querySelector('[data-section-preview]')?.getAttribute('data-section-preview')).toBe('![[page-a#^block]]');
    await click('Tasks'); expect(container.querySelector('[data-search-preview]')?.getAttribute('data-search-preview')).toBe('task:todo');
    expect(container.querySelector('a[href="https://example.com"]')?.getAttribute('target')).toBe('_blank');
    expect(container.querySelector('a[href="/@research/graph"]')).not.toBeNull();
    await click('Edit Passage'); await change('Type', 'url'); await change('bookmarks.url', 'javascript:alert(1)'); await click('Save');
    expect(fixture.save).not.toHaveBeenCalled(); expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Check the name and destination');
  });
  it('synchronizes sort choices and preserves failed reorder drafts', async () => {
    fixture.entries = [note, { ...note, id: 'two', label: 'Alpha' }]; await render();
    await change('Sort bookmarks', 'alpha-asc'); expect(fixture.setSortMode).toHaveBeenCalledWith('alpha-asc');
    expect([...container.querySelectorAll('[data-bookmark-id]')].map((element) => element.getAttribute('data-bookmark-id'))).toEqual(['two', 'note']);
    await click('Edit My alias'); expect(button('Move up').disabled).toBe(true);
    await change('Sort bookmarks', 'manual'); fixture.reorder.mockRejectedValueOnce(new Error('offline'));
    await click('Move down'); expect(fixture.reorder).toHaveBeenCalledWith(['two', 'note']);
    expect(field('Name').value).toBe('My alias'); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    fixture.setSortMode.mockRejectedValueOnce(new Error('offline')); await change('Sort bookmarks', 'alpha-desc');
    expect(field('Sort bookmarks').value).toBe('manual'); expect(field('Name').value).toBe('My alias');
  });
});

describe('bookmark group ordering', () => {
  it('sorts within groups by alias or creation time and drags within the same group', () => {
    const entries = [{ ...note, label: 'Zulu', created_at: 2 }, { ...note, id: 'other', group: 'Study' }, { ...note, id: 'last', label: 'Alpha', created_at: 1 }];
    expect(groupedBookmarks(entries, 'alpha-asc').map(({ entries: members }) => members.map((entry) => entry.id))).toEqual([['last', 'note'], ['other']]);
    expect(groupedBookmarks(entries, 'recent')[0]?.entries.map((entry) => entry.id)).toEqual(['note', 'last']);
    expect(groupedBookmarks(entries, 'oldest')[0]?.entries.map((entry) => entry.id)).toEqual(['last', 'note']);
    expect(dragBookmark(entries, 'last', 'note')).toEqual(['last', 'other', 'note']);
    expect(dragBookmark(entries, 'note', 'other')).toBeNull();
  });
});
