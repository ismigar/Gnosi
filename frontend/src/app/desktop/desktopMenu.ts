import { emitAppEvent } from '../../shared/platform/app-events';

const MENU_LABEL_KEYS = Object.freeze([
    'about',
    'checkForUpdates',
    'settings',
    'services',
    'hide',
    'hideOthers',
    'showAll',
    'quit',
    'file',
    'newWindow',
    'closeWindow',
    'edit',
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'pasteAndMatchStyle',
    'delete',
    'selectAll',
    'view',
    'reload',
    'forceReload',
    'toggleDeveloperTools',
    'actualSize',
    'zoomIn',
    'zoomOut',
    'toggleFullScreen',
    'window',
    'minimize',
    'zoom',
    'bringAllToFront',
    'help',
    'documentation',
]);

interface DesktopMenuTranslator {
    t(key: string): string;
}

interface DesktopMenuI18n extends DesktopMenuTranslator {
    on(event: 'languageChanged', listener: () => void): unknown;
}

export function getDesktopMenuLabels(i18n: DesktopMenuTranslator): Record<string, string> {
    return Object.fromEntries(
        MENU_LABEL_KEYS.map((key) => [key, i18n.t(`desktop_menu.${key}`)] as const),
    );
}

export async function syncDesktopApplicationMenu(i18n: DesktopMenuTranslator): Promise<boolean> {
    if (!window.electronAPI?.setApplicationMenu) return false;
    await window.electronAPI.setApplicationMenu(getDesktopMenuLabels(i18n));
    return true;
}

export function installDesktopApplicationMenu(i18n: DesktopMenuI18n): void {
    if (!window.electronAPI) return;

    const sync = () => {
        void syncDesktopApplicationMenu(i18n).catch((error: unknown) => {
            console.error('Failed to synchronize the desktop application menu:', error);
        });
    };
    const openSettings = () => {
        emitAppEvent('open-settings', null);
    };

    window.electronAPI.onOpenSettings?.(openSettings);
    i18n.on('languageChanged', sync);
    sync();
}
