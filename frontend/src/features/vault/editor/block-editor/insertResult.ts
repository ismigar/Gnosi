import type { InsertContentResult } from '../../content/InsertContentModal';
import type { EditorBlock, GnosiEditor } from './schema';
import type { PartialInlineArray } from './inlineTokens';

export function detectEmbeddableUrl(text: string): 'youtube' | 'vimeo' | 'pdf' | null {
    const trimmed = (text || '').trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const host = url.hostname.replace(/^www\./, '');
        if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
        if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo';
        if (url.pathname.toLowerCase().endsWith('.pdf')) return 'pdf';
    } catch { /* not a URL */ }
    return null;
}

type InsertionEditor = Pick<GnosiEditor, 'insertInlineContent' | 'insertBlocks' | 'getTextCursorPosition' | 'focus'>;
export function applyInsertResult(editor: InsertionEditor, { url, mode, kind, name, items }: InsertContentResult, anchor?: EditorBlock | null): void {
    if (items?.length) {
        const content: PartialInlineArray = [];
        items.forEach((item, index) => {
            if (index > 0) content.push({ type: 'text', text: ' ', styles: {} });
            content.push({ type: 'link', href: item.url, content: [{ type: 'text', text: item.name || item.url, styles: {} }] });
        });
        editor.insertInlineContent(content); editor.focus(); return;
    }
    if (!url) return;
    if (mode === 'frame') {
        editor.insertBlocks([{ type: 'embed', props: { url, caption: '' } }], anchor || editor.getTextCursorPosition().block, 'after');
    } else if (mode === 'block') {
        const type = kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'file';
        editor.insertBlocks([{ type, props: { url, name: name || url } }], anchor || editor.getTextCursorPosition().block, 'after');
    } else editor.insertInlineContent([{ type: 'link', href: url, content: [{ type: 'text', text: name || url, styles: {} }] }]);
    editor.focus();
}
