import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import * as api from '../../shared/api/sites';
import { FontManager } from './FontManager';
import type { AutosaveEntry } from './autosaveRequest';

vi.mock('../../shared/api/sites', () => ({ siteFontCatalogue: vi.fn(), importSiteFonts: vi.fn(), uploadSiteThemeAsset: vi.fn(), previewSiteAsset: vi.fn(), previewSiteImage: vi.fn() }));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const theme: api.SiteTheme = { name: 'Theme', tokens: {}, fonts: [], advanced_css: '', logo: '', logo_alt: '', favicon: '', schema_version: 1 };
const font: api.SiteFont = { family: 'Inter', src: '/.gnosi/sites/assets/site/inter.woff', weight: '400', style: 'normal' };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
function button(root: ParentNode, text: string) { const found = [...root.querySelectorAll('button')].find(item => item.textContent === text); if (!found) throw new Error('Missing button ' + text); return found; }
function inputValue(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }
function setup(options: { siteId?: string; current?: api.SiteTheme; changed?: (value: api.SiteTheme) => void; register?: (key: string, entry: AutosaveEntry | null) => void } = {}) {
  return <FontManager siteId={options.siteId ?? 'site'} revision={1} theme={options.current ?? theme} disabled={false} context={context} aliases={{ Inter: 'isolated-inter' }} sampleFailed={false} onChange={options.changed ?? vi.fn()} onUploadState={vi.fn()} register={options.register} />;
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.siteFontCatalogue).mockResolvedValue([{ id: 'google:Inter', family: 'Inter', provider: 'Google Fonts', license_url: 'https://fonts.google.com/specimen/Inter' }]); vi.mocked(api.previewSiteAsset).mockRejectedValue(new Error('No preview in test')); });

describe('Click-based website font manager', () => {
  it('imports a file using returned metadata, with no family/path entry, and preserves concurrent theme edits', async () => {
    let finish: (value: api.SiteThemeAsset) => void = () => undefined;
    vi.mocked(api.uploadSiteThemeAsset).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const changed = vi.fn(); const view = mountTestComponent(setup({ changed })); await settle();
    expect(view.container.querySelector('input:not([type="file"]):not([type="url"])')).toBeNull();
    act(() => { button(view.container, 'websites.importFont').click(); }); await settle();
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]'); if (!input) throw new Error('Missing file input');
    Object.defineProperty(input, 'files', { value: [new File(['valid font supplied by API'], 'opaque-file.woff')], configurable: true });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
    view.render(setup({ current: { ...theme, name: 'Edited during upload', tokens: { accent: '#123456' } }, changed }));
    act(() => { finish({ source: font.src, media_type: 'font/woff', font }); }); await settle();
    expect(changed).toHaveBeenLastCalledWith({ ...theme, name: 'Edited during upload', tokens: { accent: '#123456' }, fonts: [font] });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); view.unmount();
  });

  it('imports a Google URL, registers the pending request and uses the latest theme on completion', async () => {
    let finish: (value: api.SiteFont[]) => void = () => undefined;
    vi.mocked(api.importSiteFonts).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const changed = vi.fn(); const registrations = new Map<string, AutosaveEntry>();
    const register = (key: string, value: AutosaveEntry | null) => { if (value) registrations.set(key, value); else registrations.delete(key); };
    const view = mountTestComponent(setup({ changed, register })); await settle();
    const url = view.container.querySelector<HTMLInputElement>('input[type="url"]'); if (!url) throw new Error('Missing URL input');
    act(() => { inputValue(url, 'https://fonts.google.com/specimen/Inter'); });
    act(() => { button(view.container, 'websites.importFontUrl').click(); }); await settle();
    expect(api.importSiteFonts).toHaveBeenCalledWith('site', { url: 'https://fonts.google.com/specimen/Inter' }, context, expect.any(AbortSignal));
    expect(registrations.get('remote-font:site')?.pending).toBe(true);
    const pending = registrations.get('remote-font:site')?.flush();
    view.render(setup({ current: { ...theme, name: 'Latest name' }, changed, register }));
    act(() => { finish([font]); }); await settle();
    expect(await pending).toBe(true);
    expect(changed).toHaveBeenLastCalledWith({ ...theme, name: 'Latest name', fonts: [font] }); view.unmount();
  });

  it('does not attach a delayed font import to another website', async () => {
    let finish: (value: api.SiteFont[]) => void = () => undefined;
    vi.mocked(api.importSiteFonts).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const changed = vi.fn(); const view = mountTestComponent(setup({ changed })); await settle();
    const url = view.container.querySelector<HTMLInputElement>('input[type="url"]'); if (!url) throw new Error('Missing URL input');
    act(() => { inputValue(url, 'https://fonts.google.com/specimen/Inter'); }); act(() => { button(view.container, 'websites.importFontUrl').click(); }); await settle();
    const signal = vi.mocked(api.importSiteFonts).mock.calls[0]?.[3];
    view.render(setup({ siteId: 'another', changed })); await settle();
    expect(signal?.aborted).toBe(true);
    act(() => { finish([font]); }); await settle(); expect(changed).not.toHaveBeenCalled(); view.unmount();
  });

  it('selects a catalogue entry with clicks and imports without typing a URL', async () => {
    vi.mocked(api.importSiteFonts).mockResolvedValue([font]); const changed = vi.fn();
    const view = mountTestComponent(setup({ changed })); await settle();
    const catalogue = [...view.container.querySelectorAll('details')].find(item => item.querySelector(':scope > summary')?.textContent === 'websites.fontCatalogue'); if (!catalogue) throw new Error('Missing catalogue');
    const picker = catalogue.querySelector<HTMLElement>('[role="combobox"]'); if (!picker) throw new Error('Missing picker');
    act(() => { picker.click(); }); await settle();
    const option = document.querySelector<HTMLElement>('[data-property-dropdown] [role="option"]'); if (!option) throw new Error('Missing font option');
    act(() => { option.click(); }); await settle(); act(() => { button(catalogue, 'websites.addFont').click(); }); await settle();
    expect(api.importSiteFonts).toHaveBeenCalledWith('site', { catalogue_id: 'google:Inter' }, context, expect.any(AbortSignal));
    expect(changed).toHaveBeenCalledWith({ ...theme, fonts: [font] }); view.unmount();
  });

  it('uses an imported font with one click and resets the token when its last face is removed', async () => {
    const changed = vi.fn(); const current = { ...theme, fonts: [font] }; const view = mountTestComponent(setup({ current, changed })); await settle();
    expect(view.container.querySelector<HTMLElement>('p.websites-font-sample')?.style.fontFamily).toBe('isolated-inter');
    act(() => { button(view.container, 'websites.useFontBody').click(); });
    expect(changed).toHaveBeenLastCalledWith({ ...current, tokens: { 'font-body': '"Inter", serif' } });
    view.render(setup({ current: { ...current, tokens: { 'font-body': '"Inter", serif' } }, changed }));
    act(() => { button(view.container, 'websites.remove').click(); });
    expect(changed).toHaveBeenLastCalledWith({ ...theme, tokens: { 'font-body': 'Georgia, serif' }, fonts: [] }); view.unmount();
  });
});
