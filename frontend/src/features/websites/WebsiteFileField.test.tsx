import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { WebsiteAssetProvider, WebsiteFileField } from './WebsiteFileField';
import { previewSiteAsset, previewSiteImage, uploadSiteThemeAsset } from '../../shared/api/sites';
vi.mock('../../shared/api/sites', () => ({ previewSiteAsset: vi.fn(), previewSiteImage: vi.fn(), uploadSiteThemeAsset: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); class BlobURL extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic'); static revokeObjectURL = vi.fn(); } vi.stubGlobal('URL', BlobURL); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test('uploads an attachment through a modal and exposes its authenticated blob download', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-document'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.mocked(previewSiteAsset).mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
  vi.mocked(uploadSiteThemeAsset).mockResolvedValue({ source: '/.gnosi/sites/assets/site/guide.pdf', media_type: 'application/pdf' });
  let value = '';
  const render = () => <WebsiteAssetProvider siteId="site" context={context}><WebsiteFileField label="Document" value={value} onChange={next => { value = next; view.render(render()); }} /></WebsiteAssetProvider>;
  const view = mountTestComponent(render());
  act(() => { view.container.querySelector<HTMLButtonElement>('button')?.click(); }); await settle();
  const modal = document.querySelector('[role="dialog"]'); expect(modal).not.toBeNull();
  const input = modal?.querySelector<HTMLInputElement>('input[type="file"]'); if (!input) throw new Error('Missing modal upload');
  const file = new File(['%PDF-1.7'], 'guide.pdf', { type: 'application/pdf' }); Object.defineProperty(input, 'files', { value: [file] });
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
  expect(uploadSiteThemeAsset).toHaveBeenCalledWith('site', file, 'file', context, expect.any(AbortSignal));
  expect(value).toBe('/.gnosi/sites/assets/site/guide.pdf'); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(view.container.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('blob:synthetic-document');
  expect(view.container.querySelector<HTMLAnchorElement>('a')?.download).toBe('guide.pdf'); view.unmount();
});
test('shows a selected image thumbnail and does not treat it as an attachment', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-image'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.mocked(previewSiteImage).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  const view = mountTestComponent(<WebsiteAssetProvider siteId="site" context={context}><WebsiteFileField kind="image" label="Image" value="/selected.png" onChange={() => undefined} /></WebsiteAssetProvider>); await settle();
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:synthetic-image'); expect(view.container.querySelector('a')).toBeNull(); view.unmount();
});


test('keeps an existing thumbnail alive while refreshing the same saved reference', async () => {
  const make = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  vi.mocked(previewSiteImage).mockResolvedValueOnce(new Blob(['first'], { type: 'image/png' }));
  const render = (revision: number) => <WebsiteAssetProvider siteId="site" revision={revision} context={context}><WebsiteFileField kind="image" label="Image" value="/selected.png" onChange={() => undefined} /></WebsiteAssetProvider>;
  const view = mountTestComponent(render(1)); await settle();
  expect(make).toHaveBeenCalledOnce();
  let finish: (blob: Blob) => void = () => undefined;
  vi.mocked(previewSiteImage).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  view.render(render(2)); await settle();
  expect(revoke).not.toHaveBeenCalledWith('blob:first');
  act(() => { finish(new Blob(['second'], { type: 'image/png' })); }); await settle();
  expect(revoke).toHaveBeenCalledWith('blob:first');
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:second'); view.unmount();
});
