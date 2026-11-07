import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { currentRequestContext } from '../../shared/api/request-context';
import * as api from '../../shared/api/sites';
import WebsitesPage from './WebsitesPage';

vi.mock('../../shared/editor/InstructionMarkdownEditor', () => ({ InstructionMarkdownEditor: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => <textarea aria-label={label} value={value} onChange={event => { onChange(event.target.value); }} /> }));

vi.mock('../../shared/api/sites', () => Object.fromEntries(['editableSitePages', 'listSites', 'createSite', 'removeSite', 'siteCatalogue', 'getSite', 'saveSite', 'previewSite', 'publishSite', 'siteJobs', 'cancelJob', 'rollbackSite', 'exportTheme', 'importTheme', 'themeHistory', 'getServiceSettings', 'saveServiceSettings', 'serviceAction', 'getTargetConnection', 'saveTargetConnection', 'probeTarget', 'serveTarget', 'localTargetStatus', 'stopLocalTarget', 'previewSiteFont', 'previewSiteImage', 'previewSiteAsset', 'uploadSiteThemeAsset', 'siteFontCatalogue', 'importSiteFonts'].map(name => [name, vi.fn()])));
vi.mock('../../shared/api/request-context', () => ({ currentRequestContext: vi.fn() }));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('../../shared/ui/layout/AppHeader', () => ({ AppHeader: ({ children, title }: { children: React.ReactNode; title: string }) => <header><h1>{title}</h1>{children}</header> }));
vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t, i18n: { language: 'ca' } }) }; });

const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const base: api.SiteConfig = { id: 'test-site', name: 'Synthetic website', revision: 1, languages: ['ca', 'es', 'en-gb'], default_language: 'ca', origin: 'https://example.invalid', schema_version: 1, legacy_pilot: false, sources: [], pages: [], forms: [{ id: 'contact', name: 'Contact', enabled: false, revision: 1, privacy_url: '', require_privacy: false, title: { ca: 'Contacta', es: 'Contacto' }, fields: [{ id: 'email', type: 'email', required: true, label: { ca: 'Correu', es: 'Correo' }, help: {}, placeholder: {}, max_length: 2000, options: [] }] }], theme: { name: 'Synthetic', tokens: {}, advanced_css: '', schema_version: 1, logo: '', logo_alt: '', favicon: '' }, navigation: [], footer: [], social_links: [], redirects: {}, targets: [{ id: 'local', name: 'Local', enabled: true, environment: 'local', adapter: 'local', base_url: 'http://127.0.0.1:4321' }] };
const catalogue: api.CatalogueItem[] = [{ id: 'articles', kind: 'table', title: 'Articles', fields: [{ id: 'summary', name: 'Public summary', type: 'text' }, { id: 'notes', name: 'Private note', type: 'text' }] }];
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
function control(container: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement { const found = [...container.querySelectorAll('label')].find(element => element.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select'); if (!found) throw new Error(`Missing field ${label}`); return found as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; }
function changeInput(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }
function tab(container: HTMLElement, name: string) { const item = container.querySelector<HTMLButtonElement>(`#websites-tab-${name}`); if (!item) throw new Error('Missing tab'); act(() => { item.click(); }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(api.siteFontCatalogue).mockResolvedValue([]); vi.useFakeTimers();
  vi.mocked(api.previewSiteImage).mockRejectedValue(new Error('No synthetic image configured'));
  vi.mocked(api.editableSitePages).mockResolvedValue([]);
  vi.mocked(currentRequestContext).mockReturnValue(context);
  vi.mocked(api.listSites).mockResolvedValue([structuredClone(base)]);
  vi.mocked(api.siteCatalogue).mockResolvedValue(catalogue);
  vi.mocked(api.getSite).mockResolvedValue({ site: structuredClone(base), jobs: [], releases: [], service_available: true });
  vi.mocked(api.saveSite).mockImplementation(site => Promise.resolve({ ...site, revision: site.revision + 1 }));
  vi.mocked(api.localTargetStatus).mockResolvedValue({ running: false, url: 'http://127.0.0.1:4321' });
  vi.mocked(api.serveTarget).mockResolvedValue({ running: true, url: 'http://127.0.0.1:4321' });
  vi.mocked(api.stopLocalTarget).mockResolvedValue({ running: false, url: 'http://127.0.0.1:4321' });
  vi.mocked(api.getTargetConnection).mockResolvedValue({ local_port: 4321, host: '', username: '', port: 22, remote_root: '', ssh_key_reference: '', authentication: 'agent', identity_file: '', transfer_protocol: 'ssh', password_configured: false, document_root: '', remote_private_root: '' });
});
afterEach(() => { vi.useRealTimers(); });

describe('production destination persistence', () => {
  it('flushes environment before loading private settings', async () => {
    let finish: (value: api.SiteConfig) => void = () => { throw new Error('Missing save'); };
    vi.mocked(api.saveSite).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const privateValue: api.ServiceSettingsResponse = { configured: false, test_mode: false, delivery_transport: 'smtp', smtp_host: '', smtp_port: 587, smtp_username: '', smtp_security: 'starttls', sender_email: '', sender_name: '', password_configured: false, applied: false, forms: {} };
    vi.mocked(api.getServiceSettings).mockResolvedValue(privateValue);
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'hosting'); await settle();
    act(() => { changeInput(control(view.container, 'websites.environment'), 'production'); });
    tab(view.container, 'settings'); await settle();
    expect(api.saveSite).toHaveBeenCalled();
    expect(api.getServiceSettings).not.toHaveBeenCalled();
    const submitted = vi.mocked(api.saveSite).mock.calls[0]?.[0];
    expect(submitted?.targets?.[0]?.environment).toBe('production');
    if (!submitted) throw new Error('Missing submitted configuration');
    act(() => { finish({ ...submitted, revision: 2 }); }); await settle();
    expect(api.getServiceSettings).toHaveBeenCalled();
  });

});
