import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { logError, notifyError } from '../../../../shared/notifications/notifyError';
import { toast } from '../../../../shared/notifications/toast';
import { MarkdownCodeEditor } from './MarkdownCodeEditor';
import { codeContent } from './codeTypes';
import { inFlightSaves } from '../editorState';

vi.mock('../../../../shared/api/vaults', () => ({ patchVaultPage: vi.fn() }));
vi.mock('../../../../shared/notifications/notifyError', () => ({ logError: vi.fn(), notifyError: vi.fn() }));
vi.mock('../../../../shared/notifications/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('react-i18next', () => {
    const t = (key: string) => key;
    return { useTranslation: () => ({ t }) };
});
const patch = vi.mocked(patchVaultPage);
const cleanups: (() => void)[] = [];

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    vi.clearAllMocks();
    inFlightSaves.clear();
    patch.mockResolvedValue({ id: 'page', content: '', metadata: {}, title: 'Page', folder: '', message: '', status: 'ok' });
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await act(async () => { await Promise.resolve(); });
    vi.clearAllTimers();
    inFlightSaves.clear();
    vi.useRealTimers();
});

function mount(element: ReactElement) {
    const result = mountTestComponent(element);
    cleanups.push(result.unmount);
    return result;
}
function textarea(container: HTMLElement) {
    const element = container.querySelector('textarea');
    if (!element) throw new Error('Missing Markdown textarea');
    return element;
}
function change(element: HTMLTextAreaElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Missing textarea setter');
    act(() => {
        descriptor.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function advance(milliseconds: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
async function forceSave(element: HTMLTextAreaElement) {
    await act(async () => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
        await Promise.resolve();
    });
}

describe('Markdown code editor persistence', () => {
    it('never saves simply because a page was opened or closed', async () => {
        const { unmount } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" />);
        await advance(1200);
        unmount();
        expect(patch).not.toHaveBeenCalled();
    });
    it('debounces user changes for 900ms and sends the exact page, metadata and callback payload', async () => {
        const update = vi.fn(); const refresh = vi.fn();
        const metadata = { title: 'Document', status: 'draft' };
        const { container } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" metadata={metadata}
            onUpdate={update} onRefreshNotes={refresh} />);
        change(textarea(container), 'First');
        await advance(500);
        change(textarea(container), 'Latest');
        await advance(899);
        expect(patch).not.toHaveBeenCalled();
        await advance(1);
        expect(patch).toHaveBeenCalledExactlyOnceWith('page', { title: 'Document', content: 'Latest', metadata });
        expect(update).toHaveBeenCalledWith('page', 'Latest', { title: 'Document', metadata });
        expect(refresh).toHaveBeenCalledOnce();
    });
    it('accepts clean external content but protects dirty typing from stale save echoes', async () => {
        const { container, render } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" />);
        render(<MarkdownCodeEditor noteFilename="page" initialContent="Server update" />);
        expect(textarea(container).value).toBe('Server update');
        change(textarea(container), 'Unsaved typing');
        render(<MarkdownCodeEditor noteFilename="page" initialContent="Stale echo" />);
        expect(textarea(container).value).toBe('Unsaved typing');
        await advance(900);
        expect(patch).toHaveBeenLastCalledWith('page', expect.objectContaining({ content: 'Unsaved typing' }));
    });
    it('flushes pending text on close, and does not flush again after a completed save', async () => {
        const first = mount(<MarkdownCodeEditor noteFilename="first" initialContent="Original" />);
        change(textarea(first.container), 'Pending');
        first.unmount();
        await advance(0);
        expect(patch).toHaveBeenCalledExactlyOnceWith('first', expect.objectContaining({ content: 'Pending' }));
        const second = mount(<MarkdownCodeEditor noteFilename="second" initialContent="Original" />);
        change(textarea(second.container), 'Saved');
        await advance(900);
        expect(patch).toHaveBeenCalledTimes(2);
        second.unmount();
        expect(patch).toHaveBeenCalledTimes(2);
    });
    it('flushes the previous page to its own id when a caller switches props without remounting', async () => {
        const update = vi.fn();
        const { container, render } = mount(<MarkdownCodeEditor noteFilename="first" initialContent="One"
            metadata={{ title: 'First' }} onUpdate={update} />);
        change(textarea(container), 'Unsaved first');
        render(<MarkdownCodeEditor noteFilename="second" initialContent="Two" metadata={{ title: 'Second' }} onUpdate={update} />);
        await advance(0);
        expect(textarea(container).value).toBe('Two');
        expect(patch).toHaveBeenCalledExactlyOnceWith('first', { title: 'First', content: 'Unsaved first', metadata: { title: 'First' } });
        expect(update).toHaveBeenCalledWith('first', 'Unsaved first', { title: 'First', metadata: { title: 'First' } });
        await advance(1200);
        expect(patch).toHaveBeenCalledTimes(1);
    });
    it('uses the latest metadata and callbacks when flushing the same page', async () => {
        const oldUpdate = vi.fn(); const latestUpdate = vi.fn();
        const { container, render, unmount } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="One"
            metadata={{ title: 'Old' }} onUpdate={oldUpdate} />);
        change(textarea(container), 'Pending');
        render(<MarkdownCodeEditor noteFilename="page" initialContent="One" metadata={{ title: 'New' }} onUpdate={latestUpdate} />);
        unmount(); await advance(0);
        expect(patch).toHaveBeenLastCalledWith('page', expect.objectContaining({ title: 'New', content: 'Pending' }));
        expect(oldUpdate).not.toHaveBeenCalled();
        expect(latestUpdate).toHaveBeenCalledOnce();
    });
    it('reports keyboard save success and distinguishes explicit failures from silent autosaves', async () => {
        const { container } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" />);
        await forceSave(textarea(container));
        expect(toast.success).toHaveBeenCalledWith('editor.markdown_saved');
        const error = new Error('Fixture save failure');
        patch.mockRejectedValueOnce(error);
        await forceSave(textarea(container));
        expect(notifyError).toHaveBeenCalledWith('save-markdown', error, 'editor.markdown_save_error');
        patch.mockRejectedValueOnce(error);
        change(textarea(container), 'Changed');
        await advance(900);
        expect(logError).toHaveBeenCalledWith('save-markdown', error);
    });
    it('emits outgoing-link changes immediately and refuses saves without a page id', async () => {
        const outgoing = vi.fn();
        const { container } = mount(<MarkdownCodeEditor initialContent="" idToTitle={{ one: 'Mercè' }} onOutgoingLinksChange={outgoing} />);
        change(textarea(container), '[[Mercè]]');
        expect(outgoing).toHaveBeenCalledWith([{ id: 'one', title: 'Mercè', resolved: true }]);
        await advance(900); await forceSave(textarea(container));
        expect(patch).not.toHaveBeenCalled();
    });
});

describe('legacy Markdown payload coercion', () => {
    it('handles text, content wrappers, object payloads and circular objects safely', () => {
        expect(codeContent('text')).toBe('text');
        expect(codeContent({ content: 'wrapped' })).toBe('wrapped');
        expect(codeContent({ title: 'Only title' })).toBe('{\n  "title": "Only title"\n}');
        expect(codeContent(null)).toBe('');
        expect(codeContent(42)).toBe('42');
        const circular: Record<string, unknown> = {}; circular.self = circular;
        expect(codeContent(circular)).toBe('');
    });
});
