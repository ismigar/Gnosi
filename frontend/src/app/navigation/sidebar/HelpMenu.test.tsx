// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpMenu } from './HelpMenu';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import type { ThemePreference } from '../../../shared/hooks/useTheme';

const theme = vi.hoisted<{ preference: ThemePreference }>(() => ({ preference: 'dark' }));
vi.mock('../../../shared/hooks/useTheme', () => ({ useTheme: () => ({ themePreference: theme.preference }) }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'ca-ES' },
}) }));

let container: HTMLDivElement;
let root: Root;
const select = vi.fn();
const closeSidebar = vi.fn();

function MobileSidebar() {
    useModalKeyboard({ isOpen: true, onClose: closeSidebar });
    return <HelpMenu onSelect={select} />;
}

beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    theme.preference = 'dark';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await interact(() => { root.render(<MemoryRouter initialEntries={['/@demo/resources']}><MobileSidebar /></MemoryRouter>); });
});
afterEach(async () => { await interact(() => { root.unmount(); }); container.remove(); });

async function interact(callback: () => void) {
    await act(async () => { callback(); await Promise.resolve(); });
}

function button(): HTMLButtonElement {
    const node = container.querySelector('button');
    if (!node) throw new Error('Missing help button');
    return node;
}
async function key(value: string) {
    await interact(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })); });
}
function links(): HTMLAnchorElement[] { return [...container.querySelectorAll('a')]; }

describe('help menu', () => {
    it('opens localized external links and resolves the current section', async () => {
        await interact(() => { button().click(); });
        expect(button().getAttribute('aria-expanded')).toBe('true');
        expect(links()).toHaveLength(4);
        expect(document.activeElement).toBe(links()[0]);
        expect(links()[2]?.href).toBe('https://gnosi.temenosismael.org/Gnosi/learn/ca/reading-references/?theme=dark');
        for (const link of links()) {
            expect(link.target).toBe('_blank');
            expect(link.rel).toBe('noopener noreferrer');
        }
    });
    it('reads the current Gnosi preference when opening help', async () => {
        theme.preference = 'light';
        await interact(() => { button().click(); });
        expect(links()[0]?.search).toBe('?theme=light');
        expect(links()[3]?.search).toBe('');
    });
    it('supports arrow keys, Home/End and nested Escape without closing the mobile sidebar', async () => {
        button().focus();
        await key('ArrowUp');
        expect(document.activeElement).toBe(links()[3]);
        await key('ArrowDown');
        expect(document.activeElement).toBe(links()[0]);
        await key('End');
        expect(document.activeElement).toBe(links()[3]);
        await key('Home');
        expect(document.activeElement).toBe(links()[0]);
        await key('Escape');
        expect(links()).toHaveLength(0);
        expect(document.activeElement).toBe(button());
        expect(closeSidebar).not.toHaveBeenCalled();
    });
    it('dismisses on outside pointer and focus leaving the menu', async () => {
        await interact(() => { button().click(); });
        await interact(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
        expect(links()).toHaveLength(0);
        await interact(() => { button().click(); });
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        await interact(() => { outside.focus(); });
        expect(links()).toHaveLength(0);
        outside.remove();
    });
    it('closes the mobile navigation after selection', async () => {
        await interact(() => { button().click(); });
        links()[0]?.addEventListener('click', (event) => { event.preventDefault(); });
        await key(' ');
        expect(select).toHaveBeenCalledOnce();
        expect(links()).toHaveLength(0);
    });
});
