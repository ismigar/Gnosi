import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { logError, notifyError } from '../../../../shared/notifications/notifyError';
import { toast } from '../../../../shared/notifications/toast';
import { MarkdownCodeEditor } from './MarkdownCodeEditor';
import { codeContent, type MarkdownCodeEditorProps } from './codeTypes';
import { inFlightSaves } from '../editorState';
import { type EditorView } from '@codemirror/view';
import { markdownView as textarea, replaceMarkdown as change, mockCodeMirrorLayout } from '../../../../../tests/helpers/codemirror';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
mockCodeMirrorLayout();

vi.mock('../../../../shared/api/vaults', () => ({ patchVaultPage: vi.fn() }));
vi.mock('../../../../shared/notifications/notifyError', () => ({ logError: vi.fn(), notifyError: vi.fn() }));
vi.mock('../../../../shared/notifications/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('../../../../shared/editor/VaultMarkdown', () => ({ default: ({ md }: { md: string }) => <output data-preview-content>{md}</output> }));
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
    removeStorage(defineStorageKey('gnosi:markdown-preview', stringStorageCodec));
    removeStorage(defineStorageKey('gnosi:markdown-vim', stringStorageCodec));
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
async function advance(milliseconds: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
async function forceSave(element: EditorView) {
    await act(async () => {
        element.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
        await Promise.resolve();
    });
}

describe('Markdown code editor persistence', () => {
    it('registers a stable flush that saves pending edits before another page operation', async () => {
        const registerSave = vi.fn<(flush: (() => Promise<boolean>) | null) => void>();
        const { container, unmount } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" registerSave={registerSave} />);
        const flush = registerSave.mock.calls[0]?.[0];
        if (!flush) throw new Error('Missing flush callback');
        change(textarea(container), 'Latest pending');
        expect(registerSave).toHaveBeenCalledTimes(1);
        let saved = false;
        await act(async () => { saved = await flush(); });
        expect(saved).toBe(true);
        expect(patch).toHaveBeenCalledExactlyOnceWith('page', expect.objectContaining({ content: 'Latest pending' }));
        await advance(1000);
        unmount();
        expect(registerSave).toHaveBeenLastCalledWith(null);
        expect(patch).toHaveBeenCalledTimes(1);
    });
    it('reports a failed flush so a following page operation can stop safely', async () => {
        const registerSave = vi.fn<(flush: (() => Promise<boolean>) | null) => void>();
        const { container } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" registerSave={registerSave} />);
        const flush = registerSave.mock.calls[0]?.[0];
        if (!flush) throw new Error('Missing flush callback');
        change(textarea(container), 'Pending');
        patch.mockRejectedValueOnce(new Error('Write failed'));
        let saved = true;
        await act(async () => { saved = await flush(); });
        expect(saved).toBe(false);
    });
    it('shows the full current draft in preview without triggering a save', async () => {
        const { container } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" />);
        const toggle = container.querySelector<HTMLElement>('[aria-label="editor.source_preview"]');
        await act(async () => { toggle?.click(); await Promise.resolve(); });
        change(textarea(container), 'Unsaved preview');
        expect(container.querySelector('[data-preview-content]')?.textContent).toBe('Unsaved preview');
        expect(patch).not.toHaveBeenCalled();
    });
    it('accepts external changes again once the current draft has been saved', async () => {
        const { container, render } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" />);
        change(textarea(container), 'Saved');
        await advance(900);
        expect(textarea(container).state.doc.toString()).toBe('Saved');
        render(<MarkdownCodeEditor noteFilename="page" initialContent="New server content" />);
        expect(textarea(container).state.doc.toString()).toBe('New server content');
        await advance(1000);
        expect(patch).toHaveBeenCalledTimes(1);
    });
    it('refuses keyboard saves for a locked or viewer page', async () => {
        const { container } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" readOnly />);
        await forceSave(textarea(container));
        expect(patch).not.toHaveBeenCalled();
        expect(textarea(container).state.readOnly).toBe(true);
    });
    it('serializes slow saves so an earlier response cannot overwrite later typing', async () => {
        let completeFirst: (() => void) | undefined;
        patch.mockImplementationOnce(() => new Promise(resolve => { completeFirst = () => { resolve({ id: 'page', content: '', metadata: {}, title: 'Page', folder: '', message: '', status: 'ok' }); }; }));
        const update = vi.fn<NonNullable<MarkdownCodeEditorProps['onUpdate']>>();
        const { container } = mount(<MarkdownCodeEditor noteFilename="page" initialContent="Original" onUpdate={update} />);
        change(textarea(container), 'First'); await advance(900);
        change(textarea(container), 'Second'); await advance(900);
        expect(patch).toHaveBeenCalledTimes(1);
        expect(inFlightSaves.get('page')?.content).toBe('Second');
        await act(async () => { completeFirst?.(); await Promise.resolve(); });
        expect(patch).toHaveBeenCalledTimes(2);
        expect(patch).toHaveBeenLastCalledWith('page', expect.objectContaining({ content: 'Second' }));
        expect(textarea(container).state.doc.toString()).toBe('Second');
        expect(update.mock.calls.map(call => call[1])).toEqual(['First', 'Second']);
    });
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
        expect(textarea(container).state.doc.toString()).toBe('Server update');
        change(textarea(container), 'Unsaved typing');
        render(<MarkdownCodeEditor noteFilename="page" initialContent="Stale echo" />);
        expect(textarea(container).state.doc.toString()).toBe('Unsaved typing');
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
        expect(textarea(container).state.doc.toString()).toBe('Two');
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
