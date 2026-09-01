// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getDesktopMenuLabels,
    installDesktopApplicationMenu,
    syncDesktopApplicationMenu,
} from './desktopMenu';
import { subscribeAppEvent } from '../../shared/platform/app-events';

afterEach(() => {
    delete window.electronAPI;
});

describe('desktop application menu integration', () => {
    it('builds every label from the active i18n catalog', () => {
        const i18n = { t: vi.fn((key: string) => `translated:${key}`) };
        const labels = getDesktopMenuLabels(i18n);

        expect(labels.settings).toBe('translated:desktop_menu.settings');
        expect(labels.newWindow).toBe('translated:desktop_menu.newWindow');
        expect(labels.documentation).toBe('translated:desktop_menu.documentation');
        expect(Object.keys(labels)).toHaveLength(34);
    });

    it('sends translated labels only when the Electron bridge exists', async () => {
        const i18n = { t: (key: string) => key };
        expect(await syncDesktopApplicationMenu(i18n)).toBe(false);

        const setApplicationMenu = vi.fn().mockResolvedValue(true);
        window.electronAPI = { setApplicationMenu };
        expect(await syncDesktopApplicationMenu(i18n)).toBe(true);
        expect(setApplicationMenu).toHaveBeenCalledWith(
            expect.objectContaining({ settings: 'desktop_menu.settings' }),
        );
    });

    it('connects the native Settings command and language changes', () => {
        let nativeSettingsHandler: (() => void) | undefined;
        const setApplicationMenu = vi.fn().mockResolvedValue(true);
        window.electronAPI = {
            setApplicationMenu,
            onOpenSettings: (handler) => {
                nativeSettingsHandler = handler;
            },
        };
        const i18n = {
            t: (key: string) => key,
            on: vi.fn(),
        };
        const settingsListener = vi.fn();
        const unsubscribe = subscribeAppEvent('open-settings', settingsListener);

        installDesktopApplicationMenu(i18n);
        if (!nativeSettingsHandler) throw new Error('Expected native Settings handler.');
        nativeSettingsHandler();

        expect(settingsListener).toHaveBeenCalledOnce();
        expect(i18n.on).toHaveBeenCalledWith('languageChanged', expect.any(Function));
        expect(setApplicationMenu).toHaveBeenCalledOnce();
        unsubscribe();
    });
});
