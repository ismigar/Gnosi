import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import type { PluginState } from '../api/plugins';
import { GnosiApiError } from '../api/errors';
import { ACTIVE_VAULT_ID_KEY, storageSet } from '../api/vault-context';
import { emitAppEvent } from '../platform/app-events';
import { resetApiTestStorage } from '../../../tests/api-request';
import { usePlugins, type PluginsState } from './usePlugins';

const mocks = vi.hoisted(() => ({ fetchPluginState: vi.fn() }));
vi.mock('../api/plugins', async (importOriginal) => {
    const original = await importOriginal<typeof import('../api/plugins')>();
    return { ...original, fetchPluginState: mocks.fetchPluginState };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let currentPlugins: PluginsState | null = null;
let vaultSequence = 0;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    resetApiTestStorage();
    storageSet(ACTIVE_VAULT_ID_KEY, `auth-required-vault-${String(++vaultSequence)}`);
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    currentPlugins = null;
    resetApiTestStorage();
    vi.resetAllMocks();
});

function PluginsProbe(): null {
    const state = usePlugins();
    useEffect(() => { currentPlugins = state; }, [state]);
    return null;
}

function pluginsValue(): PluginsState {
    if (!currentPlugins) throw new Error('Expected plugin state');
    return currentPlugins;
}

async function mount(): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(<PluginsProbe />); await Promise.resolve(); });
}

function apiFailure(status: number, detail: string): GnosiApiError {
    return new GnosiApiError(new Response(null, { status }), { detail });
}

function deferred<T>() {
    let resolve: (value: T) => void = () => { throw new Error('Promise is not initialized'); };
    let reject: (error: Error) => void = () => { throw new Error('Promise is not initialized'); };
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

it.each([
    { status: 401, detail: 'Authentication required', expected: true },
    { status: 401, detail: 'Not authenticated', expected: false },
    { status: 401, detail: 'Sessió expirada o invàlida', expected: false },
    { status: 500, detail: 'Authentication required', expected: false },
])('classifies only the explicit authentication denial: $status/$detail', async ({ status, detail, expected }) => {
    mocks.fetchPluginState.mockRejectedValueOnce(apiFailure(status, detail));
    await mount();

    expect(pluginsValue().loadError).toBe(true);
    expect(pluginsValue().loaded).toBe(false);
    expect(pluginsValue().authenticationRequired).toBe(expected ? true : undefined);
    expect(mocks.fetchPluginState).toHaveBeenCalledOnce();
});

it('keeps the denial through a pending retry and generic failure, then clears it on success', async () => {
    mocks.fetchPluginState.mockRejectedValueOnce(apiFailure(401, 'Authentication required'));
    await mount();
    const retry = deferred<PluginState>();
    mocks.fetchPluginState.mockReturnValueOnce(retry.promise);
    let pending: ReturnType<PluginsState['reload']> | undefined;
    await act(async () => { pending = pluginsValue().reload(); await Promise.resolve(); });
    expect(pluginsValue().authenticationRequired).toBe(true);

    await act(async () => { retry.reject(new TypeError('Synthetic network failure')); await pending; });
    expect(pluginsValue().authenticationRequired).toBe(true);
    expect(pluginsValue().loadError).toBe(true);
    mocks.fetchPluginState.mockResolvedValueOnce({ enabled_builtin: ['calendar'] });
    await act(async () => { await pluginsValue().reload(); });

    expect(pluginsValue().authenticationRequired).toBeUndefined();
    expect(pluginsValue().loadError).toBe(false);
    expect(pluginsValue().loaded).toBe(true);
    expect(pluginsValue().isEnabled('calendar')).toBe(true);
});

it('clears a denial on vault change and ignores the previous vault’s late denial', async () => {
    mocks.fetchPluginState.mockRejectedValueOnce(apiFailure(401, 'Authentication required'));
    await mount();
    expect(pluginsValue().authenticationRequired).toBe(true);
    const oldRetry = deferred<PluginState>();
    mocks.fetchPluginState.mockReturnValueOnce(oldRetry.promise);
    let stale: ReturnType<PluginsState['reload']> | undefined;
    await act(async () => { stale = pluginsValue().reload(); await Promise.resolve(); });

    const nextVault = `auth-required-vault-${String(++vaultSequence)}`;
    mocks.fetchPluginState.mockRejectedValueOnce(apiFailure(500, 'Synthetic unavailable configuration'));
    await act(async () => {
        storageSet(ACTIVE_VAULT_ID_KEY, nextVault);
        emitAppEvent('gnosi:vault-changed', { id: nextVault, name: 'Synthetic vault', slug: nextVault });
        await Promise.resolve();
    });
    expect(pluginsValue().authenticationRequired).toBeUndefined();
    expect(pluginsValue().loadError).toBe(true);

    await act(async () => { oldRetry.reject(apiFailure(401, 'Authentication required')); await stale; });
    expect(pluginsValue().authenticationRequired).toBeUndefined();
    expect(pluginsValue().loadError).toBe(true);
});
