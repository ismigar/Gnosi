import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { currentRequestContext } from '../../shared/api/request-context';
import * as api from '../../shared/api/sites';
import WebsitesPage from './WebsitesPage';

vi.mock('../../shared/api/sites', () => Object.fromEntries(['listSites', 'createSite', 'siteCatalogue', 'getSite', 'saveSite', 'previewSite', 'publishSite', 'siteJobs', 'cancelJob', 'rollbackSite', 'exportTheme', 'importTheme', 'themeHistory', 'getServiceSettings', 'saveServiceSettings', 'serviceAction', 'getTargetConnection', 'saveTargetConnection', 'probeTarget', 'serveTarget', 'localTargetStatus', 'stopLocalTarget', 'previewSiteFont', 'previewSiteImage', 'uploadSiteThemeAsset'].map(name => [name, vi.fn()])));
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

describe('Webs appearance and nonblocking navigation', () => {
  it('opens immediately without reading the vault catalogue and reuses it between content tabs', async () => {
    let finish: (items: api.CatalogueItem[]) => void = () => undefined;
    vi.mocked(api.siteCatalogue).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = mountTestComponent(<WebsitesPage />); await settle();
    expect(view.container.querySelector('#websites-tab-appearance')).not.toBeNull();
    expect(api.siteCatalogue).not.toHaveBeenCalled();
    tab(view.container, 'appearance'); await settle();
    expect(api.siteCatalogue).not.toHaveBeenCalled();
    tab(view.container, 'sources'); await settle();
    expect(view.container.textContent).toContain('websites.catalogueLoading');
    tab(view.container, 'appearance'); tab(view.container, 'sources'); await settle();
    expect(api.siteCatalogue).toHaveBeenCalledOnce();
    act(() => { finish(catalogue); }); await settle();
    tab(view.container, 'appearance'); tab(view.container, 'sources'); await settle();
    expect(api.siteCatalogue).toHaveBeenCalledOnce();
    expect(view.container.querySelector('[aria-label="websites.addSource"]')).not.toBeNull();
    expect(api.saveSite).not.toHaveBeenCalled(); view.unmount();
  });

  it('uploads a logo without overwriting edits made during the upload and autosaves its reference', async () => {
    let finish: (asset: { source: string; media_type: string }) => void = () => undefined;
    vi.mocked(api.uploadSiteThemeAsset).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(api.previewSiteImage).mockRejectedValue(new Error('Synthetic thumbnail unavailable'));
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'appearance');
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"][accept*=".png"]');
    if (!input) throw new Error('Missing image upload');
    const file = new File(['image'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
    act(() => { changeInput(control(view.container, 'websites.themeName'), 'Changed during upload'); });
    tab(view.container, 'navigation'); await settle();
    expect(view.container.querySelector('#websites-tab-appearance')?.getAttribute('aria-selected')).toBe('true');
    act(() => { finish({ source: '/.gnosi/sites/assets/test-site/logo.png', media_type: 'image/png' }); }); await settle(); await autosave();
    expect(view.container.querySelector('#websites-tab-navigation')?.getAttribute('aria-selected')).toBe('true');
    expect(api.uploadSiteThemeAsset).toHaveBeenCalledWith('test-site', file, 'image', context, expect.any(AbortSignal));
    expect(vi.mocked(api.saveSite).mock.calls.at(-1)?.[0].theme).toMatchObject({ name: 'Changed during upload', logo: '/.gnosi/sites/assets/test-site/logo.png' });
    view.unmount();
  });

  it('finishes an upload for its original site before creating and selecting another site', async () => {
    let finish: (asset: { source: string; media_type: string }) => void = () => undefined;
    vi.mocked(api.uploadSiteThemeAsset).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(api.previewSiteImage).mockRejectedValue(new Error('Synthetic thumbnail unavailable'));
    const nextSite = { ...structuredClone(base), id: 'next-site', name: 'Next site' };
    vi.mocked(api.createSite).mockResolvedValue(nextSite);
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'appearance');
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"][accept*=".png"]');
    if (!input) throw new Error('Missing image upload');
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'logo.png', { type: 'image/png' })], configurable: true });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
    act(() => { button(view.container, 'websites.createSite').click(); }); await settle();
    act(() => { changeInput(control(view.container, 'websites.siteName'), 'Next site'); });
    act(() => { button(view.container, 'websites.create').click(); }); await settle();
    expect(api.createSite).not.toHaveBeenCalled();
    expect(control(view.container, 'websites.website').value).toBe(base.id);
    act(() => { finish({ source: '/.gnosi/sites/assets/test-site/logo.png', media_type: 'image/png' }); }); await settle(); await autosave();
    expect(api.createSite).toHaveBeenCalledOnce();
    expect(control(view.container, 'websites.website').value).toBe(nextSite.id);
    const saves = vi.mocked(api.saveSite).mock.calls.map(([site]) => site);
    expect(saves.some(site => site.id === base.id && site.theme?.logo === '/.gnosi/sites/assets/test-site/logo.png')).toBe(true);
    expect(saves.some(site => site.id === nextSite.id && site.theme?.logo)).toBe(false);
    expect(view.container.querySelector('#websites-tab-overview')?.getAttribute('aria-selected')).toBe('true');
    view.unmount();
  });

  it('searches typefaces with real isolated font samples and saves only the chosen typography token', async () => {
    const oldFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    const oldFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace');
    const add = vi.fn(); const remove = vi.fn();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add, delete: remove } });
    class SampleFace { constructor(public family: string) {} load() { return Promise.resolve(this); } }
    vi.stubGlobal('FontFace', SampleFace);
    const initial = structuredClone(base);
    if (!initial.theme) throw new Error('Missing fixture theme');
    initial.theme.tokens = { 'font-body': '"Crimson Pro", Georgia, serif', 'font-heading': '"Nunito", system-ui, sans-serif' };
    initial.theme.fonts = [{ family: 'Crimson Pro', src: '/fonts/crimson.woff2', weight: '400', style: 'normal' }, { family: 'Nunito', src: '/fonts/nunito.woff2', weight: '400', style: 'normal' }];
    vi.mocked(api.listSites).mockResolvedValue([initial]);
    vi.mocked(api.getSite).mockResolvedValue({ site: initial, jobs: [], releases: [], service_available: true });
    const blob = new Blob(['wOF2font']);
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(8)) });
    vi.mocked(api.previewSiteFont).mockResolvedValue(blob);
    const view = mountTestComponent(<WebsitesPage />);
    try {
      await settle(); tab(view.container, 'appearance'); await settle();
      const family = control(view.container, 'websites.fontFamily');
      for (const value of ['Cr', 'Cri', 'Crimson Pro']) {
        act(() => { changeInput(family, value); vi.advanceTimersByTime(80); });
      }
      expect(api.previewSiteFont).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(250); }); await settle(); await settle();
      expect(add).toHaveBeenCalledTimes(2);
      act(() => { changeInput(control(view.container, 'websites.themeName'), 'Renamed'); }); await autosave();
      expect(api.previewSiteFont).toHaveBeenCalledTimes(2);
      vi.mocked(api.saveSite).mockClear();
      const picker = view.container.querySelector<HTMLElement>('[role="combobox"][aria-label="websites.tokens.font-body"]');
      if (!picker) throw new Error('Missing typeface selector');
      act(() => { picker.click(); }); await settle();
      const search = document.querySelector<HTMLInputElement>('[data-property-dropdown] input');
      if (!search) throw new Error('Missing autocomplete search');
      expect(document.querySelectorAll('[data-property-dropdown] [role="option"]').length).toBeGreaterThan(20);
      act(() => { changeInput(search, 'nuni'); }); await settle();
      const options = [...document.querySelectorAll<HTMLElement>('[data-property-dropdown] [role="option"]')];
      expect(options).toHaveLength(1);
      expect(options[0]?.textContent).toContain('Nunito');
      expect(options[0]?.querySelector<HTMLElement>('.websites-font-sample')?.style.fontFamily).toContain('GnosiWebFont-test-site-1');
      act(() => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); await settle();
      expect(document.querySelector('[data-property-dropdown]')).toBeNull();
      expect(document.activeElement).toBe(picker);
      await autosave();
      expect(vi.mocked(api.saveSite).mock.calls[0]?.[0].theme?.tokens).toEqual({ 'font-body': '"Nunito", Georgia, serif', 'font-heading': '"Nunito", system-ui, sans-serif' });
      view.unmount(); expect(remove).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      if (oldFonts) Object.defineProperty(document, 'fonts', oldFonts); else Reflect.deleteProperty(document, 'fonts');
      if (oldFace) Object.defineProperty(globalThis, 'FontFace', oldFace); else Reflect.deleteProperty(globalThis, 'FontFace');
    }
  });

});
