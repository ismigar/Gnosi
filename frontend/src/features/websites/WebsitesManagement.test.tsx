import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { currentRequestContext } from '../../shared/api/request-context';
import * as api from '../../shared/api/sites';
import WebsitesPage from './WebsitesPage';

vi.mock('../../shared/api/sites', () => Object.fromEntries(['listSites', 'createSite', 'removeSite', 'siteCatalogue', 'getSite', 'saveSite', 'previewSite', 'publishSite', 'siteJobs', 'cancelJob', 'rollbackSite', 'exportTheme', 'importTheme', 'themeHistory', 'getServiceSettings', 'saveServiceSettings', 'serviceAction', 'getTargetConnection', 'saveTargetConnection', 'probeTarget', 'serveTarget', 'localTargetStatus', 'stopLocalTarget', 'previewSiteFont', 'previewSiteImage', 'uploadSiteThemeAsset'].map(name => [name, vi.fn()])));
vi.mock('../../shared/api/request-context', () => ({ currentRequestContext: vi.fn() }));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('../../shared/ui/layout/AppHeader', () => ({ AppHeader: ({ children, title }: { children: React.ReactNode; title: string }) => <header><h1>{title}</h1>{children}</header> }));
vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t, i18n: { language: 'ca' } }) }; });

const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const base: api.SiteConfig = { id: 'test-site', name: 'Synthetic website', revision: 1, languages: ['ca', 'es', 'en-gb'], default_language: 'ca', origin: 'https://example.invalid', schema_version: 1, legacy_pilot: false, sources: [], pages: [], forms: [{ id: 'contact', name: 'Contact', enabled: false, revision: 1, privacy_url: '', require_privacy: false, title: { ca: 'Contacta', es: 'Contacto' }, fields: [{ id: 'email', type: 'email', required: true, label: { ca: 'Correu', es: 'Correo' }, help: {}, placeholder: {}, max_length: 2000, options: [] }] }], theme: { name: 'Synthetic', tokens: {}, advanced_css: '', schema_version: 1, logo: '', logo_alt: '', favicon: '' }, navigation: [], footer: [], social_links: [], redirects: {}, targets: [{ id: 'local', name: 'Local', enabled: true, environment: 'local', adapter: 'local', base_url: 'http://127.0.0.1:4321' }] };
const catalogue: api.CatalogueItem[] = [{ id: 'articles', kind: 'table', title: 'Articles', fields: [{ id: 'summary', name: 'Public summary', type: 'text' }, { id: 'notes', name: 'Private note', type: 'text' }] }];
const autosave = async () => { await act(async () => { vi.advanceTimersByTime(650); await Promise.resolve(); }); await settle(); };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
function button(container: HTMLElement, value: string) { const found = [...container.querySelectorAll('button')].find(element => element.textContent === value); if (!found) throw new Error(`Missing button ${value}`); return found; }
function control(container: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement { const found = [...container.querySelectorAll('label')].find(element => element.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select'); if (!found) throw new Error(`Missing field ${label}`); return found as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; }
function changeInput(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }
function tab(container: HTMLElement, name: string) { const item = container.querySelector<HTMLButtonElement>(`#websites-tab-${name}`); if (!item) throw new Error('Missing tab'); act(() => { item.click(); }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.mocked(currentRequestContext).mockReturnValue(context);
  vi.mocked(api.listSites).mockResolvedValue([structuredClone(base)]);
  vi.mocked(api.siteCatalogue).mockResolvedValue(catalogue);
  vi.mocked(api.getSite).mockResolvedValue({ site: structuredClone(base), jobs: [], releases: [], service_available: true });
  vi.mocked(api.saveSite).mockImplementation(site => Promise.resolve({ ...site, revision: site.revision + 1 }));
  vi.mocked(api.localTargetStatus).mockResolvedValue({ running: false, url: 'http://127.0.0.1:4321' });
  vi.mocked(api.serveTarget).mockResolvedValue({ running: true, url: 'http://127.0.0.1:4321' });
  vi.mocked(api.stopLocalTarget).mockResolvedValue({ running: false, url: 'http://127.0.0.1:4321' });
  vi.mocked(api.getTargetConnection).mockResolvedValue({ local_port: 4321, host: '', username: '', port: 22, remote_root: '', ssh_key_reference: '', document_root: '', remote_private_root: '' });
});
afterEach(() => { vi.useRealTimers(); });

describe('Website and hosting management', () => {
  it.each([false, true])('keeps release history and permits restoration only to existing hosting (removed: %s)', async removed => {
    const site = { ...structuredClone(base), targets: removed ? [] : structuredClone(base.targets) };
    const release = { id: 'historical', site_id: site.id, target_id: 'local', created_at: '2026-11-01', fingerprint: 'retained', current: false, url: 'http://127.0.0.1:4321' };
    vi.mocked(api.listSites).mockResolvedValue([site]);
    vi.mocked(api.getSite).mockResolvedValue({ site, jobs: [], service_available: true, releases: [release] });
    vi.mocked(api.rollbackSite).mockResolvedValue({ ...release, current: true });
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'publishing');
    expect(view.container.textContent).toContain('2026-11-01');
    expect(view.container.textContent.includes('websites.removedHosting')).toBe(removed);
    const restore = [...view.container.querySelectorAll('button')].find(item => item.textContent === 'websites.rollback');
    if (removed) {
      expect(restore).toBeUndefined();
      expect(api.rollbackSite).not.toHaveBeenCalled();
    } else {
      expect(restore).toBeDefined();
      act(() => { restore?.click(); }); await settle();
      expect(api.rollbackSite).toHaveBeenCalledWith(site.id, 'historical', context, expect.any(AbortSignal));
    }
  });

  it('requires confirmation and permits cancelling website removal', async () => {
    const view = mountTestComponent(<WebsitesPage />); await settle();
    act(() => { button(view.container, 'websites.removeSite').click(); }); await settle();
    expect(view.container.querySelector('[role="dialog"]')?.textContent).toContain('websites.removeSiteHelp');
    expect(api.removeSite).not.toHaveBeenCalled();
    act(() => { button(view.container, 'websites.cancel').click(); }); await settle();
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(control(view.container, 'websites.website').value).toBe(base.id);
  });

  it('removes the last website without recreating it through autosave', async () => {
    vi.mocked(api.removeSite).mockResolvedValue(undefined);
    const view = mountTestComponent(<WebsitesPage />); await settle();
    act(() => { button(view.container, 'websites.removeSite').click(); }); await settle();
    act(() => { button(view.container, 'websites.delete').click(); }); await settle(); await autosave();
    expect(api.removeSite).toHaveBeenCalledWith(base.id, base.revision, context, expect.any(AbortSignal));
    expect(view.container.textContent).toContain('websites.noSites');
    expect(view.container.querySelector('[role="tabpanel"]')).toBeNull();
    expect(api.saveSite).not.toHaveBeenCalled();
  });

  it('selects a remaining website after removing the selected website', async () => {
    const other = { ...structuredClone(base), id: 'other-site', name: 'Other website' };
    vi.mocked(api.listSites).mockResolvedValue([structuredClone(base), other]);
    vi.mocked(api.getSite).mockImplementation(id => Promise.resolve({ site: id === other.id ? other : structuredClone(base), jobs: [], releases: [], service_available: true }));
    vi.mocked(api.removeSite).mockResolvedValue(undefined);
    const view = mountTestComponent(<WebsitesPage />); await settle();
    act(() => { button(view.container, 'websites.removeSite').click(); }); await settle();
    act(() => { button(view.container, 'websites.delete').click(); }); await settle();
    expect(control(view.container, 'websites.website').value).toBe(other.id);
    expect(view.container.textContent).toContain(other.name);
    expect([...control(view.container, 'websites.website').querySelectorAll('option')]).toHaveLength(1);
  });

  it('keeps the website and shows the server error when removal fails', async () => {
    vi.mocked(api.removeSite).mockRejectedValue(new Error('Removal unavailable'));
    const view = mountTestComponent(<WebsitesPage />); await settle();
    act(() => { button(view.container, 'websites.removeSite').click(); }); await settle();
    act(() => { button(view.container, 'websites.delete').click(); }); await settle();
    expect(control(view.container, 'websites.website').value).toBe(base.id);
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('opens hosting directly, confirms removal of the last target and creates another', async () => {
    const view = mountTestComponent(<WebsitesPage />); await settle();
    act(() => { button(view.container, 'websites.manageHosting').click(); }); await settle();
    expect(view.container.querySelector('#websites-tab-hosting')?.getAttribute('aria-selected')).toBe('true');
    act(() => { button(view.container, 'websites.removeHosting').click(); }); await settle();
    expect(api.saveSite).not.toHaveBeenCalled();
    act(() => { button(view.container, 'websites.cancel').click(); }); await settle();
    expect(api.saveSite).not.toHaveBeenCalled();
    act(() => { button(view.container, 'websites.removeHosting').click(); }); await settle();
    act(() => { button(view.container, 'websites.delete').click(); }); await settle();
    expect(vi.mocked(api.saveSite).mock.calls[0]?.[0].targets).toEqual([]);
    expect(view.container.textContent).toContain('websites.noTargets');
    act(() => { button(view.container, 'websites.addTarget').click(); }); await settle(); await autosave();
    expect(vi.mocked(api.saveSite).mock.calls.at(-1)?.[0].targets).toEqual([expect.objectContaining({ adapter: 'local', environment: 'local', enabled: true })]);
    expect(view.container.textContent).not.toContain('websites.noTargets');
  });

  it('waits for pending edits before allowing website removal', async () => {
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'navigation');
    act(() => { changeInput(control(view.container, 'websites.siteName'), 'Edited name'); });
    expect(button(view.container, 'websites.removeSite').disabled).toBe(true);
    await autosave();
    expect(button(view.container, 'websites.removeSite').disabled).toBe(false);
  });

});
