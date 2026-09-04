import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PluginState } from '../api/plugins';
import {
    PLUGIN_BOOTSTRAP_TIMEOUT_MS,
    usePlugins,
    type PluginsState,
} from './usePlugins';

const mocks = vi.hoisted(() => ({
    fetchPluginState: vi.fn(),
    subscribeAppEvent: vi.fn(() => vi.fn()),
}));

vi.mock('../api/plugins', async (importOriginal) => {
    const original = await importOriginal<typeof import('../api/plugins')>();
    return {
        ...original,
        fetchPluginState: mocks.fetchPluginState,
    };
});

vi.mock('../platform/app-events', () => ({
    subscribeAppEvent: mocks.subscribeAppEvent,
}));

const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
let container: HTMLDivElement | null = null;
let root: Root | null = null;
let currentPlugins: PluginsState | null = null;
const observedSignals: AbortSignal[] = [];

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    currentPlugins = null;
    observedSignals.length = 0;
    vi.useRealTimers();
    vi.resetAllMocks();
});

function indefinitelyPending(signal?: AbortSignal): Promise<PluginState> {
    if (!signal) throw new Error('Expected a plugin AbortSignal');
    observedSignals.push(signal);
    return new Promise<PluginState>(() => undefined);
}

function PluginsProbe(): null {
    const plugins = usePlugins();
    useEffect(() => {
        currentPlugins = plugins;
    }, [plugins]);
    return null;
}

function pluginsValue(): PluginsState {
    if (!currentPlugins) throw new Error('usePlugins did not publish a value');
    return currentPlugins;
}

describe('usePlugins bootstrap resilience', () => {
    it('settles to a safe fallback after abort and allows a later reload', async () => {
        vi.useFakeTimers();
        mocks.fetchPluginState.mockImplementationOnce(indefinitelyPending);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await act(async () => {
            root?.render(<PluginsProbe />);
            await Promise.resolve();
        });
        expect(pluginsValue().loaded).toBe(false);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(PLUGIN_BOOTSTRAP_TIMEOUT_MS);
        });

        expect(pluginsValue().loaded).toBe(true);
        expect(pluginsValue().isEnabled('recovered-plugin')).toBe(false);
        const [initialSignal] = observedSignals;
        expect(initialSignal).toBeInstanceOf(AbortSignal);
        expect(initialSignal?.aborted).toBe(true);

        mocks.fetchPluginState.mockResolvedValueOnce({
            enabled_third_party: ['recovered-plugin'],
        });
        await act(async () => {
            await pluginsValue().reload();
        });

        expect(mocks.fetchPluginState).toHaveBeenCalledTimes(2);
        expect(pluginsValue().loaded).toBe(true);
        expect(pluginsValue().isEnabled('recovered-plugin')).toBe(true);
    });
});
