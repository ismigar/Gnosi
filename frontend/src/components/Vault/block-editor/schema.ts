import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from '@blocknote/core';
import { withMultiColumn } from '@blocknote/xl-multi-column';
import type { VaultEditorContextValue } from '../VaultEditorContext';
import { createBlockSpecs } from './blockSpecs';
import { createInlineSpecs } from './inlineSpecs';

export function createEditorSchema(contextValue: VaultEditorContextValue) {
    const blocks = createBlockSpecs();
    const inline = createInlineSpecs(contextValue);
        const baseSchema = BlockNoteSchema.create({
            blockSpecs: {
                ...defaultBlockSpecs,
                database: { ...blocks.database(), group: "bnBlock" },
                gnosi_view: { ...blocks.gnosi_view(), group: "bnBlock" },
                transclusion: { ...blocks.transclusion(), group: "bnBlock" },
                embed: { ...blocks.embed(), group: "bnBlock" },
                bibliography: { ...blocks.bibliography(), group: "bnBlock" },
                // `toggleListItem` from defaultBlockSpecs handles `:::toggle`.
                alert: { ...blocks.alert(), group: "bnBlock" },
                tableOfContents: { ...blocks.tableOfContents(), group: "bnBlock" },
                mermaid: { ...blocks.mermaid(), group: "bnBlock" },
                linkcard: { ...blocks.linkcard(), group: "bnBlock" },
                synced: { ...blocks.synced(), group: "bnBlock" },
            },
            inlineContentSpecs: {
                ...defaultInlineContentSpecs,
                wikilink: inline.wikilink,
                cite: inline.cite,
                footnote: inline.footnote,
                mention: inline.mention,
                dateref: inline.dateref,
                inlineIcon: inline.inlineIcon,
            },
            styleSpecs: defaultStyleSpecs,
        });
        return withMultiColumn(baseSchema);
}

export type EditorSchema = ReturnType<typeof createEditorSchema>;
export type GnosiEditor = EditorSchema['BlockNoteEditor'];
export type EditorBlock = EditorSchema['Block'];
export type PartialEditorBlock = EditorSchema['PartialBlock'];
