import { Info, List as ListIcon, Workflow, Superscript, RefreshCw, Link2 } from 'lucide-react';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { createReferenceId, firstBlockChild } from './values';
import type { EditorMenuItem, SlashMenuInputs } from './types';

export function blockItems({ editor, t, setLinkCardCtx }: SlashMenuInputs): EditorMenuItem[] {
    const insertBlockItems: EditorMenuItem[] = [
        {
            title: t('editor.callout', { defaultValue: "Callout" }),
            onItemClick: () => {
                const callout = insertOrUpdateBlockForSlashMenu(editor, {
                    type: 'alert',
                    props: { type: 'info' },
                    children: [{ type: 'paragraph' }],
                });
                const firstChild = firstBlockChild(callout);
                if (firstChild) editor.setTextCursorPosition(firstChild, 'start');
            },
            aliases: ["callout", "aviso", "avis", "caixa", "caja", "encadré", "info"],
            group: t('editor.blocks_group', { defaultValue: "Blocks" }),
            icon: <Info size={18} />,
            subtext: t('editor.callout_subtext', { defaultValue: "Container for any kind of block" }),
        },
        {
            title: t('editor.toc', { defaultValue: "Table of contents" }),
            onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'tableOfContents', props: {} }),
            aliases: ["toc", "index", "índex", "indice", "taula de continguts", "table of contents", "outline", "continguts"],
            group: t('editor.blocks_group', { defaultValue: "Blocks" }),
            icon: <ListIcon size={18} />,
            subtext: t('editor.toc_subtext', { defaultValue: "Generates the index from the headings" }),
        },
        {
            title: t('editor.mermaid', { defaultValue: "Mermaid diagram" }),
            onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'mermaid', props: { code: '' } }),
            aliases: ["mermaid", "diagrama", "diagram", "flowchart", "graph", "uml", "sequence", "gantt"],
            group: t('editor.blocks_group', { defaultValue: "Blocks" }),
            icon: <Workflow size={18} />,
            subtext: t('editor.mermaid_subtext', { defaultValue: "Flowcharts, sequence, Gantt…" }),
        },
        {
            title: t('editor.footnote', { defaultValue: "Footnote" }),
            onItemClick: () => {
                const fid = createReferenceId();
                editor.insertInlineContent([{ type: 'footnote', props: { id: fid, content: '' } }, ' ']);
            },
            aliases: ["footnote", "nota", "nota al peu", "peu", "fn", "[^]"],
            group: t('editor.blocks_group', { defaultValue: "Blocks" }),
            icon: <Superscript size={18} />,
            subtext: t('editor.footnote_subtext', { defaultValue: "Inserts a footnote reference" }),
        },
        {
            title: t('editor.synced_block', { defaultValue: "Synced block" }),
            onItemClick: () => {
                const sid = createReferenceId();
                insertOrUpdateBlockForSlashMenu(editor, { type: 'synced', props: { sync_id: sid } });
            },
            aliases: ["synced", "sincronitzat", "sync", "reutilitzable", "compartit"],
            group: t('editor.blocks_group', { defaultValue: "Blocks" }),
            icon: <RefreshCw size={18} />,
            subtext: t('editor.synced_block_subtext', { defaultValue: "Content shared between pages (bidirectional)" }),
        },
        {
            title: t('editor.linkcard', { defaultValue: "Link card" }),
            onItemClick: () => { setLinkCardCtx({ editor }); },
            aliases: ["bookmark", "targeta", "card", "link", "enllaç", "preview", "og", "marcador"],
            group: t('editor.blocks_group', { defaultValue: "Blocks" }),
            icon: <Link2 size={18} />,
            subtext: t('editor.linkcard_subtext', { defaultValue: "Preview of a link with image and title" }),
        },
    ];
    return insertBlockItems;
}
