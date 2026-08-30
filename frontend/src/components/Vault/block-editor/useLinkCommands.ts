import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createVaultPage } from '../../../shared/api/vaults';
import { notifyError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import { expandBracketRange, inlineText, legacyCursorIndex, replaceTokenInInlineArray, type PartialInlineItem } from './inlineTokens';
import type { EditorBlock, GnosiEditor } from './schema';

type LinkEditor = Pick<GnosiEditor, 'insertInlineContent' | 'updateBlock' | 'replaceBlocks' | 'insertBlocks' | 'document'> & {
    readonly getTextCursorPosition: () => { readonly block?: EditorBlock; readonly index?: number };
};
interface Options { readonly editor: LinkEditor; readonly handleSave: () => Promise<void>; readonly onRefreshNotes?: () => void; }
interface MissingLink { readonly rawTitle: string; readonly tableId?: string | null; readonly mode?: 'wiki' | 'transclusion'; readonly section?: string; }

export function normalizePendingLinkTitle(title: string): string { return (title || '').replace(/^\[\[/, '').split('|')[0]?.trim() || ''; }
function legacyText(value: unknown): string { return String(value); }

export function useLinkCommands({ editor, handleSave, onRefreshNotes }: Options) {
    const { t } = useTranslation();
    const creating = useRef(new Set<string>());
    const insertWikiLink = useCallback((noteTitle: string, section = '', noteId = '', replaceQuery = '') => {
        const title = (noteTitle || '').trim(); const id = (noteId || '').trim();
        if (!title) return;
        const item = { type: 'wikilink' as const, props: { title: section ? `${title} > ${section}` : title, target: id || title, section: section || '' } };
        const cursor = editor.getTextCursorPosition(); const block = cursor.block;
        if (!block) { editor.insertInlineContent([item]); return; }
        const inline = Array.isArray(block.content) ? block.content : [];
        const text = inline.map(inlineText).join(''); const index = legacyCursorIndex(cursor);
        const query = (replaceQuery || '').trim();
        let matchStart = -1; let matchedToken = '';
        for (const token of [query, `[[${query}`, `[${query}`].filter(value => value.length > 0)) {
            const position = text.lastIndexOf(token, index);
            if (position > matchStart) { matchStart = position; matchedToken = token; }
        }
        if (matchStart === -1) {
            const double = text.lastIndexOf('[[', index); const single = text.lastIndexOf('[', index);
            matchStart = double >= 0 ? double : single;
            if (matchStart >= 0) matchedToken = text.substring(matchStart, index);
        }
        if (matchStart >= 0) {
            try {
                const range = expandBracketRange(text, matchStart, matchStart + matchedToken.length);
                const content = replaceTokenInInlineArray(inline, range.start, range.end, item);
                if (content) {
                    editor.updateBlock(block, { content });
                    setTimeout(() => { void handleSave(); }, 100); return;
                }
            } catch (error) { console.warn('Atomic replacement failed', error); }
        }
        editor.insertInlineContent([item]);
        setTimeout(() => { void handleSave(); }, 100);
    }, [editor, handleSave]);

    const insertCitation = useCallback((citationKey: string) => {
        const key = (citationKey || '').trim(); if (!key) return;
        try {
            editor.insertInlineContent([{ type: 'cite', props: { citationKey: key } }, ' ']);
            setTimeout(() => { void handleSave(); }, 100);
        } catch (error) {
            console.warn('insertCitation fallback to markdown:', error);
            try {
                editor.insertInlineContent(`[@${key}] `);
                setTimeout(() => { void handleSave(); }, 100);
            } catch (fallbackError) { console.error('insertCitation fallback failed:', fallbackError); }
        }
    }, [editor, handleSave]);

    const insertTransclusion = useCallback((targetId: string, alias = '', section = '') => {
        const target = (targetId || '').trim(); if (!target) return;
        const props = { target, alias: (alias || '').trim(), section: (section || '').trim() };
        const block = editor.getTextCursorPosition().block;
        if (!block) {
            const anchor = editor.document[editor.document.length - 1];
            if (anchor) editor.insertBlocks([{ type: 'transclusion', props }], anchor, 'after');
            return;
        }
        if (Array.isArray(block.content)) {
            const text = block.content.map(inlineText).join('');
            const double = text.lastIndexOf('![['); const single = text.lastIndexOf('!');
            const start = double >= 0 ? double : single;
            if (start >= 0) {
                try {
                    const before = text.slice(0, start).trim();
                    if (!before) editor.replaceBlocks([block], [{ type: 'transclusion', props }]);
                    else {
                        editor.updateBlock(block, { content: [{ type: 'text', text: before, styles: {} }] });
                        editor.insertBlocks([{ type: 'transclusion', props }], block, 'after');
                    }
                    return;
                } catch (error) { console.debug('transclusion inline replace fallback:', error); }
            }
        }
        editor.insertBlocks([{ type: 'transclusion', props }], block, 'after');
    }, [editor]);

    const createMissingPageAndInsertLink = useCallback(async ({ rawTitle, tableId = null, mode = 'wiki', section = '' }: MissingLink) => {
        const title = normalizePendingLinkTitle(rawTitle); const safeSection = section.trim();
        if (!title || creating.current.has(title)) return;
        creating.current.add(title);
        const metadata: { title: string; table_id?: string; database_table_id?: string } = { title };
        if (tableId) { metadata.table_id = tableId; metadata.database_table_id = tableId; }
        try {
            const response = await createVaultPage({ title, content: '', is_database: false, metadata });
            const id = (response.id || '').trim();
            if (mode === 'transclusion') insertTransclusion(id || title, title, safeSection);
            else insertWikiLink(title, safeSection, id);
            if (onRefreshNotes) window.setTimeout(() => {
                try { onRefreshNotes(); } catch (error) { console.debug('onRefreshNotes failed:', error); }
            }, 1400);
            const filename: unknown = Reflect.get(response, 'filename');
            if (filename) toast.success(t('editor.page_created', { title: response.title || legacyText(filename).replace(/\.md$/, '') }));
        } catch (error) { notifyError('page-create', error, t('editor.page_create_error')); }
        finally { window.setTimeout(() => { creating.current.delete(title); }, 800); }
    }, [insertTransclusion, insertWikiLink, onRefreshNotes, t]);
    return { insertWikiLink, insertCitation, insertTransclusion, createMissingPageAndInsertLink, normalizePendingLinkTitle };
}

// Exported for command-level fixtures without broad, untyped editor doubles.
export type { LinkEditor, MissingLink, PartialInlineItem };
