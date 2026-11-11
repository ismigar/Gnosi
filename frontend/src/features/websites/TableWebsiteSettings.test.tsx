import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as api from '../../shared/api/sites';
import { TableWebsiteSettings } from './TableWebsiteSettings';

const context = { userId: 'operator', userEmail: '', workspaceId: 'workspace', vaultId: 'vault' };
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('../../shared/hooks/useRequestContext', () => ({ useRequestContext: () => context }));
vi.mock('../../shared/api/request-context', () => ({ currentRequestContext: () => context }));
vi.mock('../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => true }) }));
vi.mock('../../shared/api/sites', () => ({ listSites: vi.fn(), saveTableWebsiteBinding: vi.fn() }));
const sites = [{ id: 'site', name: 'Example', revision: 7, sources: [], targets: [{ id: 'local', enabled: true }] }] as unknown as api.SiteConfig[];
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.clearAllMocks(); });

it('chooses a website and fields, then saves only a table binding without publication', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(api.listSites).mockResolvedValue(sites);
    vi.mocked(api.saveTableWebsiteBinding).mockResolvedValue({ ...sites[0], revision: 8 } as api.SiteConfig);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    dispose = () => { act(() => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); };
    await act(async () => { root.render(<TableWebsiteSettings tableId="articles" tableName="Articles" fields={[{ id: 'title', name: 'Title', type: 'title' }]} />); await Promise.resolve(); });
    expect(api.saveTableWebsiteBinding).not.toHaveBeenCalled();
    const select = host.querySelector('select');
    if (!select) throw new Error('Website selection was not rendered');
    act(() => { select.value = 'site'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const toggle = host.querySelector<HTMLElement>('[role="switch"][aria-label="tableWebsite.title"]');
    if (!toggle) throw new Error('Website switch was not rendered');
    act(() => { toggle.click(); });
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'tableWebsite.save')?.click(); await Promise.resolve(); });
    expect(api.saveTableWebsiteBinding).toHaveBeenCalledWith('site', expect.objectContaining({ revision: 7, table_id: 'articles', section: '/content', enabled: true, field_ids: [], attachment_field_ids: [] }), context, expect.any(AbortSignal));
    expect(host.textContent).toContain('tableWebsite.saved');
});

it('updates the selected binding identity when its section changes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const source: api.SiteSource = { title: 'Articles', presentation: 'cards', selection_mode: 'selected', sort_descending: false, id: 'native', kind: 'table', source_id: 'articles', path_prefix: '/blog', enabled: true, include_body: true, field_ids: ['title'], attachment_field_ids: [] };
    const site = { ...sites[0], sources: [source] } as api.SiteConfig;
    vi.mocked(api.listSites).mockResolvedValue([site]);
    vi.mocked(api.saveTableWebsiteBinding).mockResolvedValue({ ...site, revision: 8, sources: [{ ...source, path_prefix: '/news' }] });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    dispose = () => { act(() => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); };
    await act(async () => { root.render(<TableWebsiteSettings tableId="articles" tableName="Articles" fields={[{ id: 'title', name: 'Title', type: 'title' }]} />); await Promise.resolve(); });
    const input = host.querySelector('input');
    if (!input) throw new Error('Section field was not rendered');
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!valueDescriptor?.set) throw new Error('Input setter is unavailable');
    act(() => { valueDescriptor.set?.call(input, '/news'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'tableWebsite.save')?.click(); await Promise.resolve(); });
    expect(api.saveTableWebsiteBinding).toHaveBeenCalledWith('site', expect.objectContaining({ source_id: 'native', section: '/news' }), context, expect.any(AbortSignal));
    expect(host.querySelector('input')?.value).toBe('/news');
});
