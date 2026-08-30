import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '../../../shared/notifications/toast';
import {
    emptyVaultTrash,
    fetchVaultTrash,
    purgeVaultTrashPage,
    restoreVaultPage,
    type VaultTrash,
    type VaultTrashEntry,
} from '../../../shared/api/vaults';
import { VaultTrashView, type VaultTrashViewProps } from './VaultTrashView';


interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}


interface MockConfirmModalProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onConfirm: () => unknown;
    readonly title?: ReactNode;
}


const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;


vi.mock('../../../shared/i18n/i18n', () => ({ default: { language: 'en' } }));


vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../../shared/api/vaults', () => ({
    emptyVaultTrash: vi.fn(),
    fetchVaultTrash: vi.fn(),
    purgeVaultTrashPage: vi.fn(),
    restoreVaultPage: vi.fn(),
}));


vi.mock('../../../shared/ui/dialogs/ConfirmModal', () => ({
    ConfirmModal: ({
        isOpen,
        onClose,
        onConfirm,
        title,
    }: MockConfirmModalProps) => isOpen ? (
        <div aria-label="confirmation" role="dialog">
            <span>{title}</span>
            <button
                type="button"
                onClick={() => { void onConfirm(); }}
            >
                Confirm action
            </button>
            <button type="button" onClick={onClose}>Cancel action</button>
        </div>
    ) : null,
}));


function translate(
    key: string,
    fallback?: string | { readonly defaultValue?: string },
): string {
    if (typeof fallback === 'string') return fallback;
    return fallback?.defaultValue ?? key;
}


vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));


const emptyTrashMock = vi.mocked(emptyVaultTrash);
const fetchTrashMock = vi.mocked(fetchVaultTrash);
const purgeTrashMock = vi.mocked(purgeVaultTrashPage);
const restorePageMock = vi.mocked(restoreVaultPage);
const errorToastMock = vi.mocked(toast.error);
const successToastMock = vi.mocked(toast.success);


let container: HTMLDivElement;
let root: Root;


function trashEntry(
    id: string,
    title: string,
    overrides: Partial<VaultTrashEntry> = {},
): VaultTrashEntry {
    return {
        days_remaining: 30,
        deleted_at: '2026-08-29T12:00:00Z',
        id,
        original_path: `notes/${id}.md`,
        size_bytes: 2048,
        title,
        ...overrides,
    };
}


function trashResponse(items: VaultTrashEntry[]): VaultTrash {
    return { items, retention_days: 90 };
}


function requiredButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}


function requiredInput(): HTMLInputElement {
    const input = document.body.querySelector('input[type="text"]');
    if (!(input instanceof HTMLInputElement)) {
        throw new Error('Missing trash search input');
    }
    return input;
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


function click(element: HTMLElement): void {
    act(() => { element.click(); });
}


async function flushPromises(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}


async function renderTrash(
    overrides: Partial<VaultTrashViewProps> = {},
): Promise<ReturnType<typeof vi.fn<() => void>>> {
    const onAfterChange = vi.fn<() => void>();
    await act(async () => {
        root.render(
            <VaultTrashView onAfterChange={onAfterChange} {...overrides} />,
        );
        await Promise.resolve();
    });
    await flushPromises();
    return onAfterChange;
}


beforeEach(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchTrashMock.mockReset().mockResolvedValue(trashResponse([
        trashEntry('alpha', 'Alpha note', { days_remaining: 4 }),
        trashEntry('beta', 'Beta report'),
    ]));
    restorePageMock.mockReset().mockResolvedValue({
        id: 'alpha',
        status: 'restored',
    });
    purgeTrashMock.mockReset().mockResolvedValue({
        freed_bytes: 2048,
        id: 'alpha',
        status: 'purged',
    });
    emptyTrashMock.mockReset().mockResolvedValue({
        failed_count: 0,
        failed_ids: [],
        freed_bytes: 4096,
        purged_count: 2,
        status: 'emptied',
    });
    errorToastMock.mockReset();
    successToastMock.mockReset();
});


afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});


describe('VaultTrashView', () => {
    it('loads trash entries and filters by title, id, or original path', async () => {
        await renderTrash();

        expect(document.body.textContent).toContain('Alpha note');
        expect(document.body.textContent).toContain('Beta report');
        expect(document.body.textContent).toContain('{{count}}d');

        setInputValue(requiredInput(), 'beta');

        expect(document.body.textContent).not.toContain('Alpha note');
        expect(document.body.textContent).toContain('Beta report');
    });

    it('restores an entry, refreshes the trash, and notifies its parent', async () => {
        const onAfterChange = await renderTrash();

        click(requiredButton('Restore'));
        await flushPromises();

        expect(restorePageMock).toHaveBeenCalledWith('alpha');
        expect(fetchTrashMock).toHaveBeenCalledTimes(2);
        expect(successToastMock).toHaveBeenCalledWith('success.page_restored');
        expect(onAfterChange).toHaveBeenCalledOnce();
    });

    it('reports a restore conflict without refreshing or notifying', async () => {
        restorePageMock.mockRejectedValueOnce({ response: { status: 409 } });
        const onAfterChange = await renderTrash();

        click(requiredButton('Restore'));
        await flushPromises();

        expect(errorToastMock).toHaveBeenCalledWith(
            'A file already exists at the original destination',
        );
        expect(fetchTrashMock).toHaveBeenCalledOnce();
        expect(onAfterChange).not.toHaveBeenCalled();
    });

    it('purges one confirmed entry and refreshes the trash', async () => {
        const onAfterChange = await renderTrash();

        click(requiredButton('Purge'));
        click(requiredButton('Confirm action'));
        await flushPromises();

        expect(purgeTrashMock).toHaveBeenCalledWith('alpha');
        expect(fetchTrashMock).toHaveBeenCalledTimes(2);
        expect(successToastMock).toHaveBeenCalledWith('Permanently deleted');
        expect(onAfterChange).toHaveBeenCalledOnce();
    });

    it('empties all entries in one request after confirmation', async () => {
        const onAfterChange = await renderTrash();

        click(requiredButton('Empty trash'));
        click(requiredButton('Confirm action'));
        await flushPromises();

        expect(emptyTrashMock).toHaveBeenCalledOnce();
        expect(fetchTrashMock).toHaveBeenCalledTimes(2);
        expect(successToastMock).toHaveBeenCalledWith(
            'Trash emptied ({{count}} items)',
        );
        expect(onAfterChange).toHaveBeenCalledOnce();
    });
});
