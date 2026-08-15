import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DesktopUpdateNotice } from './DesktopUpdateNotice';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallback, values = {}) => Object.entries(values).reduce(
            (text, [name, value]) => text.replace(`{{${name}}}`, value),
            fallback || key,
        ),
    }),
}));

let root;
let container;

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete window.electronAPI;
});

async function renderNotice() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<DesktopUpdateNotice />));
}

describe('DesktopUpdateNotice', () => {
    it('stays hidden in the web application', async () => {
        await renderNotice();
        expect(container.textContent).toBe('');
    });

    it('downloads an available update and installs it after progress completes', async () => {
        let statusListener;
        const downloadUpdate = vi.fn().mockResolvedValue(undefined);
        const installUpdate = vi.fn().mockResolvedValue(undefined);
        window.electronAPI = {
            getUpdateStatus: vi.fn().mockResolvedValue({
                status: 'available',
                version: '1.2.0',
                installMode: 'automatic',
            }),
            onUpdateStatus: vi.fn((listener) => { statusListener = listener; }),
            removeUpdateListener: vi.fn(),
            downloadUpdate,
            installUpdate,
        };

        await renderNotice();
        expect(container.textContent).toContain('Gnosi 1.2.0 is available');

        await act(async () => {
            [...container.querySelectorAll('button')]
                .find((button) => button.textContent.includes('Download'))
                .click();
        });
        expect(downloadUpdate).toHaveBeenCalledOnce();

        await act(async () => {
            statusListener({ status: 'downloading', version: '1.2.0', percent: 42.4 });
        });
        const progress = container.querySelector('[role="progressbar"]');
        expect(progress.getAttribute('aria-valuenow')).toBe('42');

        await act(async () => {
            statusListener({ status: 'downloaded', version: '1.2.0' });
        });
        expect(container.textContent).toContain('Restart Gnosi');

        await act(async () => {
            [...container.querySelectorAll('button')]
                .find((button) => button.textContent.includes('Restart and install'))
                .click();
        });
        expect(installUpdate).toHaveBeenCalledOnce();
    });

    it('opens the macOS installer download without showing release history', async () => {
        const downloadUpdate = vi.fn().mockResolvedValue({
            status: 'manual-download',
            version: '1.2.0',
            installMode: 'manual',
        });
        window.electronAPI = {
            getUpdateStatus: vi.fn().mockResolvedValue({
                status: 'available',
                version: '1.2.0',
                installMode: 'manual',
            }),
            onUpdateStatus: vi.fn(),
            removeUpdateListener: vi.fn(),
            downloadUpdate,
        };

        await renderNotice();
        expect(container.textContent).not.toContain("What's new");

        await act(async () => {
            [...container.querySelectorAll('button')]
                .find((button) => button.textContent.includes('Download'))
                .click();
        });

        expect(downloadUpdate).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Installer download started');
        expect(container.textContent).toContain('Open the DMG');
        expect(container.textContent).not.toContain('Restart and install');
    });

    it('surfaces an update action error instead of failing silently', async () => {
        window.electronAPI = {
            getUpdateStatus: vi.fn().mockResolvedValue({
                status: 'available',
                version: '1.2.0',
                installMode: 'manual',
            }),
            onUpdateStatus: vi.fn(),
            removeUpdateListener: vi.fn(),
            downloadUpdate: vi.fn().mockRejectedValue(new Error('open failed')),
        };

        await renderNotice();
        await act(async () => {
            [...container.querySelectorAll('button')]
                .find((button) => button.textContent.includes('Download'))
                .click();
        });

        expect(container.textContent).toContain('Update could not be completed');
        expect(container.textContent).toContain('Please try the update again later.');
    });
});
