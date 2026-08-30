import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DesktopUpdateNotice } from './DesktopUpdateNotice';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            fallback?: string,
            values: Readonly<Record<string, string | number>> = {},
        ) => Object.entries(values).reduce(
            (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
            fallback ?? key,
        ),
    }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    const mountedRoot = root;
    if (mountedRoot) {
        act(() => {
            mountedRoot.unmount();
        });
    }
    container?.remove();
    root = null;
    container = null;
    delete window.electronAPI;
});

async function renderNotice(): Promise<HTMLDivElement> {
    const nextContainer = document.createElement('div');
    document.body.appendChild(nextContainer);
    container = nextContainer;
    const nextRoot = createRoot(nextContainer);
    root = nextRoot;
    await act(async () => {
        nextRoot.render(<DesktopUpdateNotice />);
        await Promise.resolve();
    });
    return nextContainer;
}

function findButton(text: string): HTMLButtonElement {
    if (!container) throw new Error('Expected a mounted update notice.');
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(text));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Expected update action button containing "${text}".`);
    }
    return button;
}

describe('DesktopUpdateNotice', () => {
    it('stays hidden in the web application', async () => {
        const mountedContainer = await renderNotice();
        expect(mountedContainer.textContent).toBe('');
    });

    it('downloads an available update and installs it after progress completes', async () => {
        let statusListener: ((update: DesktopUpdateState) => void) | null = null;
        const downloadUpdate = vi.fn().mockResolvedValue(undefined);
        const installUpdate = vi.fn().mockResolvedValue(undefined);
        window.electronAPI = {
            getUpdateStatus: vi.fn().mockResolvedValue({
                status: 'available',
                version: '1.2.0',
                installMode: 'automatic',
            }),
            onUpdateStatus: vi.fn((listener: (update: DesktopUpdateState) => void) => {
                statusListener = listener;
            }),
            removeUpdateListener: vi.fn(),
            downloadUpdate,
            installUpdate,
        };

        const mountedContainer = await renderNotice();
        expect(mountedContainer.textContent).toContain('Gnosi 1.2.0 is available');

        await act(async () => {
            findButton('Download').click();
            await Promise.resolve();
        });
        expect(downloadUpdate).toHaveBeenCalledOnce();

        const emitStatus = (update: DesktopUpdateState): void => {
            const listener = statusListener;
            if (!listener) throw new Error('Expected the desktop update status listener.');
            act(() => {
                listener(update);
            });
        };
        emitStatus({ status: 'downloading', version: '1.2.0', percent: 42.4 });
        const progress = mountedContainer.querySelector('[role="progressbar"]');
        if (!(progress instanceof HTMLElement)) {
            throw new Error('Expected the update download progress bar.');
        }
        expect(progress.getAttribute('aria-valuenow')).toBe('42');

        emitStatus({ status: 'downloaded', version: '1.2.0' });
        expect(mountedContainer.textContent).toContain('Restart Gnosi');

        await act(async () => {
            findButton('Restart and install').click();
            await Promise.resolve();
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

        const mountedContainer = await renderNotice();
        expect(mountedContainer.textContent).not.toContain("What's new");

        await act(async () => {
            findButton('Download').click();
            await Promise.resolve();
        });

        expect(downloadUpdate).toHaveBeenCalledOnce();
        expect(mountedContainer.textContent).toContain('Installer download started');
        expect(mountedContainer.textContent).toContain('Open the DMG');
        expect(mountedContainer.textContent).not.toContain('Restart and install');
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

        const mountedContainer = await renderNotice();
        await act(async () => {
            findButton('Download').click();
            await Promise.resolve();
        });

        expect(mountedContainer.textContent).toContain('Update could not be completed');
        expect(mountedContainer.textContent).toContain('Please try the update again later.');
    });
});
