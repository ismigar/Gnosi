import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitVaultNameChanged } from '../../lib/configEvents';
import * as storage from '../platform/browser-storage';
import { useActiveVaultName } from './useActiveVaultName';

const query = vi.hoisted(() => ({
  data: undefined as { vaults: Array<{ active: boolean; name: string }> } | undefined,
  refetch: vi.fn(),
}));
vi.mock('../api/useVaultCatalog', () => ({ useVaultCatalog: () => query }));
const key = storage.defineStorageKey('gnosi_active_vault_name', storage.stringStorageCodec);
let root: Root | null;
let container: HTMLDivElement;
function Probe() { return <output>{useActiveVaultName()}</output>; }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  query.data = undefined;
  query.refetch.mockReset();
  storage.writeStorage(key, 'Cached vault');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  storage.removeStorage(key);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('active Vault name synchronization', () => {
  it('keeps the last valid name through empty catalogs and refetches on rename events', async () => {
    await act(async () => { root?.render(<Probe />); await Promise.resolve(); });
    expect(container.textContent).toBe('Cached vault');
    query.data = { vaults: [{ active: false, name: 'Other' }, { active: true, name: 'Mercè' }] };
    await act(async () => { root?.render(<Probe />); await Promise.resolve(); });
    expect(container.textContent).toBe('Mercè');
    expect(storage.readStorage(key)).toBe('Mercè');
    query.data = { vaults: [] };
    await act(async () => { root?.render(<Probe />); await Promise.resolve(); });
    expect(container.textContent).toBe('Mercè');
    expect(storage.readStorage(key)).toBe('Mercè');
    act(() => { emitVaultNameChanged(); });
    expect(query.refetch).toHaveBeenCalledOnce();
  });

  it('cancels StrictMode setup replay before writing the active name', async () => {
    const writes = vi.spyOn(storage, 'writeStorage');
    query.data = { vaults: [{ active: true, name: 'Current vault' }] };
    await act(async () => { root?.render(<StrictMode><Probe /></StrictMode>); await Promise.resolve(); });
    expect(container.textContent).toBe('Current vault');
    expect(writes).toHaveBeenCalledOnce();
    expect(storage.readStorage(key)).toBe('Current vault');
  });

  it('does not overwrite the cached name after unmount before the queued update', async () => {
    query.data = { vaults: [{ active: true, name: 'Unmounted vault' }] };
    act(() => { root?.render(<Probe />); });
    act(() => { root?.unmount(); root = null; });
    await act(async () => { await Promise.resolve(); });
    expect(storage.readStorage(key)).toBe('Cached vault');
  });
});
