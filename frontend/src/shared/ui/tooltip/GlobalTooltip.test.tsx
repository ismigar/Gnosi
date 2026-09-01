import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GlobalTooltip } from './GlobalTooltip';
import { dispatchWindowEvent } from '../../platform/browser-events';

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
    document.body.replaceChildren();
});

async function mountTooltipLayer(markup: string): Promise<HTMLDivElement> {
    const fixture = document.createElement('div');
    fixture.innerHTML = markup;
    document.body.appendChild(fixture);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
        root.render(<GlobalTooltip />);
        await Promise.resolve();
    });

    return fixture;
}

function requiredElement(root: ParentNode, selector: string): Element {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Expected fixture element matching "${selector}".`);
    return element;
}

function requiredButton(root: ParentNode): HTMLButtonElement {
    const element = requiredElement(root, 'button');
    if (!(element instanceof HTMLButtonElement)) throw new Error('Expected a button.');
    return element;
}

function requiredDiv(root: ParentNode): HTMLDivElement {
    const element = requiredElement(root, 'div');
    if (!(element instanceof HTMLDivElement)) throw new Error('Expected a div.');
    return element;
}

describe('GlobalTooltip', () => {
    it('dismisses on captured scroll and resize and releases all listeners on unmount', async () => {
        const fixture = await mountTooltipLayer('<div><button title="Shared hint">Action</button></div>');
        const trigger = requiredButton(fixture);
        const focus = () => { act(() => { trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); }); };
        focus(); expect(document.getElementById('gnosi-global-tooltip')).not.toBeNull();
        act(() => { trigger.dispatchEvent(new Event('scroll', { bubbles: false })); });
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
        focus(); expect(document.getElementById('gnosi-global-tooltip')).not.toBeNull();
        act(() => { dispatchWindowEvent(new Event('resize')); });
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
        const mounted = mountedRoots.pop();
        if (!mounted) throw new Error('Expected tooltip root');
        act(() => { mounted.root.unmount(); }); mounted.container.remove();
        focus(); act(() => { dispatchWindowEvent(new Event('resize')); });
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
        expect(trigger.getAttribute('title')).toBe('Shared hint');
    });

    it('replaces a native title with the shared tooltip on hover', async () => {
        const fixture = await mountTooltipLayer('<button title="Open document">Open</button>');
        const trigger = requiredButton(fixture);

        expect(trigger.hasAttribute('title')).toBe(false);
        expect(trigger.getAttribute('data-gnosi-tooltip')).toBe('Open document');

        act(() => {
            trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });

        const tooltip = document.getElementById('gnosi-global-tooltip');
        expect(tooltip?.getAttribute('role')).toBe('tooltip');
        expect(tooltip?.textContent).toBe('Open document');
        expect(trigger.getAttribute('aria-describedby')).toContain('gnosi-global-tooltip');
    });

    it('adopts titles added by lazy content and updates their text', async () => {
        const fixture = await mountTooltipLayer('<button>Lazy action</button>');
        const trigger = requiredButton(fixture);

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
        const trigger = requiredButton(fixture);

        act(() => {
            trigger.focus();
        });
        expect(document.getElementById('gnosi-global-tooltip')?.textContent).toBe('Keyboard action');

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
        expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    });

    it('closes before a click opens a contextual menu even when propagation is stopped', async () => {
        const fixture = await mountTooltipLayer(`
            <div title="Click to switch · double-click to rename">
                <button type="button">View options</button>
            </div>
        `);
        const tab = requiredDiv(fixture);
        const trigger = requiredButton(fixture);

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const menu = document.createElement('div');
            menu.setAttribute('role', 'menu');
            fixture.appendChild(menu);
        });

        act(() => {
            tab.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });
        expect(document.getElementById('gnosi-global-tooltip')).not.toBeNull();

        act(() => {
            trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(fixture.querySelector('[role="menu"]')).not.toBeNull();
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
        expect(tab.hasAttribute('aria-describedby')).toBe(false);
    });

    it('closes on a native context-menu request', async () => {
        const fixture = await mountTooltipLayer('<button title="Open actions">Actions</button>');
        const trigger = requiredButton(fixture);

        act(() => {
            trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });
        expect(document.getElementById('gnosi-global-tooltip')).not.toBeNull();

        act(() => {
            trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        });

        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
        expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    });

    it('preserves a title-only icon control as an accessible name', async () => {
        const fixture = await mountTooltipLayer('<button title="Filter unread"><svg aria-hidden="true"></svg></button>');
        const trigger = requiredButton(fixture);

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
        const trigger = requiredButton(fixture);

        act(() => {
            trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });

        expect(trigger.hasAttribute('title')).toBe(false);
        expect(document.getElementById('gnosi-global-tooltip')).toBeNull();
    });

    it('restores adopted titles when the global layer unmounts', async () => {
        const fixture = await mountTooltipLayer('<button title="Restored label">Action</button>');
        const trigger = requiredButton(fixture);
        const mounted = mountedRoots.pop();
        if (!mounted) throw new Error('Expected the mounted tooltip root.');

        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();

        expect(trigger.getAttribute('title')).toBe('Restored label');
        expect(trigger.hasAttribute('data-gnosi-tooltip')).toBe(false);
    });
});
