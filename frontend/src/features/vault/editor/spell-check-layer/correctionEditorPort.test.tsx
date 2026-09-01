import type { BlockNoteEditor } from '@blocknote/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EditorBlock, GnosiEditor } from '../block-editor/schema';
import AICorrectLayer from '../AICorrectLayer';
import SpellCheckLayer from '../SpellCheckLayer';
import type { AICorrectionEditorPort, CorrectionViewPort, SpellCheckEditorPort } from './correctionEditorPort';

function customEditorLayers(editor: GnosiEditor) {
    return <><SpellCheckLayer editor={editor} /><AICorrectLayer editor={editor} /></>;
}

function defaultEditorLayers(editor: BlockNoteEditor) {
    return <><SpellCheckLayer editor={editor} /><AICorrectLayer editor={editor} /></>;
}

describe('schema-agnostic correction ports', () => {
    it('accepts the real custom Gnosi editor and default editor without widening/casts', () => {
        expectTypeOf<GnosiEditor>().toExtend<CorrectionViewPort>();
        expectTypeOf<GnosiEditor>().toExtend<SpellCheckEditorPort>();
        expectTypeOf<GnosiEditor>().toExtend<AICorrectionEditorPort<EditorBlock, EditorBlock>>();
        expectTypeOf<BlockNoteEditor>().toExtend<SpellCheckEditorPort>();
        expect(customEditorLayers).toBeTypeOf('function');
        expect(defaultEditorLayers).toBeTypeOf('function');
    });

    it('retains the document/parser type relationship instead of default-schema blocks', () => {
        type Source = { id: string; type: 'gnosi_view'; props: { view_id: string } };
        type Parsed = { id: string; type: 'transclusion'; props: { target: string } };
        type Port = AICorrectionEditorPort<Source, Parsed>;
        expectTypeOf<Port['document']>().toEqualTypeOf<Source[]>();
        expectTypeOf<Port['blocksToMarkdownLossy']>().parameter(0).toEqualTypeOf<Source[]>();
        expectTypeOf<Port['tryParseMarkdownToBlocks']>().returns.toEqualTypeOf<Parsed[]>();
        expectTypeOf<Port['replaceBlocks']>().parameter(0).toEqualTypeOf<Source[]>();
        expectTypeOf<Port['replaceBlocks']>().parameter(1).toEqualTypeOf<Parsed[]>();
    });
});
