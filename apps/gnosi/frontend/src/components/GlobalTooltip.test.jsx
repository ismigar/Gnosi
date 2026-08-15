import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GlobalTooltip } from './GlobalTooltip';

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
    document.body.replaceChildren();
});

async function mountTooltipLayer(markup) {
    const fixture = document.createElement('div');
    fixture.innerHTML = markup;
    document.body.appendChild(fixture);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
        root.render(<GlobalTooltip />);
    });

    return fixture;
}

describe('GlobalTooltip', () => {
    it('replaces a native title with the shared tooltip on hover', async () => {
        const fixture = await mountTooltipLayer('<button title="Open document">Open</button>');
        const trigger = fixture.querySelector('button');

        expect(trigger.hasAttribute('title')).toBe(false);
        expect(trigger.getAttribute('data-gnosi-tooltip')).toBe('Open document');

        await act(async () => {
            trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });

        const tooltip = document.getElementById('gnosi-global-tooltip');
        expect(tooltip?.getAttribute('role')).toBe('tooltip');
        expect(tooltip?.textContent).toBe('Open document');
        expect(trigger.getAttribute('aria-describedby')).toContain('gnosi-global-tooltip');
    });

    it('adopts titles added by lazy content and updates their text', async () => {
        const fixture = await mountTooltipLayer('<button>Lazy action</button>');
        const trigger = fixture.querySelector('button');

        await act(async () => {
            trigger.setAttribute('title', 'First label');
            await Promise.resolve();
        });
        expect(trigger.getAttribute('data-gnosi-tooltip')).toBe('First label');
        expect(trigger.hasAttribute('title')).toBe(false);

        await act(async () => {
            trigger.setAttribute('title', 'Updated label');
            await Promise.resolve();
        });
        expect(trigger.getAttribute('data-gnosi-tooltip')).toBe('Updated label');
    });

    it('uses keyboard focus and closes on Escape', async () => {
        const fixture = await mountTooltipLayer('<button title="Keyboard action">Action</button>');
        const trigger = fixture.querySelector('button');

        await act(async () => trigger.focus());
        expect(document.getElementById('gnosi-global-tooltip')?.textContent).toBe('Keyboard action');

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
        expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    });

    it('preserves a title-only icon control as an accessible name', async () => {
        const fixture = await mountTooltipLayer('<button title="Filter unread"><svg aria-hidden="true"></svg></button>');
        const trigger = fixture.querySelector('button');

        expect(trigger.getAttribute('aria-label')).toBe('Filter unread');

        await act(async () => {
            trigger.setAttribute('title', 'Show all messages');
            await Promise.resolve();
        });
        expect(trigger.getAttribute('aria-label')).toBe('Show all messages');
    });

    it('suppresses the native title without duplicating an existing rich tooltip', async () => {
        const fixture = await mountTooltipLayer(`
            <button class="app-sidebar__item" title="Mail">
                Mail
                <span class="app-sidebar__tooltip">Mail <kbd>Ctrl 4</kbd></span>
            </button>
        `);
        const trigger = fixture.querySelector('button');

        await act(async () => {
            trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });

        expect(trigger.hasAttribute('title')).toBe(false);
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
    });

    it('restores adopted titles when the global layer unmounts', async () => {
        const fixture = await mountTooltipLayer('<button title="Restored label">Action</button>');
        const trigger = fixture.querySelector('button');
        const mounted = mountedRoots.pop();

        await act(async () => mounted.root.unmount());
        mounted.container.remove();

        expect(trigger.getAttribute('title')).toBe('Restored label');
        expect(trigger.hasAttribute('data-gnosi-tooltip')).toBe(false);
    });
});
