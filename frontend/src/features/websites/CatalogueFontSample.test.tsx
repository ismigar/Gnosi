import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { previewCatalogueFont } from '../../shared/api/sites';
import { CatalogueFontSample } from './CatalogueFontSample';
vi.mock('../../shared/api/sites', () => ({ previewCatalogueFont: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => { vi.unstubAllGlobals(); });
it('loads the catalogue face into an isolated alias and removes it on close', async () => {
  const add = vi.fn(); const remove = vi.fn();
  const original = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add, delete: remove } });
  vi.stubGlobal('IntersectionObserver', undefined);
  const faces: object[] = [];
  vi.stubGlobal('FontFace', class { constructor(public family: string) { faces.push(this); } load() { return Promise.resolve(this); } });
  vi.mocked(previewCatalogueFont).mockResolvedValue({ size: 100, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) } as Blob);
  const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
  try {
    const view = mountTestComponent(<CatalogueFontSample id="google:Roboto" family="Roboto" provider="Google Fonts" context={context} />);
    await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
    expect(previewCatalogueFont).toHaveBeenCalledWith('google:Roboto', context, expect.any(AbortSignal));
    expect(view.container.querySelector('[data-font-loaded="true"]')?.getAttribute('style')).toContain('GnosiCatalogue-');
    expect(add).toHaveBeenCalledWith(faces[0]);
    view.unmount(); expect(remove).toHaveBeenCalledWith(faces[0]);
  } finally { if (original) Object.defineProperty(document, 'fonts', original); else Reflect.deleteProperty(document, 'fonts'); }
});
