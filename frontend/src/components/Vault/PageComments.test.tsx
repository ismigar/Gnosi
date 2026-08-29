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

import { toast } from '../../lib/toast';
import {
    createVaultPageComment,
    deleteVaultPageComment,
    fetchVaultPageComments,
    updateVaultPageComment,
    type VaultPageComment,
    type VaultPageCommentPatch,
} from '../../shared/api/vault-comments';
import {
    removeStorage,
    writeStorage,
} from '../../shared/platform/browser-storage';
import PageComments, { type PageCommentsProps } from './PageComments';
import { commentAuthorStorageKey } from './page-comments/storage';


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
const apiState = vi.hoisted(() => ({ role: 'admin' }));


vi.mock('../../hooks/use-api', () => ({
    useApi: () => apiState,
}));


vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../i18n', () => ({
    default: { language: 'ca' },
}));


vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));


vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../shared/api/vault-comments', () => ({
    createVaultPageComment: vi.fn(),
    deleteVaultPageComment: vi.fn(),
    fetchVaultPageComments: vi.fn(),
    updateVaultPageComment: vi.fn(),
}));


vi.mock('../ConfirmModal', () => ({
    ConfirmModal: ({
        isOpen,
        onClose,
        onConfirm,
        title,
    }: MockConfirmModalProps) => isOpen ? (
        <div aria-label="confirmation" role="dialog">
            <span>{title}</span>
            <button
                onClick={() => {
                    void onConfirm();
                }}
                type="button"
            >
                Confirm deletion
            </button>
            <button onClick={onClose} type="button">Cancel confirmation</button>
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


const createCommentMock = vi.mocked(createVaultPageComment);
const deleteCommentMock = vi.mocked(deleteVaultPageComment);
const fetchCommentsMock = vi.mocked(fetchVaultPageComments);
const updateCommentMock = vi.mocked(updateVaultPageComment);
const errorToastMock = vi.mocked(toast.error);


let container: HTMLDivElement;
let root: Root;


function comment(
    id: string,
    body: string,
    resolved = false,
): VaultPageComment {
    return {
        author: 'Isabel',
        author_id: null,
        body,
        created_at: '2026-08-29T12:00:00Z',
        id,
        resolved,
        updated_at: null,
    };
}


function requiredButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}


function requiredButtonByTitle(title: string): HTMLButtonElement {
    const button = document.body.querySelector(`button[title="${title}"]`);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${title}`);
    }
    return button;
}


function requiredTextarea(selector: string): HTMLTextAreaElement {
    const textarea = document.body.querySelector(selector);
    if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error(`Missing textarea: ${selector}`);
    }
    return textarea;
}


function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
    )?.set?.bind(textarea);
    if (!setValue) throw new Error('Missing native textarea value setter');
    act(() => {
        setValue(value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


function click(element: HTMLElement): void {
    act(() => {
        element.click();
    });
}


async function flushPromises(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}


async function renderComments(
    overrides: Partial<PageCommentsProps> = {},
): Promise<ReturnType<typeof vi.fn<() => void>>> {
    const onClose = vi.fn<() => void>();
    await act(async () => {
        root.render(
            <PageComments
                onClose={onClose}
                open
                pageId="page-1"
                pageTitle="Projecte Gnosi"
                {...overrides}
            />,
        );
        await Promise.resolve();
    });
    await flushPromises();
    return onClose;
}


beforeEach(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    apiState.role = 'admin';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    removeStorage(commentAuthorStorageKey);
    fetchCommentsMock.mockReset().mockResolvedValue({
        comments: [comment('comment-1', 'Primer comentari')],
    });
    createCommentMock.mockReset().mockResolvedValue(
        comment('comment-2', 'Comentari nou'),
    );
    updateCommentMock.mockReset().mockImplementation((
        _pageId,
        commentId,
        input: VaultPageCommentPatch,
    ) => Promise.resolve(comment(
        commentId,
        input.body ?? 'Primer comentari',
        input.resolved ?? false,
    )));
    deleteCommentMock.mockReset().mockResolvedValue({
        id: 'comment-1',
        status: 'deleted',
    });
    errorToastMock.mockReset();
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    removeStorage(commentAuthorStorageKey);
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});


describe('PageComments', () => {
    it('loads the thread and exposes dialog and close semantics', async () => {
        const onClose = await renderComments();
        expect(fetchCommentsMock).toHaveBeenCalledWith('page-1');
        expect(document.body.textContent).toContain('Primer comentari');
        expect(document.body.querySelector('[role="dialog"]')).toBeInstanceOf(HTMLDivElement);
        const close = document.body.querySelector('.gnosi-close-btn');
        if (!(close instanceof HTMLButtonElement)) throw new Error('Missing close button');
        click(close);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('keeps viewers read-only and hides every mutation control', async () => {
        apiState.role = 'viewer';
        await renderComments();
        expect(document.body.textContent)
            .toContain('Your role only allows reading comments');
        expect(document.body.querySelector('textarea')).toBeNull();
        expect(document.body.querySelector('button[title="Edit"]')).toBeNull();
        expect(document.body.querySelector('button[title="Delete"]')).toBeNull();
    });

    it('creates a trimmed comment with the stored author using the shortcut', async () => {
        writeStorage(commentAuthorStorageKey, 'isabel@example.test');
        await renderComments();
        const composer = requiredTextarea(
            'textarea[placeholder="Write a comment… (⌘+Enter to send)"]',
        );
        setTextareaValue(composer, '  Comentari nou  ');
        act(() => {
            composer.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                ctrlKey: true,
                key: 'Enter',
            }));
        });
        await flushPromises();
        expect(createCommentMock).toHaveBeenCalledWith('page-1', {
            author: 'isabel',
            body: 'Comentari nou',
        });
        expect(document.body.textContent).toContain('Comentari nou');
        expect(composer.value).toBe('');
    });

    it('edits and resolves a comment through the existing actions', async () => {
        await renderComments();
        click(requiredButtonByTitle('Edit'));
        const editor = requiredTextarea('textarea:not([placeholder])');
        setTextareaValue(editor, 'Comentari editat');
        click(requiredButton('Save'));
        await flushPromises();
        expect(updateCommentMock).toHaveBeenCalledWith(
            'page-1',
            'comment-1',
            { body: 'Comentari editat' },
        );
        expect(document.body.textContent).toContain('Comentari editat');

        click(requiredButtonByTitle('Mark as resolved'));
        await flushPromises();
        expect(updateCommentMock).toHaveBeenLastCalledWith(
            'page-1',
            'comment-1',
            { resolved: true },
        );
        expect(document.body.textContent).toContain('Resolved');
    });

    it('confirms deletion and removes the comment from the thread', async () => {
        await renderComments();
        click(requiredButtonByTitle('Delete'));
        expect(document.body.textContent).toContain('Delete comment');
        click(requiredButton('Confirm deletion'));
        await flushPromises();
        expect(deleteCommentMock).toHaveBeenCalledWith('page-1', 'comment-1');
        expect(document.body.textContent).toContain('No comments yet');
    });

    it('shows the permission-specific mutation error for backend 403', async () => {
        createCommentMock.mockRejectedValue({ status: 403 });
        await renderComments();
        const composer = requiredTextarea(
            'textarea[placeholder="Write a comment… (⌘+Enter to send)"]',
        );
        setTextareaValue(composer, 'Intent prohibit');
        click(requiredButtonByTitle('Send'));
        await flushPromises();
        expect(errorToastMock).toHaveBeenCalledWith(
            'Your role does not allow modifying comments',
        );
    });
});
