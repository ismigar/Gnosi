import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BookmarkForm, type BookmarkPage } from './BookmarkForm';
import type { VaultBookmark } from './bookmarks';
import { useState } from 'react';
import { dispatchWindowEvent } from '../platform/browser-events';

const remote = vi.hoisted(() => ({ results: [{ id: 'remote-only', title: 'Remote philosophy note', path: 'Research' }], total: 1, error: null as string | null, loading: false, loadMore: vi.fn(), retry: vi.fn() }));
vi.mock('../page-search/useVaultContentSearch', () => ({ useVaultContentSearch: (query: string) => ({ ...remote, results: query ? remote.results : [] }) }));
vi.mock('../api/vaults', () => ({ fetchVaultPage: () => Promise.resolve({ content: '# Introduction\n\nFirst paragraph ^first\n\n## Conclusion\n\nEnd' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: string | { defaultValue?: string }) => typeof options === 'string' ? options : options?.defaultValue ?? key }) }));

let root: Root;
const save = vi.fn();
const cancel = vi.fn();
const dashboardFolders = ['Dashboard', 'Dashboard/Plans', '.Dashboards', '.Dashboards/Legacy'];
const pages: BookmarkPage[] = [...Array.from({ length: 5000 }, (_, i) => ({ id: `note-${String(i)}`, title: i === 4999 ? 'Ètica de la cura' : `Note ${String(i)}` })), { id: 'dashboard-a', title: 'Research overview', metadata: { is_dashboard: true } }, ...dashboardFolders.map((folder, index) => ({ id: `legacy-${String(index)}`, title: `Legacy overview ${String(index)}`, folder, metadata: {} }))];
function Harness({ activePageId }: { readonly activePageId?: string }) {
  const [draft, setDraft] = useState<VaultBookmark>({ id: 'draft', kind: 'page', target: '', label: '', group: '' });
  return <BookmarkForm draft={draft} pages={pages} activePageId={activePageId} groups={['Reading', 'Work']} disabled={false} existing={false} canMoveUp={false} canMoveDown={false} onChange={setDraft} onSave={() => { save(draft); }} onCancel={cancel} onRemove={vi.fn()} onMove={vi.fn()} />;
}
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
};
const click = async (label: string) => { await act(async () => { button(label).click(); await Promise.resolve(); }); };
const field = (label: string) => {
  const input = [...document.querySelectorAll('label')].find(item => item.firstChild?.textContent === label)?.querySelector('input,select') ?? document.querySelector(`[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) throw new Error(`Missing field ${label}`);
  return input;
};
const change = async (label: string, value: string) => { const input = field(label); await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')?.set?.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await Promise.resolve(); }); };
beforeEach(async () => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true); save.mockReset(); cancel.mockReset(); remote.error = null; const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<Harness />); await Promise.resolve(); }); });
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); document.body.replaceChildren(); });

describe('bookmark destination selection at Vault scale', () => {
  it('finds a note among thousands without rendering thousands of choices and selects with Enter', async () => {
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(8);
    expect(document.querySelectorAll('select option')).toHaveLength(7);
    await change('Find a note', 'etica cura');
    expect(document.querySelectorAll('[role="option"]').length).toBeLessThan(25);
    expect(document.body.textContent).toContain('Ètica de la cura');
    await act(async () => { field('Find a note').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve(); });
    expect(save).not.toHaveBeenCalled();
    expect(field('Name').value).toBe('Ètica de la cura');
    await click('Reading'); await click('Save');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ target: 'note-4999', group: 'Reading' }));
  });
  it('finds notes outside the loaded sidebar and preserves a name the user has entered', async () => {
    await change('Find a note', 'Remote philosophy');
    await change('Name', 'My alias'); await click('Remote philosophy noteResearch'); await click('Save');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ target: 'remote-only', label: 'My alias' }));
  });
  it('shows real headings and marked passages instead of requiring a remembered reference', async () => {
    await change('Type', 'section'); await change('Find a note', 'etica'); await click('Ètica de la cura');
    await act(async () => { await Promise.resolve(); }); await click('Conclusion'); await click('Save');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'section', target: 'note-4999#conclusion' }));
  });
  it('chooses an app destination without typing its route and creates groups by name', async () => {
    await change('Type', 'route'); await click('bookmarks.destinations.calendar'); await change('Group', 'Appointments'); await click('Save');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'route', target: '/calendar', group: 'Appointments' }));
  });
  it('offers dashboards explicitly, finds them by name and saves canonical page membership', async () => {
    await change('Type', 'dashboard');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(5);
    await change('Find a dashboard', 'Research'); await click('Research overview'); await click('Save');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'page', target: 'dashboard-a', label: 'Research overview' }));
  });
  it.each(dashboardFolders)('includes a dashboard stored under %s', async folder => {
    await change('Type', 'dashboard');
    const index = dashboardFolders.indexOf(folder);
    await change('Find a dashboard', `Legacy overview ${String(index)}`);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    await click(`Legacy overview ${String(index)}${folder}`); await click('Save');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'page', target: `legacy-${String(index)}` }));
  });
  it('offers the open legacy dashboard without requiring a search or an address', async () => {
    await act(async () => { root.render(<Harness activePageId="legacy-0" />); await Promise.resolve(); });
    await change('Type', 'dashboard');
    await click('Use the open dashboard: Legacy overview 0'); await click('Save');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'page', target: 'legacy-0', label: 'Legacy overview 0' }));
  });
  it('keeps local matches available on a failed full-vault search and closes with Escape', async () => {
    remote.error = 'network'; await change('Find a note', 'etica');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('full Vault search failed');
    await click('Ètica de la cura');
    await act(async () => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await Promise.resolve(); });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
