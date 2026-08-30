import { act, useLayoutEffect } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../test/mount-react';
import { createVaultPage } from '../../../shared/api/vaults';
import { notifyError } from '../../../lib/notifyError';
import { useLinkCommands, type LinkEditor } from './useLinkCommands';
import type { EditorBlock } from './schema';

vi.mock('../../../shared/api/vaults', () => ({ createVaultPage: vi.fn() }));
vi.mock('../../../lib/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
const cleanups: (() => void)[] = [];
const response = { id: 'created', content: '', metadata: {}, title: 'Created', folder: '', message: '', status: 'ok' };

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(createVaultPage).mockResolvedValue(response); });
afterEach(() => { cleanups.splice(0).forEach(cleanup => { cleanup(); }); vi.clearAllTimers(); vi.useRealTimers(); });

function fixture(text: string, missingCursor = false) {
    const block: EditorBlock = { id: 'block', type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, content: [{ type: 'text', text, styles: {} }], children: [] };
    const editor = {
        document: [block], getTextCursorPosition: () => missingCursor ? {} : { block },
        insertInlineContent: vi.fn<LinkEditor['insertInlineContent']>(), updateBlock: vi.fn<LinkEditor['updateBlock']>(),
        replaceBlocks: vi.fn<LinkEditor['replaceBlocks']>(), insertBlocks: vi.fn<LinkEditor['insertBlocks']>(),
    } satisfies LinkEditor;
    const handleSave = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onRefreshNotes = vi.fn();
    let controller: ReturnType<typeof useLinkCommands> | null = null;
    function Harness() {
        const value = useLinkCommands({ editor, handleSave, onRefreshNotes });
        useLayoutEffect(() => { controller = value; });
        return null;
    }
    cleanups.push(mountTestComponent(<Harness />).unmount);
    const current = () => { if (!controller) throw new Error('Uncommitted controller'); return controller; };
    return { editor, handleSave, onRefreshNotes, current };
}
async function advance(time: number) { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); }

describe('editor link commands', () => {
    it('atomically replaces typed query and schedules a save after 100ms', async () => {
        const view = fixture('See [[Mer]]');
        view.current().insertWikiLink('Mercè', 'Section', 'page', 'Mer');
        expect(view.editor.updateBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'block' }), { content: [
            { type: 'text', text: 'See ', styles: {} }, { type: 'wikilink', props: { title: 'Mercè > Section', target: 'page', section: 'Section' } },
        ] });
        await advance(99); expect(view.handleSave).not.toHaveBeenCalled(); await advance(1); expect(view.handleSave).toHaveBeenCalledOnce();
    });
    it('inserts directly when cursor is unavailable and keeps the legacy no-save branch', async () => {
        const view = fixture('Body', true); view.current().insertWikiLink('Target');
        expect(view.editor.insertInlineContent).toHaveBeenCalledWith([{ type: 'wikilink', props: { title: 'Target', target: 'Target', section: '' } }]);
        await advance(100); expect(view.handleSave).not.toHaveBeenCalled();
    });
    it('replaces an empty transclusion trigger but preserves leading text in a separate block', () => {
        const empty = fixture('![[Note'); empty.current().insertTransclusion('id', 'Alias', '^part');
        expect(empty.editor.replaceBlocks).toHaveBeenCalledWith([expect.objectContaining({ id: 'block' })], [{ type: 'transclusion', props: { target: 'id', alias: 'Alias', section: '^part' } }]);
        const prefixed = fixture('Before ![[Note'); prefixed.current().insertTransclusion('id');
        expect(prefixed.editor.updateBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'block' }), { content: [{ type: 'text', text: 'Before', styles: {} }] });
        expect(prefixed.editor.insertBlocks).toHaveBeenCalledOnce();
    });
    it('uses document tail for a transclusion without a current cursor', () => {
        const view = fixture('Body', true); view.current().insertTransclusion('id');
        expect(view.editor.insertBlocks).toHaveBeenCalledWith([{ type: 'transclusion', props: { target: 'id', alias: '', section: '' } }], view.editor.document[0], 'after');
    });
    it('inserts citations directly, with the original Markdown fallback on unsupported editors', () => {
        const view = fixture('Body'); view.current().insertCitation(' doe ');
        expect(view.editor.insertInlineContent).toHaveBeenCalledWith([{ type: 'cite', props: { citationKey: 'doe' } }, ' ']);
        view.editor.insertInlineContent.mockImplementationOnce(() => { throw new Error('Missing cite spec'); });
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try { view.current().insertCitation('other'); expect(view.editor.insertInlineContent).toHaveBeenLastCalledWith('[@other] '); expect(warning).toHaveBeenCalledOnce(); }
        finally { warning.mockRestore(); }
    });
    it('deduplicates page creation and preserves table metadata, insertion and delayed refresh', async () => {
        const view = fixture('');
        await act(async () => { await Promise.all([
            view.current().createMissingPageAndInsertLink({ rawTitle: '[[New|Alias', tableId: 'table' }),
            view.current().createMissingPageAndInsertLink({ rawTitle: '[[New|Alias', tableId: 'table' }),
        ]); });
        expect(createVaultPage).toHaveBeenCalledExactlyOnceWith({ title: 'New', content: '', is_database: false, metadata: { title: 'New', table_id: 'table', database_table_id: 'table' } });
        expect(view.editor.insertInlineContent).toHaveBeenCalledWith([{ type: 'wikilink', props: { title: 'New', target: 'created', section: '' } }]);
        await advance(1400); expect(view.onRefreshNotes).toHaveBeenCalledOnce();
    });
    it('reports failed creation and releases the dedupe key after 800ms', async () => {
        vi.mocked(createVaultPage).mockRejectedValue(new Error('offline'));
        const view = fixture('');
        await view.current().createMissingPageAndInsertLink({ rawTitle: 'New' });
        expect(notifyError).toHaveBeenCalledOnce(); expect(view.editor.insertInlineContent).not.toHaveBeenCalled();
        await advance(800); await view.current().createMissingPageAndInsertLink({ rawTitle: 'New' });
        expect(createVaultPage).toHaveBeenCalledTimes(2);
    });
});
