import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoriaDisplay, AutoriaEditor } from './AutoriaField';


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));


function setInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Input value setter is unavailable');
    const setValue = descriptor.set.bind(input);
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


describe('AutoriaField', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('renders normalized author pills and an explicit empty state', () => {
        act(() => {
            root.render(<AutoriaDisplay value={[{ nom: 'Joan', cognom1: 'Fuster' }]} />);
        });
        expect(container.textContent).toContain('Joan Fuster');
        expect(container.querySelector('span')?.title).toBe('Fuster, Joan');

        act(() => {
            root.render(<AutoriaDisplay emptyText="Sense autoria" value="legacy value" />);
        });
        expect(container.textContent).toBe('Sense autoria');
    });

    it('adds an author and commits only after leaving the editor', () => {
        const onSave = vi.fn();
        act(() => {
            root.render(<AutoriaEditor onSave={onSave} />);
        });
        const add = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Add author'));
        if (!add) throw new Error('Add-author action did not render');
        act(() => {
            add.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        const firstName = container.querySelector<HTMLInputElement>('input[placeholder="First name"]');
        if (!firstName) throw new Error('Author inputs did not render');
        setInputValue(firstName, 'Mercè');
        const surname = container.querySelector<HTMLInputElement>('input[placeholder="Surname 1"]');
        if (!surname) throw new Error('Surname input did not render');
        setInputValue(surname, 'Rodoreda');
        expect(onSave).not.toHaveBeenCalled();
        act(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });

        expect(onSave).toHaveBeenCalledWith([
            { nom: 'Mercè', cognom1: 'Rodoreda', cognom2: '' },
        ]);
    });

    it('does not erase a legacy value when no structured author was added', () => {
        const onSave = vi.fn();
        act(() => {
            root.render(<AutoriaEditor onSave={onSave} value="Mercè Rodoreda" />);
        });
        act(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });

        expect(onSave).not.toHaveBeenCalled();
    });

    it('selects a matching existing author with the keyboard', () => {
        const onSave = vi.fn();
        act(() => {
            root.render(
                <AutoriaEditor
                    onSave={onSave}
                    suggestions={[{ nom: 'Isabel', cognom1: 'Clara', cognom2: 'Simó' }]}
                    value={[{ nom: 'Isa', cognom1: '', cognom2: '' }]}
                />,
            );
        });
        const firstName = container.querySelector<HTMLInputElement>('input[placeholder="First name"]');
        if (!firstName) throw new Error('First-name input did not render');
        act(() => {
            firstName.focus();
        });
        act(() => {
            firstName.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        const currentFirstName = container.querySelector<HTMLInputElement>('input[placeholder="First name"]');
        if (!currentFirstName) throw new Error('First-name input disappeared');
        act(() => {
            currentFirstName.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        act(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });

        expect(onSave).toHaveBeenCalledWith([
            { nom: 'Isabel', cognom1: 'Clara', cognom2: 'Simó' },
        ]);
    });
});
