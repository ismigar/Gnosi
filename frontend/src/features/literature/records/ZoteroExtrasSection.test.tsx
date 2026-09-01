import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZoteroExtrasSection } from './ZoteroExtrasSection';


const mocks = vi.hoisted(() => ({
    promoteZoteroExtra: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: string | { readonly defaultValue?: string }) => (
            typeof options === 'string' ? options : options?.defaultValue ?? key
        ),
    }),
}));

vi.mock('../../../shared/notifications/toast', () => ({
    toast: {
        error: mocks.toastError,
        success: mocks.toastSuccess,
    },
}));

vi.mock('../../../shared/api/resource-lookup', () => ({
    promoteZoteroExtra: mocks.promoteZoteroExtra,
}));


function inputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    );
    if (!descriptor?.set) throw new Error('Input value setter is unavailable');
    const setValue = descriptor.set.bind(input);
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


function buttonWithTitle(title: string): HTMLButtonElement {
    const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.title === title);
    if (!button) throw new Error(`Missing button: ${title}`);
    return button;
}


describe('ZoteroExtrasSection', () => {
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
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('edits a scalar field while keeping structured values read-only', () => {
        const onChange = vi.fn();
        act(() => {
            root.render(
                <ZoteroExtrasSection
                    extras={{ conferenceName: 'Old', metadata: { source: 'Zotero' } }}
                    onChange={onChange}
                />,
            );
        });
        const inputs = container.querySelectorAll('input');
        const editable = inputs.item(0);
        const structured = inputs.item(1);
        inputValue(editable, 'New');

        expect(onChange).toHaveBeenCalledWith({
            conferenceName: 'New',
            metadata: { source: 'Zotero' },
        });
        expect(structured.disabled).toBe(true);
    });

    it('removes the whole extras key when the final field is deleted', () => {
        const onChange = vi.fn();
        const onRemoveAll = vi.fn();
        act(() => {
            root.render(
                <ZoteroExtrasSection
                    extras={{ patentNumber: 'P-1' }}
                    onChange={onChange}
                    onRemoveAll={onRemoveAll}
                />,
            );
        });
        act(() => {
            buttonWithTitle('Delete this field').click();
        });

        expect(onRemoveAll).toHaveBeenCalledOnce();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('adds a unique trimmed field', () => {
        const onChange = vi.fn();
        act(() => {
            root.render(<ZoteroExtrasSection extras={{ place: 'BCN' }} onChange={onChange} />);
        });
        const keyInput = container.querySelector<HTMLInputElement>('input[placeholder="new field"]');
        const valueInput = container.querySelector<HTMLInputElement>('input[placeholder="value"]');
        if (!keyInput || !valueInput) throw new Error('Missing new field controls');
        inputValue(keyInput, '  archiveLocation ');
        inputValue(valueInput, '  Room 2 ');
        act(() => {
            buttonWithTitle('Add field').click();
        });

        expect(onChange).toHaveBeenCalledWith({
            place: 'BCN',
            archiveLocation: 'Room 2',
        });
    });

    it('promotes an extra field and reports the typed result', async () => {
        const result = {
            column_created: true,
            column_id: 'column-1',
            column_name: 'conferenceName',
            conflicts: [],
            errors: [],
            migrated: 3,
        };
        mocks.promoteZoteroExtra.mockResolvedValue(result);
        const onPromoted = vi.fn();
        act(() => {
            root.render(
                <ZoteroExtrasSection
                    extras={{ conferenceName: 'GnosiConf' }}
                    onPromoted={onPromoted}
                    tableId="table-1"
                />,
            );
        });
        act(() => {
            buttonWithTitle('Promote to registry column').click();
        });
        const apply = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent === 'Apply');
        if (!apply) throw new Error('Promotion dialog did not open');
        await act(async () => {
            apply.click();
            await Promise.resolve();
        });

        expect(mocks.promoteZoteroExtra).toHaveBeenCalledWith({
            column_name: 'conferenceName',
            column_type: 'text',
            table_id: 'table-1',
            zotero_field: 'conferenceName',
        });
        expect(onPromoted).toHaveBeenCalledWith(result);
        expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    });
});
