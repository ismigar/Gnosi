import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CommandPalette from './CommandPalette';
import { subscribeAppEvent } from '../shared/platform/app-events';
import { dispatchWindowEvent } from '../shared/platform/browser-events';
import {
    defineStorageKey,
    readStorage,
    removeStorage,
    stringStorageCodec,
} from '../shared/platform/browser-storage';


const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    pluginCommands: [] as Array<{
        icon: unknown;
        id: unknown;
        pluginId: string;
        title: unknown;
    }>,
    runCommand: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const themeStorageKey = defineStorageKey('db-theme', stringStorageCodec);


vi.mock('react-router-dom', () => ({
    useNavigate: () => mocks.navigate,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../plugins/usePluginHost', () => ({
    usePluginHost: () => ({ commands: mocks.pluginCommands }),
}));

vi.mock('../plugins/host', () => ({
    runCommand: mocks.runCommand,
}));

vi.mock('../plugins/usePlugins', () => ({
    usePlugins: () => ({ isEnabled: () => false }),
}));

vi.mock('../shared/api/markdown-import', () => ({
    importVaultMarkdown: vi.fn(),
}));

vi.mock('../shared/api/vaults', () => ({
    createVaultPage: vi.fn(),
}));


describe('CommandPalette', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });
        mocks.pluginCommands = [];
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        act(() => {
            root.render(<CommandPalette />);
        });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.useRealTimers();
        vi.clearAllMocks();
        removeStorage(themeStorageKey);
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    function openPalette(): void {
        act(() => {
            dispatchWindowEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                ctrlKey: true,
                key: 'p',
                shiftKey: true,
            }));
            vi.advanceTimersByTime(25);
        });
    }

    function commandRow(label: string): HTMLLIElement {
        const row = Array.from(container.querySelectorAll<HTMLLIElement>('[data-idx]'))
            .find((candidate) => candidate.textContent.includes(label));
        if (!row) throw new Error(`Command not rendered: ${label}`);
        return row;
    }

    it('opens from the global shortcut and emits settings through the typed bridge', () => {
        const onSettings = vi.fn();
        const unsubscribe = subscribeAppEvent('gnosi:open-settings', onSettings);
        openPalette();

        expect(container.querySelector('input')).not.toBeNull();
        act(() => {
            commandRow('command_palette.open_settings').dispatchEvent(new MouseEvent(
                'mousedown',
                { bubbles: true },
            ));
        });

        expect(onSettings).toHaveBeenCalledOnce();
        expect(container.querySelector('input')).toBeNull();
        unsubscribe();
    });

    it('runs only well-formed third-party command contributions', () => {
        mocks.pluginCommands = [
            { icon: null, id: 'valid', pluginId: 'example', title: 'Plugin action' },
            { icon: null, id: 42, pluginId: 'example', title: 'Invalid action' },
        ];
        act(() => {
            root.render(<CommandPalette />);
        });
        openPalette();

        expect(container.textContent).not.toContain('Invalid action');
        act(() => {
            commandRow('Plugin action').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(mocks.runCommand).toHaveBeenCalledWith('example', 'valid');
    });

    it('persists a theme choice and emits its typed update event', () => {
        const onThemeChange = vi.fn();
        const unsubscribe = subscribeAppEvent('db-theme-changed', onThemeChange);
        openPalette();

        act(() => {
            commandRow('command_palette.theme_dark').dispatchEvent(new MouseEvent(
                'mousedown',
                { bubbles: true },
            ));
        });

        expect(readStorage(themeStorageKey)).toBe('dark');
        expect(onThemeChange).toHaveBeenCalledOnce();
        unsubscribe();
    });
});
