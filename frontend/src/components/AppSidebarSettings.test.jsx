import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FileText } from 'lucide-react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppSidebarSettings } from './AppSidebarSettings';

const labels = { 'nav.one': 'One', 'nav.two': 'Two', 'nav.three': 'Three' };

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallback) => labels[key] || fallback || key,
    }),
}));

const mountedRoots = [];

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('AppSidebarSettings', () => {
    it('keeps menu configuration separate from application access', async () => {
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

        await act(async () => {
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
        await act(async () => pinButtons[2].click());
        expect(onTogglePinned).toHaveBeenCalledWith('/three');

        const search = container.querySelector('input');
        await act(async () => {
            const setValue = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            ).set;
            setValue.call(search, 'two');
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.textContent).toContain('Two');
        expect(container.textContent).not.toContain('Three');
    });
});
