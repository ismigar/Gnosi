import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../test/mount-react';
import { SingleSelectPill } from './SingleSelectPill';
import { click, mouseDown, requiredElement } from './test-support';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
afterEach(() => { vi.restoreAllMocks(); });

describe('editor single table picker', () => {
    it('shows a title or placeholder, keeps the original inline dropdown and saves an exact table id', () => {
        const change = vi.fn();
        const { container } = mountTestComponent(<SingleSelectPill value="" options={['books', 'notes']}
            idToTitle={{ books: 'Llibres', notes: 'Notes' }} placeholder="Tria taula" onChange={change} />);
        expect(container.textContent).toBe('Tria taula');
        click(requiredElement(HTMLDivElement, '.cursor-pointer', container));
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
        const menu = requiredElement(HTMLDivElement, '.absolute', container);
        expect(menu.textContent).toContain('editor.select_table');
        click(requiredElement(HTMLDivElement, '.cursor-pointer', menu));
        expect(change).toHaveBeenCalledExactlyOnceWith('books');
        expect(container.querySelector('.absolute')).toBeNull();
    });

    it('retains selected styling and closes only on outside mousedown', () => {
        const change = vi.fn();
        const { container, unmount } = mountTestComponent(<SingleSelectPill value="books" options={['books']}
            idToTitle={{ books: 'Llibres' }} onChange={change} />);
        expect(container.textContent).toBe('Llibres');
        click(requiredElement(HTMLDivElement, '.cursor-pointer', container));
        const selected = requiredElement(HTMLDivElement, '.absolute .cursor-pointer', container);
        expect(selected.classList.contains('font-medium')).toBe(true);
        mouseDown(selected);
        expect(container.querySelector('.absolute')).not.toBeNull();
        mouseDown(document.body);
        expect(container.querySelector('.absolute')).toBeNull();
        expect(change).not.toHaveBeenCalled();
        unmount();
        expect(() => { mouseDown(document.body); }).not.toThrow();
    });

    it('handles an absent catalog without inventing or clearing the selected value', () => {
        const change = vi.fn();
        const { container } = mountTestComponent(<SingleSelectPill value="legacy" options={null}
            idToTitle={{}} onChange={change} />);
        expect(container.textContent).toBe('legacy');
        click(requiredElement(HTMLDivElement, '.cursor-pointer', container));
        expect(requiredElement(HTMLDivElement, '.absolute', container).querySelector('.cursor-pointer')).toBeNull();
        expect(change).not.toHaveBeenCalled();
    });
});
