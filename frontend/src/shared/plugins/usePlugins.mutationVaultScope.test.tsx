import {act, useEffect} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeAll, expect, it, vi} from 'vitest';

import type {PluginState} from '../api/plugins';
import {emitAppEvent} from '../platform/app-events';
import {ACTIVE_VAULT_ID_KEY, getActiveVaultId, storageSet} from '../api/vault-context';
import {resetApiTestStorage} from '../../../tests/api-request';
import {usePlugins, type PluginsState} from './usePlugins';

const mocks = vi.hoisted(() => ({
    fetchPluginState: vi.fn(),
    setPluginLifecycle: vi.fn(),
    updatePluginSettings: vi.fn(),
}));
vi.mock('../api/plugins', () => ({
    fetchPluginState: mocks.fetchPluginState,
    setPluginLifecycle: mocks.setPluginLifecycle,
}));
vi.mock('../api/plugin-runtime', () => ({updatePluginSettings: mocks.updatePluginSettings}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let currentPlugins: PluginsState | null = null;

beforeAll(() => {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    resetApiTestStorage();
});

function PluginsProbe() {
    const state = usePlugins();
    useEffect(() => {currentPlugins = state;}, [state]);
    return null;
}

function pluginsValue(): PluginsState {
    if (!currentPlugins) throw new Error('Expected the plugin state');
    return currentPlugins;
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {throw new Error('Promise is not initialized');};
    let reject: (error: Error) => void = () => {throw new Error('Promise is not initialized');};
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

it('ignores late activation, settings success and settings rollback from a previous vault while preserving promise semantics', async () => {
    resetApiTestStorage();
    storageSet(ACTIVE_VAULT_ID_KEY, 'vault-a');
    const settingsA = {folder: 'A'};
    const settingsB = {folder: 'B', marker: 'preserved'};
    mocks.fetchPluginState
        .mockResolvedValueOnce({enabled_builtin: ['mail'], settings: {mail: settingsA}})
        .mockResolvedValueOnce({enabled_builtin: [], settings: {mail: settingsB}});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {root?.render(<PluginsProbe />); await Promise.resolve();});
    expect(pluginsValue().isEnabled('mail')).toBe(true);

    const activation = deferred<PluginState>();
    const settingsSuccess = deferred<{settings: Record<string, unknown>}>();
    const settingsFailure = deferred<{settings: Record<string, unknown>}>();
    const requestVaults: string[] = [];
    mocks.setPluginLifecycle.mockImplementationOnce(() => {
        requestVaults.push(getActiveVaultId());
        return activation.promise;
    });
    mocks.updatePluginSettings
        .mockImplementationOnce(() => {
            requestVaults.push(getActiveVaultId());
            return settingsSuccess.promise;
        })
        .mockImplementationOnce(() => {
            requestVaults.push(getActiveVaultId());
            return settingsFailure.promise;
        });
    let activationResult: Promise<PluginState> | undefined;
    let successResult: Promise<void> | undefined;
    let failureResult: Promise<unknown> | undefined;
    await act(async () => {
        activationResult = pluginsValue().setPluginEnabled('calendar', true);
        successResult = pluginsValue().setPluginSettings('mail', {folder: 'A optimistic success'});
        failureResult = pluginsValue().setPluginSettings('mail', {folder: 'A optimistic failure'})
            .catch((error: unknown) => error);
        await Promise.resolve();
    });
    expect(requestVaults).toEqual(['vault-a', 'vault-a', 'vault-a']);
    expect(pluginsValue().getPluginSettings('mail')).toEqual({folder: 'A optimistic failure'});

    await act(async () => {
        storageSet(ACTIVE_VAULT_ID_KEY, 'vault-b');
        emitAppEvent('gnosi:vault-changed', {id: 'vault-b', name: 'Fixture B', slug: 'fixture-b'});
        await Promise.resolve();
    });
    const expectVaultB = () => {
        expect(getActiveVaultId()).toBe('vault-b');
        expect(pluginsValue().loaded).toBe(true);
        expect(pluginsValue().loadError).toBe(false);
        expect(pluginsValue().isEnabled('mail')).toBe(false);
        expect(pluginsValue().isEnabled('calendar')).toBe(false);
        expect(pluginsValue().getPluginSettings('mail')).toEqual(settingsB);
    };
    expectVaultB();
    const oldPayload: PluginState = {enabled_builtin: ['mail', 'calendar'], settings: {mail: settingsA}};
    await act(async () => {
        activation.resolve(oldPayload);
        expect(await activationResult).toBe(oldPayload);
    });
    expectVaultB();
    await act(async () => {
        settingsSuccess.resolve({settings: {folder: 'A server result'}});
        expect(await successResult).toBeUndefined();
    });
    expectVaultB();
    const oldError = new Error('Previous vault save rejected');
    await act(async () => {
        settingsFailure.reject(oldError);
        expect(await failureResult).toBe(oldError);
    });
    expectVaultB();

    // The same-vault success and rejection contracts remain unchanged.
    mocks.setPluginLifecycle.mockResolvedValueOnce({enabled_builtin: ['calendar'], settings: {mail: settingsB}});
    await act(async () => {await pluginsValue().setPluginEnabled('calendar', true);});
    expect(pluginsValue().isEnabled('calendar')).toBe(true);
    mocks.updatePluginSettings.mockResolvedValueOnce({settings: {folder: 'B saved'}});
    await act(async () => {await pluginsValue().setPluginSettings('mail', {folder: 'B optimistic'});});
    expect(pluginsValue().getPluginSettings('mail')).toEqual({folder: 'B saved'});
    const currentError = new Error('Current vault save rejected');
    mocks.updatePluginSettings.mockRejectedValueOnce(currentError);
    await act(async () => {
        await expect(pluginsValue().setPluginSettings('mail', {folder: 'B rejected'})).rejects.toBe(currentError);
    });
    expect(pluginsValue().getPluginSettings('mail')).toEqual({folder: 'B saved'});
    expect(mocks.fetchPluginState).toHaveBeenCalledTimes(2);
});
