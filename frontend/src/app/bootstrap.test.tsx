import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
  calls: [] as string[], render: vi.fn<Root['render']>(),
  routing: vi.fn<() => Promise<void>>(), language: vi.fn<() => Promise<void>>(),
  canonical: vi.fn<(path: string) => string>(),
}));
vi.mock('react-dom/client', () => ({ createRoot: () => {
  mocks.calls.push('create-root'); return { render: mocks.render };
} }));
vi.mock('../shared/i18n/i18n', () => ({ default: {} }));
vi.mock('../shared/resources/fileResource', () => ({ syncActiveVaultCookie: () => { mocks.calls.push('cookie'); } }));
vi.mock('../shared/routing/vaultRouting', () => ({ initializeVaultRouting: mocks.routing, legacyBrowserPathToCanonical: mocks.canonical }));
vi.mock('./initialization/interfaceLanguage', () => ({ initializeInterfaceLanguage: mocks.language }));
vi.mock('./desktop/desktopMenu', () => ({ installDesktopApplicationMenu: () => { mocks.calls.push('menu'); } }));
vi.mock('../shared/ui/tooltip/GlobalTooltip', () => ({ GlobalTooltip: () => null }));
vi.mock('./App', () => ({ default: () => null }));
vi.mock('./AppProviders', () => ({ AppProviders: () => null }));

import { bootstrap } from './bootstrap';

beforeEach(() => {
  mocks.calls.length = 0; mocks.render.mockReset();
  mocks.routing.mockReset().mockImplementation(() => { mocks.calls.push('routing'); return Promise.resolve(); });
  mocks.language.mockReset().mockImplementation(() => { mocks.calls.push('language'); return Promise.resolve(); });
  mocks.canonical.mockReset().mockImplementation(path => path);
  const root = document.createElement('div'); root.id = 'root'; document.body.append(root);
});
afterEach(() => { document.body.replaceChildren(); window.history.replaceState(null, '', '/'); });

describe('ordered native application bootstrap', () => {
  it('sets the vault cookie before requests and awaits routing and language before rendering', async () => {
    let finishRouting: () => void = () => { throw new Error('Routing not initialized'); };
    let finishLanguage: () => void = () => { throw new Error('Language not initialized'); };
    mocks.routing.mockImplementation(() => new Promise<void>(resolve => { mocks.calls.push('routing'); finishRouting = resolve; }));
    mocks.language.mockImplementation(() => new Promise<void>(resolve => { mocks.calls.push('language'); finishLanguage = resolve; }));
    const pending = bootstrap();
    expect(mocks.calls).toEqual(['cookie', 'routing']); expect(mocks.render).not.toHaveBeenCalled();
    finishRouting(); await Promise.resolve();
    expect(mocks.calls).toEqual(['cookie', 'routing', 'language']); expect(mocks.render).not.toHaveBeenCalled();
    finishLanguage(); await pending;
    expect(mocks.calls).toEqual(['cookie', 'routing', 'language', 'menu', 'create-root']);
    expect(mocks.render).toHaveBeenCalledOnce();
  });

  it('canonicalizes a legacy URL without losing query, fragment or history state', async () => {
    window.history.replaceState({ retained: true }, '', '/vault/page?q=merc%C3%A8#section');
    mocks.canonical.mockReturnValue('/@fixture/knowledge/page');
    await bootstrap();
    expect(mocks.canonical).toHaveBeenCalledWith('/vault/page');
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe('/@fixture/knowledge/page?q=merc%C3%A8#section');
    expect(window.history.state).toEqual({ retained: true });
  });

  it.each(['/s/public-token', '/@fixture/knowledge/page'])('leaves non-legacy route %s intact', async path => {
    window.history.replaceState(null, '', path);
    await bootstrap(); expect(window.location.pathname).toBe(path);
  });

  it('does not replace a legacy URL with a noncanonical fallback', async () => {
    window.history.replaceState(null, '', '/vault'); mocks.canonical.mockReturnValue('/');
    await bootstrap(); expect(window.location.pathname).toBe('/vault');
  });

  it('fails explicitly if the mount point is missing without creating a root', async () => {
    document.body.replaceChildren();
    await expect(bootstrap()).rejects.toThrow('Gnosi root element was not found.');
    expect(mocks.calls).not.toContain('create-root'); expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each(['routing', 'language'] as const)('does not render after %s fails', async step => {
    mocks[step].mockRejectedValue(new Error('Initialization failed'));
    await expect(bootstrap()).rejects.toThrow('Initialization failed');
    expect(mocks.render).not.toHaveBeenCalled(); expect(mocks.calls).not.toContain('menu');
  });
});
