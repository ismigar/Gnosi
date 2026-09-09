import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTestStorage } from '../../../tests/api-request';
import { queryClient } from '../../shared/api/query-client';
import { ACTIVE_VAULT_NAME_KEY, storageGet } from '../../shared/api/vault-context';
import { useActiveVaultName } from '../../shared/hooks/useActiveVaultName';
import { activateVault, persistVaultCatalog, readVaultCatalog } from '../../shared/routing/vaultRouting';
import VaultMenu from './VaultMenu';
import VaultSwitcher from './VaultSwitcher';

const mocks = vi.hoisted(() => ({ fetchCatalog: vi.fn(), navigate: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/@principal/knowledge' }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../shared/api/vaults', () => ({
  fetchVaultCatalog: mocks.fetchCatalog,
  fetchVaultCatalogUncached: mocks.fetchCatalog,
  createVault: vi.fn(), deleteVault: vi.fn(),
}));
vi.mock('../../shared/ui/dialogs/ConfirmModal', () => ({ default: () => null }));
vi.mock('./VaultTemplateMarketplace', () => ({ default: () => null }));

const principal = { id: 'principal-id', name: 'Principal', slug: 'principal', path: '/vaults/principal', active: true };
const proves = { id: 'proves-id', name: 'Proves', slug: 'proves', path: '/vaults/proves', active: false };
const alias = { id: 'alias-id', name: 'Main Vault', slug: 'main-vault', path: principal.path, active: true };
const catalog = { vaults: [principal, proves, alias], active_path: principal.path };

function Name() { return <output>{useActiveVaultName()}</output>; }

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resetApiTestStorage();
  queryClient.clear();
  vi.clearAllMocks();
  mocks.fetchCatalog.mockResolvedValue(catalog);
  persistVaultCatalog(catalog.vaults);
  activateVault(principal, { notify: false });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  queryClient.clear();
  resetApiTestStorage();
});

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((item) => (
    item.textContent.trim() === name || item.getAttribute('aria-label') === name
  ));
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}

async function click(name: string) {
  await act(async () => { button(name).click(); await Promise.resolve(); });
}

describe.each([['menu', VaultMenu], ['settings', VaultSwitcher]] as const)('%s vault selection', (kind, Selector) => {
  async function open(name: string) {
    if (kind === 'menu') await click(`Vault: ${name}`);
  }

  it('keeps one selected identity and name through rapid switches with a stale duplicate-path catalog', async () => {
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><Selector /><Name /></QueryClientProvider>);
      await Promise.resolve();
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    await open('Principal');
    expect(document.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    expect(button('Principal').getAttribute('aria-pressed')).toBe('true');
    expect(button('Main Vault').getAttribute('aria-pressed')).toBe('false');

    for (const target of [proves, alias, principal]) {
      await click(target.name);
      await open(target.name);
      expect(document.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
      expect(button(target.name).getAttribute('aria-pressed')).toBe('true');
      expect(mocks.navigate).toHaveBeenLastCalledWith(`/@${target.slug}/knowledge`);
      expect(readVaultCatalog().filter((vault) => vault.active).map((vault) => vault.id)).toEqual([target.id]);
      expect(container.querySelector('output')?.textContent).toBe(target.name);
      expect(storageGet(ACTIVE_VAULT_NAME_KEY)).toBe(target.name);
    }
  });

  it('updates an open selector when navigation elsewhere changes the vault', async () => {
    await act(async () => { root.render(<Selector />); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    await open('Principal');
    await act(async () => { activateVault(proves); await Promise.resolve(); });
    expect(button('Proves').getAttribute('aria-pressed')).toBe('true');
    expect(button('Principal').getAttribute('aria-pressed')).toBe('false');
  });
});
