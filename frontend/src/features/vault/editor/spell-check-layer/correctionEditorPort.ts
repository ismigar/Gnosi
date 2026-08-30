import type { EditorView } from '@tiptap/pm/view';
import type { createSpellcheckPlugin, spellPluginKey } from '../spellcheck/spellcheckPlugin';

/** ProseMirror's view is schema-agnostic; no default BlockNote schema leaks here. */
export interface CorrectionViewPort {
    readonly prosemirrorView: EditorView;
}

export interface SpellCheckEditorPort extends CorrectionViewPort {
    readonly document: readonly unknown[];
    readonly _tiptapEditor: {
        registerPlugin: (plugin: ReturnType<typeof createSpellcheckPlugin>) => unknown;
        unregisterPlugin: (key: typeof spellPluginKey) => unknown;
    };
}

/** Keep each editor's own document/parser types connected through the roundtrip. */
export interface AICorrectionEditorPort<DocumentBlock, ParsedBlock> extends CorrectionViewPort {
    readonly document: DocumentBlock[];
    blocksToMarkdownLossy: (blocks: DocumentBlock[]) => string;
    tryParseMarkdownToBlocks: (markdown: string) => ParsedBlock[];
    replaceBlocks: (oldBlocks: DocumentBlock[], newBlocks: ParsedBlock[]) => unknown;
}
