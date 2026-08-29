import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { FileText } from 'lucide-react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppSidebarSettings } from './AppSidebarSettings';

const labels: Readonly<Record<string, string>> = { 'nav.one': 'One', 'nav.two': 'Two', 'nav.three': 'Three' };

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => labels[key] || fallback || key,
    }),
}));

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

const mountedRoots: MountedRoot[] = [];
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) break;
        const { root, container } = mounted;
        act(() => {
            root.unmount();
        });
        container.remove();
    }
});

describe('AppSidebarSettings', () => {
    it('keeps menu configuration separate from application access', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });
        const onTogglePinned = vi.fn();
        const onMovePinned = vi.fn();
        const items = [
            { to: '/one', icon: FileText, labelKey: 'nav.one' },
            { to: '/two', icon: FileText, labelKey: 'nav.two' },
            { to: '/three', icon: FileText, labelKey: 'nav.three' },
        ];

        act(() => {
            root.render(
                <AppSidebarSettings
                    items={items}
                    pinnedRoutes={['/one', '/two']}
                    onTogglePinned={onTogglePinned}
                    onMovePinned={onMovePinned}
                />,
            );
        });

        expect(container.textContent).toContain('Application menu');
        expect(container.textContent).toContain('Quick access');
        const pinButtons = container.querySelectorAll('[aria-pressed]');
        expect(pinButtons).toHaveLength(3);
        const thirdPinButton = pinButtons[2];
        if (!(thirdPinButton instanceof HTMLButtonElement)) {
            throw new Error('Expected the third pin button.');
        }
        act(() => {
            thirdPinButton.click();
        });
        expect(onTogglePinned).toHaveBeenCalledWith('/three');

        const search = container.querySelector('input');
        if (!(search instanceof HTMLInputElement)) {
            throw new Error('Expected the application search input.');
        }
        act(() => {
            const setValue = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            )?.set?.bind(search);
            if (!setValue) throw new Error('Expected the native input value setter.');
            setValue('two');
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.textContent).toContain('Two');
        expect(container.textContent).not.toContain('Three');
    });
});
