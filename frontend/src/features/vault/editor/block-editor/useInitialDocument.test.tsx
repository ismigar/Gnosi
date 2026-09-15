import { BlockNoteEditor } from '@blocknote/core';
import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { blocksToRichMarkdown } from '../../../../shared/editor/markdown-mapper';
import type { VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import { createEditorSchema, type PartialEditorBlock } from './schema';
import { useInitialDocument, type InitialDocumentOptions } from './useInitialDocument';

const context: VaultEditorContextValue = {
    allTables: [], idToTitle: {}, pageId: null, registry: { databases: [], tables: [], views: [] },
    onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null,
};
const schema = createEditorSchema(context);
const source = '```gnosi-view\n{"view_id":"journal","heading":"","heading_level":1}\n```';

function Harness(props: Omit<InitialDocumentOptions, 'setBlocks' | 'setIsParsing'>) {
    const [, setBlocks] = useState<PartialEditorBlock[] | null>(null);
    const [isParsing, setIsParsing] = useState(true);
    const error = useInitialDocument({ ...props, setBlocks, setIsParsing });
    return <output>{error ? error.message : isParsing ? 'loading' : 'ready'}</output>;
}

async function flush() {
    await act(async () => { await Promise.resolve(); });
}

describe('initial rich document hydration', () => {
    it('keeps a single embedded view and its block id across save/context updates', async () => {
        const editor = BlockNoteEditor.create({ schema });
        const replace = vi.spyOn(editor, 'replaceBlocks');
        const props = { editor, schema, noteFilename: 'page', initialContent: source };
        const view = mountTestComponent(<Harness {...props} />);
        await flush();
        expect(view.container.textContent).toBe('ready');
        expect(replace).toHaveBeenCalledOnce();
        expect(editor.document[0]?.type).toBe('gnosi_view');
        const id = editor.document[0]?.id;
        const changed = vi.fn();
        const unsubscribe = editor.onChange(changed);

        for (let update = 0; update < 3; update += 1) {
            view.render(<Harness {...props} schema={createEditorSchema(context)} initialContent={blocksToRichMarkdown(editor.document)} />);
            await flush();
        }

        expect(replace).toHaveBeenCalledOnce();
        expect(editor.document[0]?.id).toBe(id);
        expect(changed).not.toHaveBeenCalled();
        unsubscribe();
    });

    it('does not restore old content after the user clears the document', async () => {
        const editor = BlockNoteEditor.create({ schema });
        const props = { editor, schema, noteFilename: 'page', initialContent: source };
        const view = mountTestComponent(<Harness {...props} />);
        await flush();
        editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [] }]);
        const replace = vi.spyOn(editor, 'replaceBlocks');
        view.render(<Harness {...props} schema={createEditorSchema(context)} />);
        await flush();
        expect(replace).not.toHaveBeenCalled();
        expect(editor.document[0]?.type).toBe('paragraph');
    });

    it('hydrates a replacement editor for the same page', async () => {
        const first = BlockNoteEditor.create({ schema });
        const props = { schema, noteFilename: 'page', initialContent: source };
        const view = mountTestComponent(<Harness {...props} editor={first} />);
        await flush();
        const next = BlockNoteEditor.create({ schema });
        view.render(<Harness {...props} editor={next} />);
        await flush();
        expect(next.document[0]?.type).toBe('gnosi_view');
    });

    it.each<PartialEditorBlock>([
        { type: 'gnosi_view', props: { view_id: 'remote-view' } },
        { type: 'embed', props: { url: 'https://example.com' } },
        { type: 'paragraph', content: [], children: [{ type: 'paragraph', content: 'Nested content' }] },
        { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['Existing cell'] }] } },
    ])('preserves existing $type content while initial content is loading', async block => {
        const editor = BlockNoteEditor.create({ schema, initialContent: [block] });
        const before = editor.document;
        const replace = vi.spyOn(editor, 'replaceBlocks');
        mountTestComponent(<Harness editor={editor} schema={schema} noteFilename="page" initialContent={source} />);
        await flush();
        expect(replace).not.toHaveBeenCalled();
        expect(editor.document).toEqual(before);
    });
});
