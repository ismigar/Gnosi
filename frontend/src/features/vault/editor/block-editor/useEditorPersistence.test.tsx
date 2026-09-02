import { act, useState, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { GnosiApiError } from '../../../../shared/api/errors';
import { logError, notifyError } from '../../../../shared/notifications/notifyError';
import { inFlightSaves } from '../editorState';
import { useEditorPersistence, type EditorPersistenceOptions, type SaveStatus } from './useEditorPersistence';
import type { CodeEditorMetadata } from './codeTypes';

vi.mock('../../../../shared/api/vaults', () => ({ patchVaultPage: vi.fn() }));
vi.mock('../../../../shared/notifications/notifyError', () => ({ logError: vi.fn(), notifyError: vi.fn() }));
vi.mock('react-i18next', () => {
    const t = (key: string) => key;
    return { useTranslation: () => ({ t }) };
});
const patch = vi.mocked(patchVaultPage);
const response = { id: 'page', content: '', metadata: {}, title: 'Page', folder: '', message: '', status: 'ok' };
const cleanups: (() => void)[] = [];

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers(); vi.clearAllMocks(); inFlightSaves.clear();
    patch.mockResolvedValue(response);
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await act(async () => { await Promise.resolve(); });
    vi.clearAllTimers(); vi.useRealTimers(); inFlightSaves.clear();
});
function Harness(props: Omit<EditorPersistenceOptions, 'setSaveStatus'>) {
    const [status, setSaveStatus] = useState<SaveStatus>('idle');
    const save = useEditorPersistence({ ...props, setSaveStatus });
    return <button onClick={() => { void save(); }}>{status}</button>;
}
function fixture(options: Partial<Omit<EditorPersistenceOptions, 'setSaveStatus' | 'editor'>> = {}, removable = false) {
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn(() => { listener = undefined; });
    const editor = {
        document: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body', styles: {} }] }],
        onChange: (next: () => void) => { listener = next; return removable ? { remove: unsubscribe } : unsubscribe; },
    };
    const metadataRef: RefObject<CodeEditorMetadata> = { current: { title: 'Document', status: 'draft' } };
    const onUpdate = vi.fn(); const onOutgoingLinksChange = vi.fn();
    const view = mountTestComponent(<Harness editor={editor} noteFilename="page" metadataRef={metadataRef} isParsing={false} editorReady onUpdate={onUpdate} onOutgoingLinksChange={onOutgoingLinksChange} {...options} />);
    cleanups.push(view.unmount);
    return { ...view, editor, metadataRef, onUpdate, onOutgoingLinksChange, unsubscribe, change: () => { act(() => { listener?.(); }); } };
}
async function advance(milliseconds: number) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }
async function flush() { await act(async () => { await Promise.resolve(); }); }

describe('rich editor persistence', () => {
    it('does not save on open/close and unsubscribes either supported listener contract', async () => {
        const view = fixture({}, true); await advance(800); view.unmount();
        expect(patch).not.toHaveBeenCalled(); expect(view.unsubscribe).toHaveBeenCalledOnce();
    });
    it('debounces changes for 700ms and keeps callback content a string', async () => {
        const view = fixture(); view.change(); await advance(500); view.change();
        await advance(699); expect(patch).not.toHaveBeenCalled();
        await advance(1);
        expect(patch).toHaveBeenCalledExactlyOnceWith('page', { title: 'Document', content: 'Body', metadata: view.metadataRef.current });
        expect(view.onUpdate).toHaveBeenCalledWith('page', 'Body', { title: 'Document', metadata: view.metadataRef.current });
        expect(view.container.textContent).toBe('saved'); expect(inFlightSaves.has('page')).toBe(false);
        await advance(3000); expect(view.container.textContent).toBe('idle');
    });
    it('flushes latest metadata on close and retains cache for the one-second handoff', async () => {
        const view = fixture(); view.change();
        view.metadataRef.current = { title: 'Revised', status: 'complete' };
        view.unmount(); await flush();
        expect(patch).toHaveBeenCalledExactlyOnceWith('page', { title: 'Revised', content: 'Body', metadata: view.metadataRef.current });
        expect(view.onUpdate).toHaveBeenCalledOnce(); expect(inFlightSaves.has('page')).toBe(true);
        await advance(1000); expect(inFlightSaves.has('page')).toBe(false);
    });
    it('never clears a newer in-flight promise when an older save completes', async () => {
        let resolve: (value: typeof response) => void = () => { throw new Error('Missing save'); };
        patch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const view = fixture(); view.change(); await advance(700);
        const newer = Promise.resolve(response);
        inFlightSaves.set('page', { promise: newer, content: 'Newer', metadata: {}, timestamp: 42 });
        await act(async () => { resolve(response); await Promise.resolve(); });
        expect(inFlightSaves.get('page')?.promise).toBe(newer);
    });
    it('publishes only changed outgoing signatures without delaying them to autosave', () => {
        const view = fixture({ idToTitle: { target: 'Target' } });
        const text = view.editor.document[0]?.content[0];
        if (!text) throw new Error('Missing fixture paragraph');
        text.text = '[[Target]]';
        view.change(); view.change();
        expect(view.onOutgoingLinksChange).toHaveBeenCalledOnce();
        expect(view.onOutgoingLinksChange).toHaveBeenCalledWith([{ id: 'target', title: 'Target', resolved: true }]);
        expect(patch).not.toHaveBeenCalled();
    });
    it('does not subscribe during parsing or save manually before ready', async () => {
        const parsing = fixture({ isParsing: true }); parsing.change(); await advance(800);
        expect(patch).not.toHaveBeenCalled();
        const notReady = fixture({ editorReady: false });
        const button = notReady.container.querySelector('button');
        if (!button) throw new Error('Missing save action');
        await act(async () => { button.click(); await Promise.resolve(); });
        expect(patch).not.toHaveBeenCalled();
    });
    it('reports an autosave failure and logs an unmount flush failure without rejection leaks', async () => {
        patch.mockRejectedValue(new Error('offline'));
        const view = fixture(); view.change(); await advance(700);
        expect(view.container.textContent).toBe('error'); expect(notifyError).toHaveBeenCalledOnce();
        view.change(); view.unmount(); await flush();
        expect(logError).toHaveBeenCalledWith('unmount-save', expect.any(Error));
    });
    it('retries a transient cloud conflict with the latest metadata and no error toast', async () => {
        patch
            .mockRejectedValueOnce(new GnosiApiError(
                new Response('{}', { status: 503, headers: { 'Retry-After': '2' } }),
                { detail: 'warming' },
            ))
            .mockResolvedValueOnce(response);
        const view = fixture();
        view.change();
        await advance(700);
        expect(patch).toHaveBeenCalledTimes(1);
        expect(view.container.textContent).toBe('saving');
        expect(notifyError).not.toHaveBeenCalled();

        view.metadataRef.current = { title: 'Latest', status: 'complete' };
        await advance(2000);
        expect(patch).toHaveBeenCalledTimes(2);
        expect(patch).toHaveBeenLastCalledWith('page', {
            title: 'Latest',
            content: 'Body',
            metadata: view.metadataRef.current,
        });
        expect(view.container.textContent).toBe('saved');
        expect(notifyError).not.toHaveBeenCalled();
    });
});
