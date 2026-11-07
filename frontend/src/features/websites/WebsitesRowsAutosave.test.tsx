import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import * as api from '../../shared/api/sites';
import WebsitesPage from './WebsitesPage';

vi.mock('../../shared/editor/InstructionMarkdownEditor', () => ({ InstructionMarkdownEditor: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => <textarea aria-label={label} value={value} onChange={event => { onChange(event.target.value); }} /> }));
vi.mock('../../shared/api/sites', () => Object.fromEntries(['editableSitePages', 'listSites', 'createSite', 'removeSite', 'siteCatalogue', 'getSite', 'saveSite', 'previewSite', 'publishSite', 'siteJobs', 'cancelJob', 'rollbackSite', 'exportTheme', 'importTheme', 'themeHistory', 'getServiceSettings', 'saveServiceSettings', 'serviceAction', 'getTargetConnection', 'saveTargetConnection', 'probeTarget', 'serveTarget', 'localTargetStatus', 'stopLocalTarget', 'previewSiteFont', 'previewSiteImage', 'previewSiteAsset', 'uploadSiteThemeAsset', 'siteFontCatalogue', 'importSiteFonts'].map(name => [name, vi.fn()])));
vi.mock('../../shared/api/request-context', () => ({ currentRequestContext: () => ({ userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' }) }));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('../../shared/ui/layout/AppHeader', () => ({ AppHeader: ({ children, title }: { children: React.ReactNode; title: string }) => <header><h1>{title}</h1>{children}</header> }));
vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t, i18n: { language: 'ca' } }) }; });

const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const autosave = async () => { await act(async () => { vi.advanceTimersByTime(650); await Promise.resolve(); }); await settle(); };
function button(container: HTMLElement, value: string) { const found = [...container.querySelectorAll('button')].find(element => element.textContent === value); if (!found) throw new Error(`Missing button ${value}`); return found; }
function tab(container: HTMLElement, name: string) { const item = container.querySelector<HTMLButtonElement>(`#websites-tab-${name}`); if (!item) throw new Error('Missing tab'); act(() => { item.click(); }); }
function changeInput(element: HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }
afterEach(() => { vi.useRealTimers(); });

it('autosaves nested row text after folding and leaving the page tab', async () => {
  vi.useFakeTimers();
  const site: api.SiteConfig = { id: 'rows', name: 'Rows', schema_version: 1, revision: 1, legacy_pilot: false, origin: 'https://example.invalid', languages: ['ca'], default_language: 'ca', targets: [], pages: [], sources: [], forms: [] };
  vi.mocked(api.listSites).mockResolvedValue([site]);
  vi.mocked(api.getSite).mockResolvedValue({ site, jobs: [], releases: [], service_available: false });
  vi.mocked(api.siteCatalogue).mockResolvedValue([]);
  vi.mocked(api.saveSite).mockImplementation(value => Promise.resolve({ ...value, revision: value.revision + 1 }));
  const view = mountTestComponent(<WebsitesPage />); await settle();
  tab(view.container, 'pages');
  act(() => { button(view.container, 'websites.addPage').click(); });
  act(() => { button(view.container, 'websites.rows.addRow').click(); });
  act(() => { button(view.container, 'websites.addColumn').click(); });
  const body = view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="websites.body"]');
  if (!body) throw new Error('Missing column rich text');
  act(() => { changeInput(body, '**Autosaved column**'); });
  const page = view.container.querySelector<HTMLDetailsElement>('.websites-card details');
  if (page) act(() => { page.open = false; page.dispatchEvent(new Event('toggle')); });
  tab(view.container, 'navigation');
  await autosave();
  const saved = vi.mocked(api.saveSite).mock.lastCall?.[0];
  expect(saved?.pages?.[0]?.blocks?.[0]).toMatchObject({ type: 'row', children: [{ body: '**Autosaved column**' }, { body: '' }] });
  tab(view.container, 'pages');
  expect(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="websites.body"]')?.value).toBe('**Autosaved column**');
});
