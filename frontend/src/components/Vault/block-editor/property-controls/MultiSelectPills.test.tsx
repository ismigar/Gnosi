import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../test/mount-react';
import { MultiSelectPills } from './MultiSelectPills';
import type { MultiSelectPillsProps, PropertySelection } from './types';
import { click, inputValue, key, mouseDown, openPicker, option, portal, requiredElement, search } from './test-support';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
afterEach(() => { vi.restoreAllMocks(); });

function Controlled(props: Omit<MultiSelectPillsProps, 'value'> & { initial: PropertySelection }) {
    const [value, setValue] = useState(props.initial);
    return <MultiSelectPills {...props} value={value} onChange={next => { setValue(next); props.onChange(next); }} />;
}

describe('editor multi-select property control', () => {
    it('adds choices immediately, hides selected options and removes one pill without opening the menu', async () => {
        const change = vi.fn();
        const { container } = mountTestComponent(<Controlled initial={['a']} options={['a', 'b', 'c']}
            idToTitle={{ a: 'Mercè', b: 'Bernat', c: 'Clara' }} onChange={change} />);
        await openPicker(container);
        expect(portal().textContent).not.toContain('Mercè');
        click(option('Bernat'));
        expect(change).toHaveBeenLastCalledWith(['a', 'b']);
        expect(portal().textContent).not.toContain('Bernat');
        key(search(), 'Escape');
        click(requiredElement(HTMLElement, '[title="Delete"]', container));
        expect(change).toHaveBeenLastCalledWith(['b']);
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
    });

    it('reads JSON selection and retains numeric/boolean scalar payloads on addition', async () => {
        const change = vi.fn();
        const { container } = mountTestComponent(<MultiSelectPills value='[0,false,"a"]'
            options={['a', 'b']} idToTitle={{ a: 'Mercè', b: 'Bernat' }} onChange={change} />);
        await openPicker(container);
        click(option('Bernat'));
        expect(change).toHaveBeenCalledWith([0, false, 'a', 'b']);
    });

    it('single mode includes the current option, deselects it to empty text, replaces and closes', async () => {
        const change = vi.fn();
        const { container } = mountTestComponent(<Controlled initial="a" single options={['a', 'b']}
            idToTitle={{ a: 'Mercè', b: 'Bernat' }} onChange={change} placeholder="Tria" />);
        await openPicker(container);
        click(option('Mercè'));
        expect(change).toHaveBeenLastCalledWith('');
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
        expect(container.textContent).toBe('Tria');
        await openPicker(container);
        click(option('Bernat'));
        expect(change).toHaveBeenLastCalledWith('b');
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
    });

    it('renders rich chip colors and menu dots while preserving option names', async () => {
        const { container } = mountTestComponent(<MultiSelectPills value="Mercè" options={[
            { name: 'Mercè', color: 'blue' }, { name: 'Educació', color: 'green' },
        ]} idToTitle={{}} onChange={vi.fn()} />);
        expect(requiredElement(HTMLSpanElement, 'span[style]', container).style.color).toBe('rgb(59, 130, 246)');
        await openPicker(container);
        expect(requiredElement(HTMLSpanElement, 'span[style]', option('Educació')).style.backgroundColor).toBe('rgb(34, 197, 94)');
    });

    it('filters titles without accents and resets highlight after changing search or reopening', async () => {
        const change = vi.fn();
        const { container } = mountTestComponent(<MultiSelectPills value={[]} options={['e', 'h', 'm']}
            idToTitle={{ e: 'Educació', h: 'Història', m: 'Mercè' }} onChange={change} />);
        await openPicker(container);
        key(search(), 'ArrowDown');
        inputValue(search(), 'EDUCACIO');
        key(search(), 'Enter');
        expect(change).toHaveBeenLastCalledWith(['e']);
        inputValue(search(), '');
        key(search(), 'ArrowDown');
        key(search(), 'Escape');
        await openPicker(container);
        key(search(), 'Enter');
        expect(change).toHaveBeenLastCalledWith(['e']);
    });

    it('bounds keyboard navigation, scrolls the highlight and prevents default without selecting an empty list', async () => {
        const scroll = vi.fn();
        const change = vi.fn();
        const { container } = mountTestComponent(<MultiSelectPills value={[]} options={['a', 'b']}
            idToTitle={{}} onChange={change} />);
        await openPicker(container);
        const last = option('b');
        Object.defineProperty(last, 'scrollIntoView', { value: scroll, configurable: true });
        expect(key(search(), 'ArrowDown').defaultPrevented).toBe(true);
        key(search(), 'ArrowDown');
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
        key(search(), 'Enter');
        expect(change).toHaveBeenLastCalledWith(['b']);
        key(search(), 'ArrowUp'); key(search(), 'ArrowUp');
        key(search(), 'Enter');
        expect(change).toHaveBeenLastCalledWith(['a']);
        inputValue(search(), 'nonexistent');
        change.mockClear();
        key(search(), 'ArrowDown'); key(search(), 'Enter');
        expect(change).not.toHaveBeenCalled();
    });

    it('creates the exact entered text without selecting locally, clears search, and stays open in multi mode', async () => {
        const create = vi.fn(); const change = vi.fn();
        const { container } = mountTestComponent(<MultiSelectPills value={[]} options={[]}
            idToTitle={{}} onChange={change} onCreate={create} />);
        await openPicker(container);
        inputValue(search(), ' Nou ');
        key(search(), 'Enter');
        expect(create).toHaveBeenCalledWith(' Nou ');
        expect(change).not.toHaveBeenCalled();
        expect(search().value).toBe('');
    });

    it('closes after single-value creation and does not offer creation for an exact existing name', async () => {
        const create = vi.fn();
        const { container } = mountTestComponent(<MultiSelectPills single options={['Nou']}
            idToTitle={{}} onChange={vi.fn()} onCreate={create} />);
        await openPicker(container);
        inputValue(search(), 'Nou');
        expect(portal().querySelector('button')).toBeNull();
        inputValue(search(), 'Nou 2');
        click(requiredElement(HTMLButtonElement, 'button', portal()));
        expect(create).toHaveBeenCalledWith('Nou 2');
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
    });

    it('deletes the catalog option without selecting it or closing the portal', async () => {
        const remove = vi.fn(); const change = vi.fn();
        const { container } = mountTestComponent(<MultiSelectPills options={['a', 'b']}
            idToTitle={{}} onChange={change} onDeleteOption={remove} />);
        await openPicker(container);
        const button = requiredElement(HTMLElement, '[role="button"]', option('b'));
        mouseDown(button); click(button);
        expect(remove).toHaveBeenCalledWith('b');
        expect(change).not.toHaveBeenCalled();
        expect(document.querySelector('[data-property-dropdown]')).not.toBeNull();
    });

    it('ignores portaled and anchor mousedown but closes on an outside text node', async () => {
        const { container, unmount } = mountTestComponent(<MultiSelectPills options={['a']}
            idToTitle={{}} onChange={vi.fn()} />);
        await openPicker(container);
        mouseDown(search()); mouseDown(container.firstElementChild ?? container);
        expect(document.querySelector('[data-property-dropdown]')).not.toBeNull();
        const outside = document.createTextNode('outside'); document.body.appendChild(outside);
        act(() => { outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
        outside.remove();
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
        unmount();
        expect(() => { mouseDown(document.body); }).not.toThrow();
    });

    it('forwards relation open/remove IDs without toggling or opening the picker; false preserves the value', async () => {
        const open = vi.fn(); const remove = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(false);
        const change = vi.fn();
        const { container } = mountTestComponent(<MultiSelectPills value={['note-1', 'note-2']} relationItems
            idToTitle={{ 'note-1': 'Mercè' }} onChange={change} onOpenRelation={open} onRemoveRelation={remove} />);
        const chip = requiredElement(HTMLSpanElement, '[data-relation-item="note-1"]', container);
        click(requiredElement(HTMLButtonElement, '[title="Open in a new tab"]', chip));
        expect(open).toHaveBeenCalledWith('note-1');
        const button = requiredElement(HTMLButtonElement, '[title="Remove from this record"]', chip);
        await act(async () => { button.click(); await Promise.resolve(); });
        expect(remove).toHaveBeenCalledWith('note-1');
        expect(change).not.toHaveBeenCalled();
        expect(container.querySelectorAll('[data-relation-item]')).toHaveLength(2);
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
        expect(button.disabled).toBe(false);
    });
});
