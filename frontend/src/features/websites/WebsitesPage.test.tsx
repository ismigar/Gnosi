import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { currentRequestContext } from '../../shared/api/request-context';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import * as api from '../../shared/api/sites';
import { GnosiApiError } from '../../shared/api/errors';
import WebsitesPage from './WebsitesPage';

vi.mock('../../shared/api/sites', () => Object.fromEntries(['listSites', 'createSite', 'siteCatalogue', 'getSite', 'saveSite', 'previewSite', 'publishSite', 'siteJobs', 'cancelJob', 'rollbackSite', 'exportTheme', 'importTheme', 'themeHistory', 'getServiceSettings', 'saveServiceSettings', 'serviceAction', 'getTargetConnection', 'saveTargetConnection', 'probeTarget', 'serveTarget', 'localTargetStatus', 'stopLocalTarget'].map(name => [name, vi.fn()])));
vi.mock('../../shared/api/request-context', () => ({ currentRequestContext: vi.fn() }));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('../../shared/ui/layout/AppHeader', () => ({ AppHeader: ({ children, title }: { children: React.ReactNode; title: string }) => <header><h1>{title}</h1>{children}</header> }));
vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t, i18n: { language: 'ca' } }) }; });

const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const base: api.SiteConfig = { id: 'test-site', name: 'Synthetic website', revision: 1, languages: ['ca', 'es', 'en-gb'], default_language: 'ca', origin: 'https://example.invalid', schema_version: 1, legacy_pilot: false, sources: [], pages: [], forms: [{ id: 'contact', name: 'Contact', enabled: false, revision: 1, privacy_url: '', require_privacy: false, title: { ca: 'Contacta', es: 'Contacto' }, fields: [{ id: 'email', type: 'email', required: true, label: { ca: 'Correu', es: 'Correo' }, help: {}, placeholder: {}, max_length: 2000, options: [] }] }], theme: { name: 'Synthetic', tokens: {}, advanced_css: '', schema_version: 1, logo: '', logo_alt: '', favicon: '' }, navigation: [], footer: [], social_links: [], redirects: {}, targets: [{ id: 'local', name: 'Local', enabled: true, environment: 'local', adapter: 'local', base_url: 'http://127.0.0.1:4321' }] };
const catalogue: api.CatalogueItem[] = [{ id: 'articles', kind: 'table', title: 'Articles', fields: [{ id: 'summary', name: 'Public summary', type: 'text' }, { id: 'notes', name: 'Private note', type: 'text' }] }];
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
function button(container: HTMLElement, value: string) { const found = [...container.querySelectorAll('button')].find(element => element.textContent === value); if (!found) throw new Error(`Missing button ${value}`); return found; }
function control(container: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement { const found = [...container.querySelectorAll('label')].find(element => element.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select'); if (!found) throw new Error(`Missing field ${label}`); return found as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; }
function changeInput(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }
function tab(container: HTMLElement, name: string) { const item = container.querySelector<HTMLButtonElement>(`#websites-tab-${name}`); if (!item) throw new Error('Missing tab'); act(() => { item.click(); }); }

beforeEach(() => {
  vi.resetAllMocks();
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

describe('Webs manager', () => {
  it('loads existing websites despite a catalogue conflict and still refuses a failed publication review', async () => {
    const conflict = new GnosiApiError(new Response(null, { status: 409 }), { detail: 'Duplicate note identities must be resolved before publication' });
    vi.mocked(api.siteCatalogue).mockRejectedValue(conflict);
    vi.mocked(api.previewSite).mockRejectedValue(conflict);
    const view = mountTestComponent(<WebsitesPage />); await settle();
    expect(control(view.container, 'websites.website').value).toBe(base.id);
    expect(view.container.textContent).toContain(conflict.message);
    expect(api.getSite).toHaveBeenCalledWith(base.id, context, expect.any(AbortSignal));
    tab(view.container, 'publishing'); await settle();
    act(() => { button(view.container, 'websites.reviewChanges').click(); }); await settle();
    expect(button(view.container, 'websites.publishReviewed').disabled).toBe(true);
    expect(api.publishSite).not.toHaveBeenCalled();
  });

  it('keeps a new source and its fields private until explicitly selected and saves only the chosen field', async () => {
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'sources');
    act(() => { button(view.container, 'websites.addSource').click(); });
    const switches = [...view.container.querySelectorAll<HTMLElement>('[role="switch"]')];
    expect(switches.every(item => item.getAttribute('aria-checked') === 'false')).toBe(true);
    act(() => { view.container.querySelector<HTMLElement>('[role="switch"][aria-label="Public summary"]')?.click(); });
    act(() => { view.container.querySelector<HTMLElement>('[role="switch"][aria-label="websites.publishSource"]')?.click(); });
    act(() => { changeInput(control(view.container, 'websites.recordSelection'), 'selected'); });
    act(() => { button(view.container, 'websites.save').click(); }); await settle();
    const sent = vi.mocked(api.saveSite).mock.calls[0]?.[0];
    expect(sent?.sources?.[0]).toMatchObject({ enabled: true, field_ids: ['summary'], include_body: false, attachment_field_ids: [], selection_mode: 'selected', page_ids: [] });
    expect(sent?.sources?.[0]?.field_ids).not.toContain('notes');
    expect(vi.mocked(api.saveSite).mock.calls[0]?.[1]).toEqual(context);
    expect(button(view.container, 'websites.save').disabled).toBe(true);
  });

  it('edits localized contact labels without overwriting another language and persists the form configuration', async () => {
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'forms');
    act(() => { changeInput(control(view.container, 'websites.fieldLabel'), 'Correu de contacte'); });
    act(() => { changeInput(control(view.container, 'websites.editingLanguage'), 'es'); });
    expect(control(view.container, 'websites.fieldLabel').value).toBe('Correo');
    act(() => { button(view.container, 'websites.save').click(); }); await settle();
    const field = vi.mocked(api.saveSite).mock.calls[0]?.[0].forms?.[0]?.fields?.[0];
    expect(field?.label).toEqual({ ca: 'Correu de contacte', es: 'Correo' });
    expect(field?.required).toBe(true);
  });

  it.each(['languages', 'options', 'gallery', 'filter'])('keeps typed delimiters in %s and saves the complete list on the first click', async kind => {
    const initial = structuredClone(base);
    initial.languages = ['ca'];
    vi.mocked(api.listSites).mockResolvedValue([initial]);
    vi.mocked(api.getSite).mockResolvedValue({ site: initial, jobs: [], releases: [], service_available: true });
    const view = mountTestComponent(<WebsitesPage />); await settle();
    let label = 'websites.languages'; let text = ',es';
    if (kind === 'languages') tab(view.container, 'navigation');
    if (kind === 'options') {
      tab(view.container, 'forms');
      act(() => { changeInput(control(view.container, 'websites.fieldType'), 'select'); });
      label = 'websites.options'; text = 'First, item\nSecond';
    }
    if (kind === 'gallery') {
      tab(view.container, 'pages');
      act(() => { button(view.container, 'websites.addPage').click(); });
      act(() => { button(view.container, 'websites.addBlock').click(); });
      act(() => { changeInput(control(view.container, 'websites.blockType'), 'gallery'); });
      label = 'websites.galleryImages'; text = '/first.png\n/second.png';
    }
    if (kind === 'filter') {
      tab(view.container, 'sources');
      act(() => { button(view.container, 'websites.addSource').click(); });
      act(() => { button(view.container, 'websites.addFilter').click(); });
      act(() => { changeInput(control(view.container, 'websites.operator'), 'in'); });
      label = 'websites.value'; text = 'first,second';
    }
    const field = control(view.container, label);
    let expected = field.value;
    for (const character of text) {
      expected += character;
      act(() => { changeInput(field, field.value + character); });
      expect(field.value).toBe(expected);
    }
    expect(button(view.container, 'websites.save').disabled).toBe(false);
    act(() => { button(view.container, 'websites.save').click(); }); await settle();
    expect(api.saveSite).toHaveBeenCalledOnce();
    const saved = vi.mocked(api.saveSite).mock.calls[0]?.[0];
    if (kind === 'languages') expect(saved?.languages).toEqual(['ca', 'es']);
    if (kind === 'options') expect(saved?.forms?.[0]?.fields?.[0]?.options).toEqual(['First, item', 'Second']);
    if (kind === 'gallery') expect(saved?.pages?.[0]?.blocks?.[0]?.images).toEqual(['/first.png', '/second.png']);
    if (kind === 'filter') expect(saved?.sources?.[0]?.filters?.[0]?.value).toEqual(['first', 'second']);
    expect(button(view.container, 'websites.save').disabled).toBe(true);
  });

  it('offers theme import through a focusable native button wired to the file picker', async () => {
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'appearance');
    const trigger = button(view.container, 'websites.importTheme');
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error('Missing file input');
    const open = vi.spyOn(fileInput, 'click').mockImplementation(() => undefined);
    act(() => { trigger.focus(); });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.type).toBe('button');
    act(() => { trigger.click(); });
    expect(open).toHaveBeenCalledOnce();
  });

  it('invalidates the reviewed version after any configuration edit and never publishes an unreviewed change', async () => {
    vi.mocked(api.previewSite).mockResolvedValue({ id: 'reviewed', site_id: base.id, target_id: 'local', fingerprint: 'hash', changes: [], expires_at: '2030-01-01T00:00:00Z', warnings: [] });
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'publishing'); await settle();
    expect(button(view.container, 'websites.publishReviewed').disabled).toBe(true);
    act(() => { button(view.container, 'websites.reviewChanges').click(); }); await settle();
    expect(button(view.container, 'websites.publishReviewed').disabled).toBe(false);
    tab(view.container, 'navigation');
    act(() => { changeInput(control(view.container, 'websites.siteName'), 'Updated title'); });
    tab(view.container, 'publishing'); await settle();
    expect(button(view.container, 'websites.publishReviewed').disabled).toBe(true);
    expect(api.publishSite).not.toHaveBeenCalled();
    expect(view.container.querySelector('iframe')?.getAttribute('sandbox')).toBeUndefined();
  });

  it('clears the old vault and ignores a late response after the context changes', async () => {
    let finish: (value: api.SiteStatus) => void = () => undefined;
    vi.mocked(api.getSite).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = mountTestComponent(<WebsitesPage />); await settle();
    const signal = vi.mocked(api.getSite).mock.calls[0]?.[2];
    vi.mocked(currentRequestContext).mockReturnValue({ ...context, vaultId: 'second-vault' });
    vi.mocked(api.listSites).mockReturnValue(new Promise(() => undefined));
    act(() => { dispatchWindowEvent(new Event('storage')); }); await settle();
    expect(signal?.aborted).toBe(true);
    expect(view.container.textContent).not.toContain('Synthetic website');
    act(() => { finish({ site: base, jobs: [], releases: [], service_available: true }); }); await settle();
    expect(view.container.textContent).not.toContain('Synthetic website');
  });

  it('starts and stops only the selected local destination and reflects the returned server status', async () => {
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'publishing'); await settle();
    expect(button(view.container, 'websites.stopLocal').disabled).toBe(true);
    act(() => { button(view.container, 'websites.startLocal').click(); }); await settle();
    expect(api.serveTarget).toHaveBeenCalledWith('test-site', 'local', context, expect.any(AbortSignal));
    expect(button(view.container, 'websites.stopLocal').disabled).toBe(false);
    expect(button(view.container, 'websites.startLocal').disabled).toBe(true);
    act(() => { button(view.container, 'websites.stopLocal').click(); }); await settle();
    expect(api.stopLocalTarget).toHaveBeenCalledWith('test-site', 'local', context, expect.any(AbortSignal));
    expect(view.container.textContent).toContain('websites.serverStopped');
    expect(button(view.container, 'websites.stopLocal').disabled).toBe(true);
  });

  it('shows the newly published current release after the final poll without manual refresh', async () => {
    vi.useFakeTimers();
    const queued: api.SiteJob = { id: 'new-publication', site_id: base.id, target_id: 'local', phase: 'prepare', status: 'queued' };
    const running: api.SiteJob = { ...queued, phase: 'build', status: 'running' };
    const completed: api.SiteJob = { ...queued, phase: 'completed', status: 'completed', release_id: 'new-release' };
    let finish: (value: api.SiteStatus) => void = () => undefined;
    vi.mocked(api.getSite).mockResolvedValueOnce({ site: structuredClone(base), jobs: [], releases: [], service_available: true }).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    vi.mocked(api.previewSite).mockResolvedValue({ id: 'review', site_id: base.id, target_id: 'local', fingerprint: 'hash', changes: [], expires_at: '2030-01-01T00:00:00Z', warnings: [] });
    vi.mocked(api.publishSite).mockResolvedValue(queued);
    vi.mocked(api.siteJobs).mockResolvedValueOnce([running]).mockResolvedValueOnce([completed]);
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'publishing'); await settle();
    act(() => { button(view.container, 'websites.reviewChanges').click(); }); await settle();
    act(() => { button(view.container, 'websites.publishReviewed').click(); }); await settle();
    act(() => { vi.advanceTimersByTime(3000); }); await settle();
    expect(view.container.textContent).toContain('websites.phases.build');
    act(() => { vi.advanceTimersByTime(3000); }); await settle();
    expect(api.getSite).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain('websites.noReleases');
    // A slow final read must neither overlap another poll nor lose its response.
    act(() => { vi.advanceTimersByTime(3000); }); await settle();
    expect(api.siteJobs).toHaveBeenCalledTimes(2);
    act(() => { finish({ site: structuredClone(base), jobs: [completed], releases: [{ id: 'new-release', site_id: base.id, target_id: 'local', created_at: '2030-01-01T00:00:00Z', fingerprint: 'hash', current: true, url: 'https://example.invalid/new-current-release' }], service_available: true }); }); await settle();
    expect(view.container.textContent).toContain('websites.phases.completed');
    expect(view.container.textContent).toContain('websites.currentRelease');
    expect(view.container.querySelector('a[href="https://example.invalid/new-current-release"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('websites.noReleases');
    act(() => { vi.advanceTimersByTime(6000); }); await settle();
    expect(api.siteJobs).toHaveBeenCalledTimes(2);
    expect(api.getSite).toHaveBeenCalledTimes(2);
  });

  it('uses the managed Pangea bridge probe without generic SSH settings or connection writes', async () => {
    const managedSite = structuredClone(base);
    managedSite.legacy_pilot = true;
    managedSite.targets = [{ id: 'pangea', name: 'Pangea pilot', adapter: 'legacy-pangea', environment: 'staging', enabled: true, base_url: 'https://example.invalid/_gnosi-pilot' }];
    vi.mocked(api.listSites).mockResolvedValue([managedSite]);
    vi.mocked(api.getSite).mockResolvedValue({ site: managedSite, jobs: [], releases: [], service_available: true });
    vi.mocked(api.probeTarget).mockResolvedValue({ configured: true, reachable: true, detail: 'staging' });
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'publishing'); await settle();
    expect(view.container.textContent).toContain('websites.managedBridgeHelp');
    expect(api.getTargetConnection).not.toHaveBeenCalled();
    const labels = [...view.container.querySelectorAll('label > span')].map(item => item.textContent);
    for (const label of ['host', 'username', 'port', 'remoteRoot', 'documentRoot', 'remotePrivateRoot']) expect(labels).not.toContain(`websites.${label}`);
    expect([...view.container.querySelectorAll('button')].some(item => item.textContent === 'websites.saveConnection')).toBe(false);
    act(() => { button(view.container, 'websites.testConnection').click(); }); await settle();
    expect(api.probeTarget).toHaveBeenCalledWith('test-site', 'pangea', context, expect.any(AbortSignal));
    expect(view.container.textContent).toContain('websites.connectionReady');
    expect(api.saveTargetConnection).not.toHaveBeenCalled();
  });

  it('translates the active-release worker startup warning instead of showing its raw error code', async () => {
    vi.mocked(api.getSite).mockResolvedValue({ site: structuredClone(base), jobs: [{ id: 'published', site_id: base.id, target_id: 'local', phase: 'completed', status: 'completed', error: 'worker_start_pending' }], releases: [], service_available: true });
    const view = mountTestComponent(<WebsitesPage />); await settle(); tab(view.container, 'publishing'); await settle();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('websites.jobErrors.worker_start_pending');
    expect(view.container.textContent).toContain('websites.states.completed');
    expect(api.publishSite).not.toHaveBeenCalled();
  });

  it('bounds an unresponsive initial request and offers refresh instead of endless loading', async () => {
    vi.useFakeTimers();
    vi.mocked(api.listSites).mockReturnValue(new Promise(() => undefined));
    const view = mountTestComponent(<WebsitesPage />); await settle();
    expect(view.container.textContent).toContain('websites.loading');
    await act(async () => { vi.advanceTimersByTime(65_001); await Promise.resolve(); }); await settle();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('websites.loadFailed');
    expect(view.container.textContent).not.toContain('websites.loading');
    expect(view.container.querySelector<HTMLButtonElement>('button[aria-label="common.refresh"]')?.disabled).toBe(false);
  });
});
