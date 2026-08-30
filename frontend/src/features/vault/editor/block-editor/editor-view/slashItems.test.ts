import { beforeAll, describe, expect, it, vi } from 'vitest';
import { slashItems, slashSuggestions } from './slashItems';
import { quickLinkItems } from './quickLinkItems';
import { blockItems } from './blockItems';
import { aiItems } from './aiItems';
import { columnLayoutAdapter, menuItemKey, turnIntoAdapter, turnIntoUpdate } from './catalogAdapters';
import { menuItem, translationsReady, viewInputs } from './test-support';

beforeAll(async () => { await translationsReady; });

describe('editor slash command compatibility', () => {
    it('rejects synchronous catalog failures as a Promise like the original async callback', async () => {
        const inputs = viewInputs();
        Object.defineProperty(inputs, 'allTables', { get() { throw new Error('catalog unavailable'); } });
        await expect(slashSuggestions('', inputs)).rejects.toThrow('catalog unavailable');
    });
    it('keeps AI first, caps the empty menu at twelve, searches aliases and replaces native emoji only', () => {
        const inputs = viewInputs();
        const initial = slashItems('', inputs);
        expect(initial).toHaveLength(12);
        expect(initial.slice(0, 3).map(item => item.title)).toEqual(['Ask AI…', 'Continue writing', 'Summarize the page']);
        const emoji = slashItems('emoji', inputs).find(item => menuItemKey(item) === 'emoji');
        expect(emoji).toBeDefined(); emoji?.onItemClick();
        expect(inputs.openInlineIconPicker).toHaveBeenCalledOnce();
        expect(slashItems('file', inputs).some(item => menuItemKey(item) === 'file')).toBe(false);
        expect(slashItems('TUR', inputs)).toHaveLength(14);
        expect(slashItems('youtube', inputs).map(item => item.title)).toEqual(['Insert content…']);
    });

    it('captures the cursor before opening a table view and clears a missing cursor safely', () => {
        const inputs = viewInputs();
        const tables = { ...inputs, allTables: [{ id: 'books', name: 'Llibres' }] };
        menuItem(slashItems('Llibres', tables), 'Llibres').onItemClick();
        expect(inputs.capturePageViewAnchor).toHaveBeenLastCalledWith('fixture-anchor');
        expect(inputs.onOpenPageViewModal).toHaveBeenLastCalledWith('books');
        vi.spyOn(inputs.editor, 'getTextCursorPosition').mockImplementation(() => { throw new Error('unmounted'); });
        menuItem(slashItems('Llibres', tables), 'Llibres').onItemClick();
        expect(inputs.capturePageViewAnchor).toHaveBeenLastCalledWith(null);
        expect(inputs.onOpenPageViewModal).toHaveBeenCalledTimes(2);
    });

    it('routes all three AI modes without creating local modal state', () => {
        const inputs = viewInputs();
        for (const item of aiItems(inputs)) item.onItemClick();
        expect(inputs.openAICommand.mock.calls).toEqual([['free'], ['continue'], ['summarize']]);
    });

    it('applies unified insertion to the captured anchor, accepts batches, and ignores empty results', async () => {
        const inputs = viewInputs();
        const command = menuItem(quickLinkItems(inputs), 'Insert content…');
        inputs.requestInsertContent.mockResolvedValue({ items: [{ url: '/files/a.pdf', name: 'A', kind: 'pdf' }], mode: 'link' });
        await command.onItemClick();
        expect(inputs.requestInsertContent).toHaveBeenCalledWith({ initialTab: 'vault' });
        expect(inputs.applyInsertResult.mock.calls[0]?.[0]).toEqual({ items: [{ url: '/files/a.pdf', name: 'A', kind: 'pdf' }], mode: 'link' });
        expect(inputs.applyInsertResult.mock.calls[0]?.[1]).toEqual(inputs.editor.document[0]);
        inputs.applyInsertResult.mockClear(); inputs.requestInsertContent.mockResolvedValue({});
        await command.onItemClick(); expect(inputs.applyInsertResult).not.toHaveBeenCalled();
    });

    it('silences cancellation/supersession but reports unexpected insertion errors', async () => {
        const inputs = viewInputs(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const command = menuItem(quickLinkItems(inputs), 'Insert content…');
        inputs.requestInsertContent.mockRejectedValue(new Error('cancelled')); await command.onItemClick();
        inputs.requestInsertContent.mockRejectedValue(new Error('superseded')); await command.onItemClick();
        expect(warn).not.toHaveBeenCalled();
        inputs.requestInsertContent.mockRejectedValue(new Error('failed')); await command.onItemClick();
        expect(warn).toHaveBeenCalledWith('insert content cancelled:', 'failed');
    });

    it('retains wiki/section/alias/transclusion syntax and citation modal behavior', () => {
        const inputs = viewInputs(); const insert = vi.spyOn(inputs.editor, 'insertInlineContent').mockImplementation(() => undefined);
        const commands = quickLinkItems(inputs);
        menuItem(commands, 'editor.internal_link').onItemClick();
        expect(inputs.insertWikiLink).toHaveBeenCalledWith('editor.note_name_placeholder');
        menuItem(commands, 'editor.link_to_section').onItemClick();
        expect(insert).toHaveBeenLastCalledWith('[[editor.note_section_placeholder]]');
        menuItem(commands, 'editor.wiki_link_with_alias').onItemClick();
        expect(insert).toHaveBeenLastCalledWith('[[editor.note_alias_placeholder]]');
        menuItem(commands, 'editor.section_transclusion').onItemClick();
        expect(insert).toHaveBeenLastCalledWith('![[editor.note_section_transclusion_placeholder]]');
        menuItem(commands, 'editor.transclusion_with_alias').onItemClick();
        expect(insert).toHaveBeenLastCalledWith('![[editor.transclusion_alias_placeholder]]');
        menuItem(commands, 'Insert citation…').onItemClick();
        expect(inputs.setIsCitePickerOpen).toHaveBeenCalledWith(true);
    });

    it('preserves native column children and typed heading updates; the legacy unregistered toggle still fails', () => {
        const inputs = viewInputs(); const insert = vi.spyOn(inputs.editor, 'insertBlocks');
        columnLayoutAdapter(inputs.editor).insertBlocks([{ type: 'columnList', children: [
            { type: 'column', children: [{ type: 'paragraph' }] }, { type: 'column', children: [{ type: 'paragraph' }] },
        ] }], inputs.editor.document[0], 'after');
        expect(insert.mock.calls[0]?.[0]).toEqual([{ type: 'columnList', children: [
            { type: 'column', children: [{ type: 'paragraph' }] }, { type: 'column', children: [{ type: 'paragraph' }] },
        ] }]);
        expect(turnIntoUpdate({ type: 'heading', props: { level: 2, isToggleable: true } })).toEqual({ type: 'heading', props: { level: 2, isToggleable: true } });
        expect(() => turnIntoUpdate({ type: 'toggle', props: {} })).toThrow('Unrecognized');
        turnIntoAdapter(inputs.editor).updateBlock('fixture-anchor', { type: 'heading', props: { level: 2 } });
        expect(inputs.editor.getBlock('fixture-anchor')?.type).toBe('heading');
    });

    it('generates distinct inline footnote payloads and opens link-card context on the same editor', () => {
        const inputs = viewInputs(); const insert = vi.spyOn(inputs.editor, 'insertInlineContent').mockImplementation(() => undefined);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555');
        const commands = blockItems(inputs);
        menuItem(commands, 'Footnote').onItemClick();
        expect(insert).toHaveBeenCalledWith([{ type: 'footnote', props: { id: '11111111-2222-3333-4444-555555555555', content: '' } }, ' ']);
        menuItem(commands, 'Link card').onItemClick();
        expect(inputs.setLinkCardCtx).toHaveBeenCalledWith({ editor: inputs.editor });
    });

    it.each([
        ['Automatic bibliography', 'bibliography', { style: 'apa', locale: 'en-US' }],
        ['editor.obsidian_transclusion', 'transclusion', { target: '', alias: '', section: '' }],
        ['Callout', 'alert', { type: 'info' }],
        ['Table of contents', 'tableOfContents', {}],
        ['Mermaid diagram', 'mermaid', { code: '' }],
        ['Synced block', 'synced', { sync_id: '11111111-2222-3333-4444-555555555555' }],
    ])('keeps the real %s block payload', (title, type, expectedProps) => {
        const inputs = viewInputs();
        const cursor = vi.spyOn(inputs.editor, 'setTextCursorPosition');
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555');
        menuItem([...quickLinkItems(inputs), ...blockItems(inputs)], title).onItemClick();
        const inserted = inputs.editor.document.find(block => block.type === type);
        expect(inserted?.props).toMatchObject(expectedProps);
        if (type === 'alert') {
            expect(inserted?.children[0]?.type).toBe('paragraph');
            expect(cursor).toHaveBeenCalledWith(inserted?.children[0], 'start');
        }
    });
});
