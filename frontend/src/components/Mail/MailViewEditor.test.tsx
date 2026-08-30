import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import type { MailView, MailViewCreate } from '../../shared/api/mail';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import MailViewEditor from './MailViewEditor';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string): string => fallback ?? key,
    }),
}));


vi.mock('@dnd-kit/core', () => ({
    closestCenter: (): null => null,
    DndContext: ({ children }: { readonly children: ReactNode }) => children,
    KeyboardSensor: (): null => null,
    PointerSensor: (): null => null,
    useSensor: (...configuration: readonly unknown[]): readonly unknown[] => configuration,
    useSensors: (...sensors: readonly unknown[]): readonly unknown[] => sensors,
}));


vi.mock('@dnd-kit/sortable', () => ({
    sortableKeyboardCoordinates: (): null => null,
    SortableContext: ({ children }: { readonly children: ReactNode }) => children,
    useSortable: () => ({
        attributes: {},
        isDragging: false,
        listeners: {},
        setNodeRef: (): void => {},
        transform: null,
        transition: undefined,
    }),
    verticalListSortingStrategy: {},
}));


vi.mock('@dnd-kit/utilities', () => ({
    CSS: { Transform: { toString: (): undefined => undefined } },
}));


interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}


const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const initialView: MailView = {
    actions: ['reply'],
    created_at: '2026-08-01T10:00:00Z',
    fields: [
        { key: 'subject', order: 0, visible: true, width: 320 },
        { key: 'sender', order: 1, visible: false, width: null },
    ],
    filter_logic: 'OR',
    filters: [{ field: 'sender', operator: 'contains', value: 'openai.com' }],
    group_by: 'sender',
    id: 'view-1',
    name: 'Research',
    sort_by: 'subject',
    sort_dir: 'asc',
    updated_at: '2026-08-02T10:00:00Z',
};


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
    vi.clearAllMocks();
});


function buttonWithText(text: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.trim() === text);
    if (!button) throw new Error(`Missing button: ${text}`);
    return button;
}


function inputWithPlaceholder(placeholder: string): HTMLInputElement {
    const input = container.querySelector(`input[placeholder="${placeholder}"]`);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing input: ${placeholder}`);
    }
    return input;
}


function selectWithOption(optionValue: string): HTMLSelectElement {
    const select = [...container.querySelectorAll('select')].find((candidate) => (
        candidate.querySelector(`option[value="${optionValue}"]`) !== null
    ));
    if (!select) throw new Error(`Missing select option: ${optionValue}`);
    return select;
}


function setInputValue(input: HTMLInputElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setValue) throw new Error('Missing native input value setter');
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


function setSelectValue(select: HTMLSelectElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
    )?.set?.bind(select);
    if (!setValue) throw new Error('Missing native select value setter');
    act(() => {
        setValue(value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}


function click(button: HTMLButtonElement): void {
    act(() => {
        button.click();
    });
}


async function submit(form: HTMLFormElement): Promise<void> {
    await act(async () => {
        form.dispatchEvent(new SubmitEvent('submit', {
            bubbles: true,
            cancelable: true,
        }));
        await Promise.resolve();
        await Promise.resolve();
    });
}


describe('MailViewEditor', () => {
    it('validates and submits the complete configured new-view payload', async () => {
        const onCancel = vi.fn<() => void>();
        const onSave = vi.fn<(data: MailViewCreate) => Promise<void>>()
            .mockResolvedValue(undefined);
        act(() => {
            root.render(<MailViewEditor onCancel={onCancel} onSave={onSave} />);
        });
        const form = container.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('Missing editor form');

        expect(container.textContent).toContain('New view');
        await submit(form);
        expect(container.textContent).toContain('A name is required for the view');
        expect(onSave).not.toHaveBeenCalled();

        setInputValue(
            inputWithPlaceholder('E.g.: Newsletters, Work...'),
            'Newsletters',
        );
        click(buttonWithText('Add filter'));
        click(buttonWithText('Add filter'));
        click(buttonWithText('OR'));
        setSelectValue(selectWithOption('is_read'), 'is_read');
        setSelectValue(selectWithOption('false'), 'false');
        click(buttonWithText('Archive'));
        click(buttonWithText('Star'));
        const sortDirection = container.querySelector('button[title="Descending"]');
        if (!(sortDirection instanceof HTMLButtonElement)) {
            throw new Error('Missing sort direction button');
        }
        click(sortDirection);
        await submit(form);

        expect(onSave).toHaveBeenCalledTimes(1);
        const payload = onSave.mock.calls.at(0)?.at(0);
        expect(payload).toMatchObject({
            actions: ['trash', 'mark_read', 'star'],
            filter_logic: 'OR',
            filters: [
                { field: 'is_read', operator: 'is', value: false },
                { field: 'sender', operator: 'contains', value: '' },
            ],
            group_by: 'none',
            name: 'Newsletters',
            sort_by: 'date',
            sort_dir: 'asc',
        });
        expect(payload?.fields).toHaveLength(10);
    });

    it('preserves edit metadata, reports save errors, and closes by every route', async () => {
        const onCancel = vi.fn<() => void>();
        const onSave = vi.fn<(data: MailViewCreate) => Promise<void>>()
            .mockRejectedValue(new Error('Could not save'));
        act(() => {
            root.render(
                <MailViewEditor
                    initialView={initialView}
                    onCancel={onCancel}
                    onSave={onSave}
                />,
            );
        });
        const form = container.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('Missing editor form');

        expect(container.textContent).toContain('Edit view');
        expect(inputWithPlaceholder('E.g.: Newsletters, Work...').value).toBe('Research');
        await submit(form);
        expect(onSave).toHaveBeenCalledWith(initialView);
        expect(container.textContent).toContain('Could not save');

        click(buttonWithText('Cancel'));
        act(() => {
            dispatchWindowEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Escape',
            }));
        });
        const overlay = container.firstElementChild;
        if (!(overlay instanceof HTMLDivElement)) throw new Error('Missing overlay');
        act(() => {
            overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(onCancel).toHaveBeenCalledTimes(3);
    });
});
