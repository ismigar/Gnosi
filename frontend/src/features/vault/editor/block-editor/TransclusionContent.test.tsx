import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import { TransclusionContent } from './TransclusionContent';
import { GnosiApiError } from '../../../../shared/api/errors';

const mocks = vi.hoisted(() => ({
    patch: vi.fn(), notify: vi.fn(), listener: null as null | (() => void),
    editor: { document: 'initial', replaceBlocks: vi.fn(), onChange: vi.fn() },
}));
vi.mock('@blocknote/react', () => ({ useCreateBlockNote: () => mocks.editor }));
vi.mock('@blocknote/mantine', () => ({ BlockNoteView: ({ editable }: { editable: boolean }) => <div data-editable={editable} /> }));
vi.mock('./schema', () => ({ createEditorSchema: () => ({}) }));
vi.mock('./blockValues', () => ({ readEditorBlocks: (blocks: unknown) => blocks }));
vi.mock('./useMediaUpload', () => ({ useMediaUpload: () => vi.fn() }));
vi.mock('../locales/registry', () => ({ resolveBlockNoteDictionary: () => ({}) }));
vi.mock('../../../../shared/hooks/useTheme', () => ({ useTheme: () => ({ effectiveTheme: 'light' }) }));
vi.mock('../../../../shared/api/vaults', () => ({ patchVaultPage: mocks.patch }));
vi.mock('../../../../shared/notifications/notifyError', () => ({ notifyError: mocks.notify }));
vi.mock('../../../../shared/editor/markdown-mapper', () => ({
    richMarkdownToBlocks: (source: string) => Promise.resolve([source]),
    blocksToRichMarkdown: (document: string) => document,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ca' } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const context: VaultEditorContextValue = { allTables: [], idToTitle: {}, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null, pageId: 'original', registry: { databases: [], tables: [], views: [] } };
const page = { id: 'original', content: '# Section\nOld\n# Other\nKeep\n', etag: 'revision-1', metadata: { title: 'Original' }, title: 'Original', folder: '' };
async function render(section = '', editable = true) {
    await act(async () => { await Promise.resolve(); root.render(<TransclusionContent page={page} section={section} context={{ ...context, isEditable: editable }} />); });
}
async function edit(content: string) {
    await act(async () => { await Promise.resolve(); mocks.editor.document = content; mocks.listener?.(); });
}
async function autosave() { await act(async () => { await vi.advanceTimersByTimeAsync(700); }); }

beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    mocks.editor.document = 'initial';
    mocks.editor.onChange.mockImplementation((listener: () => void) => { mocks.listener = listener; return () => { mocks.listener = null; }; });
    mocks.patch.mockImplementation((_id: string, input: { content: string }) => Promise.resolve({ content: input.content, etag: 'revision-2' }));
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { await Promise.resolve(); root.unmount(); }); container.remove(); vi.useRealTimers(); });

describe('editable transclusion persistence', () => {
    it('never saves hydration, and saves to the original with its own revision and no metadata', async () => {
        await render(); expect(mocks.patch).not.toHaveBeenCalled();
        const content = '**Edited**\n' + 'Complete content\n'.repeat(100);
        await edit(content); await autosave();
        expect(mocks.patch).toHaveBeenCalledWith('original', { content, expected_etag: 'revision-1' }, { context: undefined });
    });
    it('preserves the surrounding sections', async () => {
        await render('Section'); await edit('Updated'); await autosave();
        expect(mocks.patch).toHaveBeenCalledWith('original', { content: '# Section\nUpdated\n# Other\nKeep\n', expected_etag: 'revision-1' }, { context: undefined });
    });
    it('serializes edits made during a save with the returned revision', async () => {
        let finish!: (value: unknown) => void;
        mocks.patch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await render(); await edit('First'); await autosave();
        await edit('Second'); await autosave(); expect(mocks.patch).toHaveBeenCalledTimes(1);
        await act(async () => { await Promise.resolve(); finish({ content: 'First', etag: 'revision-2' }); });
        expect(mocks.patch).toHaveBeenLastCalledWith('original', { content: 'Second', expected_etag: 'revision-2' }, { context: undefined });
    });
    it('flushes pending changes when leaving the note', async () => {
        await render(); await edit('Pending'); await act(async () => { await Promise.resolve(); root.unmount(); });
        expect(mocks.patch).toHaveBeenCalledWith('original', { content: 'Pending', expected_etag: 'revision-1' }, { context: undefined });
    });
    it('keeps the draft and pauses saves after a failure', async () => {
        mocks.patch.mockRejectedValue(new Error('Offline'));
        await render(); await edit('Draft'); await autosave();
        expect(mocks.notify).toHaveBeenCalled();
        await edit('More draft'); await autosave();
        expect(mocks.patch).toHaveBeenCalledTimes(1);
        expect(mocks.editor.document).toBe('More draft');
        expect(container.textContent).toContain('common.retry');
    });
    it('does not overwrite a newer original after a revision conflict', async () => {
        mocks.patch.mockRejectedValue(new GnosiApiError(new Response(null, { status: 409 }), { detail: 'Conflict' }));
        await render(); await edit('Local draft'); await autosave();
        expect(container.textContent).toContain('editor.transclusion_conflict');
        expect(mocks.editor.document).toBe('Local draft');
        await edit('Newer local draft'); await autosave();
        expect(mocks.patch).toHaveBeenCalledTimes(1);
        expect(mocks.patch).toHaveBeenCalledWith('original', { content: 'Local draft', expected_etag: 'revision-1' }, { context: undefined });
    });
    it('respects read-only access', async () => {
        await render('', false);
        expect(container.querySelector('[data-editable="false"]')).not.toBeNull();
        expect(mocks.editor.onChange).not.toHaveBeenCalled();
        await autosave(); expect(mocks.patch).not.toHaveBeenCalled();
    });
});
