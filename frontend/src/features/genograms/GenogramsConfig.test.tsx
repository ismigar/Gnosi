import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ca from '../../shared/i18n/locales/ca/translation.json';
import en from '../../shared/i18n/locales/en/translation.json';
import es from '../../shared/i18n/locales/es/translation.json';
import fr from '../../shared/i18n/locales/fr/translation.json';
import GenogramsConfig from './GenogramsConfig';

const api = vi.hoisted(() => ({
  fetchGenogramSetupStatus: vi.fn<(vaultId: string) => Promise<{ ready: boolean }>>(),
  prepareGenograms: vi.fn<() => Promise<object>>(),
  genogramRequestContext: () => ({ vaultId: 'one', workspaceId: 'personal' }),
}));
const catalog = vi.hoisted(() => ({
  data: { vaults: [{ id: 'one', name: 'Principal', active: true }, { id: 'two', name: 'Família', active: false }] },
  isPending: false, isError: false, refetch: vi.fn(),
}));
const events = vi.hoisted(() => ({ emitAppEvent: vi.fn() }));
vi.mock('../../shared/api/genograms', () => api);
vi.mock('../../shared/api/useVaultCatalog', () => ({ useVaultCatalog: () => catalog }));
vi.mock('../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => true }) }));
vi.mock('../../shared/platform/app-events', () => events);

const resources = { ca: { translation: ca }, en: { translation: en }, es: { translation: es }, fr: { translation: fr } };
let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let translations: ReturnType<typeof createInstance>;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  catalog.isPending = false; catalog.isError = false;
  catalog.data.vaults = [{ id: 'one', name: 'Principal', active: true }, { id: 'two', name: 'Família', active: false }];
  api.fetchGenogramSetupStatus.mockResolvedValue({ ready: false });
  api.prepareGenograms.mockResolvedValue({});
  translations = createInstance();
  await translations.init({ lng: 'ca', resources, interpolation: { escapeValue: false } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  queryClient.clear();
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => { await Promise.resolve();
    root.render(<QueryClientProvider client={queryClient}><I18nextProvider i18n={translations}><GenogramsConfig /></I18nextProvider></QueryClientProvider>);
  });
}
async function settled(check: () => void) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  check();
}
function button() { return container.querySelector<HTMLButtonElement>('.btn-gnosi-primary'); }
async function select(vaultId: string) {
  await act(async () => { await Promise.resolve();
    const element = container.querySelector('select');
    if (!element) throw new Error('Vault selector missing');
    element.value = vaultId;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('prepares the selected vault with a styled button and replaces it with persistent status', async () => {
  await render();
  await settled(() => { expect(button()?.textContent).toContain('Prepara les taules'); });
  expect(container.querySelector('select')?.value).toBe('one');
  await select('two');
  await settled(() => { expect(button()).not.toBeNull(); });
  api.prepareGenograms.mockImplementation(() => {
    api.fetchGenogramSetupStatus.mockImplementation(id => Promise.resolve({ ready: id === 'two' }));
    return Promise.resolve({});
  });
  await act(async () => { await Promise.resolve(); button()?.click(); });
  await settled(() => {
    expect(api.prepareGenograms).toHaveBeenCalledWith('ca', 'two');
    expect(button()).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('ja estan creades a «Família»');
  });
  expect(events.emitAppEvent).not.toHaveBeenCalled();
  await select('one');
  await settled(() => { expect(button()).not.toBeNull(); });
  await select('two');
  await settled(() => { expect(button()).toBeNull(); });
});

it('restores preparation after a table is deleted and the window regains focus', async () => {
  api.fetchGenogramSetupStatus.mockResolvedValue({ ready: true });
  await render();
  await settled(() => { expect(container.textContent).toContain('ja estan creades'); });
  api.fetchGenogramSetupStatus.mockResolvedValue({ ready: false });
  await act(async () => { await Promise.resolve(); focusManager.setFocused(false); focusManager.setFocused(true); });
  await settled(() => { expect(button()?.textContent).toContain('Prepara les taules'); });
});

it('does not show a late status response from a previously selected vault', async () => {
  let finish: (value: { ready: boolean }) => void = () => undefined;
  api.fetchGenogramSetupStatus.mockImplementation(id => id === 'one'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ready: false }));
  await render();
  await select('two');
  await act(async () => { await Promise.resolve(); finish({ ready: true }); });
  await settled(() => {
    expect(container.querySelector('select')?.value).toBe('two');
    expect(button()).not.toBeNull();
    expect(container.textContent).not.toContain('ja estan creades');
  });
});

it.each(['ca', 'en', 'es', 'fr'] as const)('translates configuration, ready and error messages in %s', async locale => {
  await translations.changeLanguage(locale);
  api.fetchGenogramSetupStatus.mockResolvedValue({ ready: true });
  await render();
  await settled(() => {
    expect(container.textContent).toContain(resources[locale].translation.genograms.target_vault);
    expect(container.textContent).toContain(translations.t('genograms.tables_ready', { vault: 'Principal' }));
    expect(container.textContent).not.toContain('genograms.');
    expect(button()).toBeNull();
  });
  api.fetchGenogramSetupStatus.mockRejectedValue(new Error('Raw backend message'));
  await select('two');
  await settled(() => {
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(resources[locale].translation.genograms.status_error);
    expect(container.textContent).not.toContain('Raw backend message');
    expect(container.querySelector('button')?.textContent).toBe(translations.t('common.retry'));
  });
});

it('shows translated catalog failures and empty states without a creation action', async () => {
  catalog.isError = true;
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(ca.genograms.vaults_error);
  catalog.isError = false; catalog.data.vaults = [];
  await render();
  expect(container.textContent).toContain(ca.genograms.no_vaults);
  expect(container.querySelector('button')).toBeNull();
  expect(api.fetchGenogramSetupStatus).not.toHaveBeenCalled();
});
