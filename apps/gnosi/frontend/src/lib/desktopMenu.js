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

export function getDesktopMenuLabels(i18n) {
    return Object.fromEntries(
        MENU_LABEL_KEYS.map((key) => [key, i18n.t(`desktop_menu.${key}`)]),
    );
}

export async function syncDesktopApplicationMenu(i18n) {
    if (!window.electronAPI?.setApplicationMenu) return false;
    await window.electronAPI.setApplicationMenu(getDesktopMenuLabels(i18n));
    return true;
}

export function installDesktopApplicationMenu(i18n) {
    if (!window.electronAPI) return;

    const sync = () => {
        void syncDesktopApplicationMenu(i18n).catch((error) => {
            console.error('Failed to synchronize the desktop application menu:', error);
        });
    };
    const openSettings = () => {
        window.dispatchEvent(new CustomEvent('open-settings'));
    };

    window.electronAPI.onOpenSettings?.(openSettings);
    i18n.on('languageChanged', sync);
    sync();
}
