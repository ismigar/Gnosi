import { Link2, MessageSquare, Quote, Maximize2 } from 'lucide-react';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { errorMessage } from './values';
import type { EditorMenuItem, SlashMenuInputs } from './types';

export function quickLinkItems({ editor, t, requestInsertContent, applyInsertResult, insertWikiLink, setIsCitePickerOpen }: SlashMenuInputs): EditorMenuItem[] {
    const quickLinkItems: EditorMenuItem[] = [
        {
            title: t('editor.insert_content', { defaultValue: "Insert content…" }),
            onItemClick: async () => {
                const anchor = editor.getTextCursorPosition().block;
                try {
                    const result = await requestInsertContent({ initialTab: 'vault' });
                    if (result.url || result.items?.length) applyInsertResult(result, anchor);
                } catch (err) {
                    if (!(errorMessage(err) || '').match(/cancelled|superseded/)) {
                        console.warn('insert content cancelled:', errorMessage(err));
                    }
                }
            },
            aliases: ["+", "insereix", "insert", "enllac", "link", "rich", "url", "file", "local", "embed", "fitxer", "media", "pdf", "video", "image", "frame", "iframe", "youtube", "vimeo", "audio"],
            group: t('editor.links_group'),
            icon: <Link2 size={18} />,
            subtext: t('editor.insert_content_subtext', { defaultValue: "Unified modal: Vault, local disk, upload or URL" }),
        },
        {
            title: t('editor.internal_link'),
            onItemClick: () => { insertWikiLink(t('editor.note_name_placeholder')); },
            aliases: ["wiki", "internal", "note", "[[]]"],
            group: t('editor.links_group'),
            icon: <MessageSquare size={18} />,
            subtext: t('editor.insert_wiki_link_format'),
        },
        {
            title: t('editor.link_to_section'),
            onItemClick: () => { editor.insertInlineContent(`[[${t('editor.note_section_placeholder')}]]`); },
            aliases: ["wiki section", "section", "anchor", "#"],
            group: t('editor.links_group'),
            icon: <MessageSquare size={18} />,
            subtext: t('editor.wiki_section_format'),
        },
        {
            title: t('editor.wiki_link_with_alias'),
            onItemClick: () => { editor.insertInlineContent(`[[${t('editor.note_alias_placeholder')}]]`); },
            aliases: ["wiki alias", "display", "label"],
            group: t('editor.links_group'),
            icon: <MessageSquare size={18} />,
            subtext: t('editor.wiki_alias_format'),
        },
        {
            title: t('editor.insert_citation', { defaultValue: "Insert citation…" }),
            onItemClick: () => { setIsCitePickerOpen(true); },
            aliases: ["cite", "citation", "cita", "@", "[@", "ref", "bib", "bibliography", "reference"],
            group: t('editor.links_group'),
            icon: <Quote size={18} />,
            subtext: t('editor.insert_citation_subtext', {
                defaultValue: "Picker (⌘⇧I) — search by author, title or citation key",
            }),
        },
        {
            title: t('editor.insert_bibliography', { defaultValue: "Automatic bibliography" }),
            onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, {
                type: 'bibliography',
                props: { style: 'apa', locale: 'en-US' },
            }),
            aliases: ["bibliography", "bib", "refs", "references", "bibliografia"],
            group: t('editor.links_group'),
            icon: <Quote size={18} />,
            subtext: t('editor.insert_bibliography_subtext', {
                defaultValue: "Generates the reference list from the document's citations",
            }),
        },
        {
            title: t('editor.obsidian_transclusion'),
            onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, {
                type: 'transclusion',
                props: { target: '', alias: '', section: '' },
            }),
            aliases: ["transclusion", "![[", "obsidian"],
            group: t('editor.links_group'),
            icon: <Maximize2 size={18} />,
            subtext: t('editor.insert_transclusion_format'),
        },
        {
            title: t('editor.section_transclusion'),
            onItemClick: () => { editor.insertInlineContent(`![[${t('editor.note_section_transclusion_placeholder')}]]`); },
            aliases: ["transclusion section", "![[#"],
            group: t('editor.links_group'),
            icon: <Maximize2 size={18} />,
            subtext: t('editor.section_transclusion_format'),
        },
        {
            title: t('editor.transclusion_with_alias'),
            onItemClick: () => { editor.insertInlineContent(`![[${t('editor.transclusion_alias_placeholder')}]]`); },
            aliases: ["transclusion alias"],
            group: t('editor.links_group'),
            icon: <Maximize2 size={18} />,
            subtext: t('editor.transclusion_alias_format'),
        },
    ];
    return quickLinkItems;
}
